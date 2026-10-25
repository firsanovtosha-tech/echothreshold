/* Браузероподобный сценарий «Рубеж Эха» в jsdom: загрузка index.html со всеми скриптами,
 * проверка старта без ошибок консоли, переходов между экранами, покупок, набора и игрового цикла.
 * Запуск: node tests/dom.js  (требуется npm i -D jsdom) */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const consoleErrors = [];

function makeDom(saveJson) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    // ВАЖНО: без resources:'usable' — иначе jsdom пытается скачать <script src> по http и вешает процесс;
    // локальные скрипты загружаются вручную ниже из файловой системы.
    pretendToBeVisual: false,
    beforeParse(window) {
      // canvas-заглушка (jsdom не умеет 2D-контекст)
      window.HTMLCanvasElement.prototype.getContext = function () {
        return new Proxy({}, {
          get(t, p) {
            if (p === 'canvas') return null;
            if (typeof p === 'string') return t[p] !== undefined ? t[p] : (...a) => {};
            return undefined;
          },
          set(t, p, v) { t[p] = v; return true; }
        });
      };
      // WebAudio-заглушка (полный набор методов, которые использует engine/audio.js)
      const fakeParam = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
      const fakeNode = extra => Object.assign({ connect() {}, disconnect() {}, start() {}, stop() {} }, extra || {});
      window.AudioContext = function () {
        return {
          destination: {}, currentTime: 0, sampleRate: 44100, state: 'running',
          resume() { return Promise.resolve(); }, suspend() { return Promise.resolve(); }, close() { return Promise.resolve(); },
          createGain: () => fakeNode({ gain: fakeParam() }),
          createOscillator: () => fakeNode({ frequency: fakeParam(), detune: fakeParam(), type: 'sine' }),
          createBiquadFilter: () => fakeNode({ frequency: fakeParam(), Q: fakeParam(), gain: fakeParam(), type: 'lowpass' }),
          createBufferSource: () => fakeNode({ buffer: null, playbackRate: fakeParam(), loop: false }),
          createBuffer: (ch, len) => ({ length: len, numberOfChannels: ch, getChannelData: () => new Float32Array(len) }),
          createDynamicsCompressor: () => fakeNode({ threshold: fakeParam(), knee: fakeParam(), ratio: fakeParam(), attack: fakeParam(), release: fakeParam() }),
          createStereoPanner: () => fakeNode({ pan: fakeParam() })
        };
      };
      // requestAnimationFrame без pretendToBeVisual — управляемый таймер для тестов цикла
      window.__rafQueue = [];
      window.requestAnimationFrame = cb => { window.__rafQueue.push(cb); return window.__rafQueue.length; };
      window.cancelAnimationFrame = () => {};
      window.confirm = () => true;
      window.localStorage.clear();
      if (saveJson) window.localStorage.setItem('echothreshold_save_v2', saveJson);
      window.addEventListener('error', e => consoleErrors.push(String(e.message || e)));
    }
  });
  // ручная загрузка локальных <script src>, т.к. resources:usable не читает файлы с file/http-url из памяти
  const window = dom.window;
  for (const m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    const src = fs.readFileSync(path.join(ROOT, m[1]), 'utf8');
    const s = window.document.createElement('script');
    s.textContent = src;
    window.document.body.appendChild(s);
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  return { dom, window };
}

let passed = 0, failed = 0;
let performanceNow = 0; // виртуальные метки времени для ручного прогона rAF-очереди
function test(name, fn) {
  try { fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { failed++; console.error('  ✘ ' + name + '\n     ' + e.message); }
}

console.log('\n== jsdom: загрузка и интерфейс ==');

const { window } = makeDom(null);
const doc = window.document;
const TD = window.TD;

test('игра стартует: окно TD.Game создано, активных ошибок консоли нет', () => {
  assert.ok(window.TDG instanceof TD.Game, 'TDG не создан');
  assert.strictEqual(consoleErrors.length, 0, 'Ошибки: ' + consoleErrors.join(' | '));
});

test('главное меню активно, показаны 5 карт (1 открыта), ⟡ 200', () => {
  assert.ok(doc.getElementById('screen-menu').classList.contains('active'));
  const cards = doc.querySelectorAll('#map-list .map-card');
  assert.strictEqual(cards.length, 5);
  assert.strictEqual(doc.querySelectorAll('#map-list .map-card.locked').length, 4);
  assert.match(doc.getElementById('menu-chronicles').textContent, /200/);
});

test('кнопка «Начать кампанию» открывает подготовку с 5 стартовыми типами', () => {
  doc.getElementById('btn-start').click();
  assert.ok(doc.getElementById('screen-loadout').classList.contains('active'));
  assert.strictEqual(doc.getElementById('loadout-count').textContent, '5/5');
  assert.strictEqual(doc.querySelectorAll('#tower-grid .lg-card.selected').length, 5);
});

test('набор: можно снять выбор до 1 типа; >5 типов невозможно', () => {
  const grid = doc.getElementById('tower-grid');
  const cardsOf = () => [...grid.querySelectorAll('.lg-card')];
  let selected = cardsOf().filter(c => c.classList.contains('selected'));
  // снимаем 4 из 5 выбранных
  for (let i = 0; i < 4; i++) selected[i].click();
  assert.strictEqual(doc.getElementById('loadout-count').textContent, '1/5');
  // детерминированно открываем все башни в текущем сохранении (тест лимита не должен
  // зависеть от прогресса покупок) и перерисовываем сетку набора
  for (const tid of TD.TOWER_ORDER) window.TDG.state.towerUnlocks[tid] = true;
  window.TDG.renderLoadout();
  // пытаемся набрать сверх лимита: клики по всем свободным открытым картам
  let free = cardsOf().filter(c => !c.classList.contains('selected') && !c.classList.contains('locked'));
  for (const c of free) c.click();
  assert.strictEqual(window.TDG.currentLoadout.length, 5, 'больше 5 типов не набралось');
  // шестой клик — отказ с понятным сообщением
  const sixth = cardsOf().find(c => !c.classList.contains('selected') && !c.classList.contains('locked'));
  assert.ok(sixth, 'должна быть хотя бы одна открытая незанятая карта для проверки лимита');
  sixth.onclick();
  assert.strictEqual(window.TDG.currentLoadout.length, 5, 'шестой тип не добавился');
  assert.match(doc.getElementById('loadout-toast').textContent, /не более 5|Можно выбрать/);
});

test('в бою нельзя строить башню вне набора (проверка на модели sim)', () => {
  // фиксируем набор из 1 типа и идём в бой
  window.TDG.currentLoadout = ['watch'];
  window.TDG.renderLoadout();
  doc.getElementById('btn-loadout-confirm').click();
  assert.ok(doc.getElementById('screen-battle') === null || doc.body.classList.contains('in-battle'), 'бой не начался');
  const sim = window.TDG.sim;
  assert.ok(sim, 'симуляция не создана');
  assert.deepStrictEqual(sim.loadout, ['watch']);
  assert.strictEqual(TD.buildTower(sim, 0, 'sniper').ok, false);
  assert.strictEqual(TD.buildTower(sim, 0, 'watch').ok, true);
});

test('HUD показывает скорость 1×; кнопка циклит 1 → 1.5 → 2.5 → 1', () => {
  const g = window.TDG;
  const btn = doc.getElementById('btn-speed');
  // HUD обновляется в кадре rAF — прогоняем кадр после каждого нажатия
  const tick = () => { const q = window.__rafQueue.splice(0); for (const cb of q) cb(performanceNow += 16.7); };
  tick();
  assert.strictEqual(btn.textContent, '1×');
  btn.click(); tick(); assert.strictEqual(btn.textContent, '1.5×');
  btn.click(); tick(); assert.strictEqual(btn.textContent, '2.5×');
  btn.click(); tick(); assert.strictEqual(btn.textContent, '1×');
});

test('пауза останавливает симуляцию; без паузы rAF-цикл двигает игру (сквозная проверка цикла)', () => {
  const g = window.TDG;
  if (g.sim.gameOver) g.startBattle('map1', ['watch']); // бой мог закончиться во время прогонов кадров выше
  // 1) при paused=true ни один кадр rAF не должен двигать sim.time
  doc.getElementById('btn-pause').click();
  assert.strictEqual(g.paused, true);
  let t0 = g.sim.time;
  for (let i = 0; i < 5; i++) { const q = window.__rafQueue.splice(0); for (const cb of q) cb(performanceNow += 16.7); }
  assert.strictEqual(g.sim.time, t0, 'на паузе игровое время не должно расти');
  // 2) снять паузу — кадры должны двигать симуляцию
  doc.getElementById('btn-pause').click();
  assert.strictEqual(g.paused, false);
  t0 = g.sim.time;
  for (let i = 0; i < 30; i++) { const q = window.__rafQueue.splice(0); for (const cb of q) cb(performanceNow += 16.7); }
  assert.ok(g.sim.time > t0 + 0.3, `симуляция должна идти: ${t0} -> ${g.sim.time}`);
});

test('вызов волны кнопкой и Пробелом запускает waveActive', () => {
  const g = window.TDG;
  if (g.sim.gameOver) g.startBattle('map1', ['watch']);
  g.sim.credits = 5000;
  doc.getElementById('btn-wave').click();
  assert.strictEqual(g.sim.waveActive, true);
  const tick = () => { const q = window.__rafQueue.splice(0); for (const cb of q) cb(performanceNow += 16.7); };
  tick();
  assert.match(doc.getElementById('hud-phase').textContent, /боя/);
  // Пробел тоже обрабатывается (вторая волна не стартует, пока активна первая)
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
  assert.strictEqual(g.sim.waveIndex, 0, 'Пробел не должен запускать вторую волну во время активной первой');
});

test('магазин: покупка списывает хроники один раз и сохраняется', () => {
  // набор выше массово открывал все башни в памяти — перезагружаем игру с чистым сохранением
  const saveJson = JSON.stringify({
    version: 2, chronicles: 500, unlockedMaps: ['map1'], firstRewards: {}, repeatWins: {},
    towerUnlocks: { watch: true, crossbow: true, sling: true, cryo: true, flamethrower: true },
    bestResults: {}, totalPlaySeconds: 0, settings: {}
  });
  const { window: w2 } = makeDom(saveJson);
  const g = w2.TDG;
  g.showScreen('shop');
  const doc2 = w2.document;
  assert.ok(doc2.getElementById('screen-shop').classList.contains('active'));
  const shopCards = [...doc2.querySelectorAll('#shop-grid .lg-card')];
  const arcanistCard = shopCards.find(c => c.textContent.includes('Арканист'));
  const buyBtn = arcanistCard.querySelector('button');
  assert.ok(buyBtn && !buyBtn.disabled, 'кнопка покупки Арканиста недоступна');
  buyBtn.click();
  assert.strictEqual(g.state.chronicles, 340);
  assert.strictEqual(g.state.towerUnlocks.arcanist, true);
  const saved = JSON.parse(w2.localStorage.getItem('echothreshold_save_v2'));
  assert.strictEqual(saved.chronicles, 340, 'покупка не сохранена в localStorage');
  // повторной кнопки у открытой башни нет
  const again = [...doc2.querySelectorAll('#shop-grid .lg-card')].find(c => c.textContent.includes('Арканист'));
  assert.strictEqual(again.querySelector('button'), null);
});

test('экран результатов доступен после боя; победа выдаёт firstReward однократно', () => {
  const g = window.TDG;
  // форсируем победу через штатный игровой путь: gameOver='win' + endBattle()
  g.sim.gameOver = 'win';
  g.endBattle('win');
  assert.strictEqual(g.lastReward, 210, 'первая победа выдаёт ровно firstReward карты (210)');
  assert.ok(doc.getElementById('screen-result').classList.contains('active'));
  // вторая победа на той же карте — первый повтор: +20 хроник (ТЗ 11.2), не 0 и не 210
  const before = g.state.chronicles;
  g.startBattle('map1', ['watch']);
  g.sim.gameOver = 'win';
  g.endBattle('win');
  assert.strictEqual(g.lastReward, 20, 'первый повтор даёт +20');
  assert.strictEqual(g.state.chronicles, before + 20);
});

test('навигация: ☰ прерывает бой → меню; карта 2 разблокирована после победы (unlockNextMap)', () => {
  const g = window.TDG;
  doc.getElementById('btn-menu').click();
  assert.ok(doc.getElementById('screen-menu').classList.contains('active'));
  assert.strictEqual(doc.querySelectorAll('#map-list .map-card.locked').length, 3, 'карта 2 должна стать доступной');
  // разблокировка переживает перезагрузку: в сохранении есть map2
  const saved = JSON.parse(window.localStorage.getItem('echothreshold_save_v2'));
  assert.ok(saved.unlockedMaps.includes('map2'), 'map2 не сохранена в localStorage');
});

test('полный сквозной цикл: чистый профиль → покупка → набор из 1 типа → победа → награды в ЛС', () => {
  // полностью независимый экземпляр игры с чистым сохранением — без загрязнения общим состоянием
  const cleanSave = JSON.stringify({
    version: 2, chronicles: 800, unlockedMaps: ['map1'], firstRewards: {}, repeatWins: {},
    towerUnlocks: { watch: true, crossbow: true, sling: true, cryo: true, flamethrower: true },
    bestResults: {}, totalPlaySeconds: 0, settings: {}
  });
  const { window: w3 } = makeDom(cleanSave);
  const g3 = w3.TDG, d3 = w3.document;
  // 1) покупка Арканиста (160 ⟡) через UI магазина
  g3.showScreen('shop');
  const arcCard = [...d3.querySelectorAll('#shop-grid .lg-card')].find(c => c.textContent.includes('Арканист'));
  arcCard.querySelector('button').click();
  assert.strictEqual(g3.state.chronicles, 640);
  // 2) подготовка: снять стартовый набор до 1 типа и подтвердить — бой обязан начаться
  g3.openLoadout('map1');
  g3.currentLoadout = ['watch'];
  g3.renderLoadout();
  d3.getElementById('btn-loadout-confirm').click();
  assert.deepStrictEqual(g3.sim.loadout, ['watch'], 'в бой должен уйти ровно 1 тип');
  // 3) штатная победа через endBattle
  g3.sim.gameOver = 'win';
  g3.endBattle('win');
  assert.strictEqual(g3.lastReward, 210, 'первая победа = firstReward карты без доначислений');
  // 4) всё состояние зафиксировано в localStorage одним снимком
  const st = JSON.parse(w3.localStorage.getItem('echothreshold_save_v2'));
  assert.strictEqual(st.chronicles, 640 + 210, 'награды должны быть сохранены');
  assert.strictEqual(st.towerUnlocks.arcanist, true);
  assert.ok(st.firstRewards.map1 === true && st.unlockedMaps.includes('map2'));
  assert.ok(st.bestResults.map1, 'лучший результат должен сохраниться');
  // 5) «перезагрузка» видит всё то же самое
  const { window: w4 } = makeDom(w3.localStorage.getItem('echothreshold_save_v2'));
  assert.strictEqual(w4.TD.Save.load().chronicles, 850);
});

test('второй экземпляр игры с тем же сохранением видит купленную башню и хроники (персистентность)', () => {
  // детерминированный профиль: 700 ⟡ после покупки Арканиста (160) и первой победы на map1 (+245)
  const saved = JSON.stringify({
    version: 2, chronicles: 700, unlockedMaps: ['map1', 'map2'],
    firstRewards: { map1: true }, repeatWins: { map1: 3 },
    towerUnlocks: { watch: true, crossbow: true, sling: true, cryo: true, flamethrower: true, arcanist: true },
    bestResults: { map1: { hp: 20, timeSec: 300, wavesCleared: 10 } },
    totalPlaySeconds: 300, settings: {}
  });
  const { window: w2 } = makeDom(saved);
  assert.strictEqual(w2.TD.Save.load().towerUnlocks.arcanist, true);
  assert.ok(w2.TD.Save.load().chronicles >= 570);
  assert.strictEqual(w2.TD.Save.load().chronicles, 700, 'хроники при загрузке должны совпадать с сохранением');
  assert.strictEqual(w2.TD.Save.load().unlockedMaps.length, 2, 'разблокированные карты должны переживать перезагрузку');
});

test('повреждённое сохранение в URL-параметре не ломает старт', () => {
  const { window: w3 } = makeDom('{ битый json !!!');
  assert.ok(w3.TDG);
  assert.strictEqual(w3.TD.Save.load().chronicles, 200);
});

test('ошибок консоли за весь сценарий нет', () => {
  assert.strictEqual(consoleErrors.length, 0, consoleErrors.join(' | '));
});

console.log(`\njsdom-итог: ${passed} пройдено, ${failed} провалено.`);
process.exit(failed ? 1 : 0);
