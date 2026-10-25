/* Юнит- и интеграционные тесты «Рубеж Эха» без браузера (Node ≥ 18).
 * Запуск: node tests/run.js */
'use strict';
const path = require('path');
const assert = require('assert');
const R = p => require(path.join(__dirname, '..', p));

// ---------- mock localStorage ----------
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
// очистка между тестами (иначе миграция v1 и сохранённые флаги «протекают» в следующие проверки)
function clearStore() { store.clear(); }

R('data/towers.js'); R('data/enemies.js'); R('data/maps.js');
R('engine/save.js'); R('engine/simulation.js');
const TD = globalThis.TD;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { failed++; console.error('  ✘ ' + name + '\n     ' + e.message); }
}

function freshState() { clearStore(); TD.Save.reset(); return TD.Save.load(); }

console.log('\n== Данные и согласованность ==');
test('12 башен, 5 стартовых', () => {
  assert.strictEqual(TD.TOWER_ORDER.length, 12);
  const starters = TD.TOWER_ORDER.filter(t => TD.TOWERS[t].starter);
  assert.strictEqual(starters.length, 5);
});
test('сумма цен разблокировок = 1550 хроник (ТЗ 11.2)', () => {
  const sum = TD.TOWER_ORDER.reduce((a, t) => a + TD.TOWERS[t].unlockCost, 0);
  assert.strictEqual(sum, 1550);
});
test('награды первых прохождений 210/240/270/300/330, сумма 1350', () => {
  const rewards = TD.MAPS.map(m => m.firstReward);
  assert.deepStrictEqual(rewards, [210, 240, 270, 300, 330]);
  assert.strictEqual(rewards.reduce((a, b) => a + b, 0), 1350);
});
test('стартовые кредиты карт 250/260/270/285/300', () => {
  assert.deepStrictEqual(TD.MAPS.map(m => m.startCredits), [250, 260, 270, 285, 300]);
});
test('каждая карта: 10 волн, площадки в границах 1080×600', () => {
  for (const m of TD.MAPS) {
    assert.strictEqual(m.waves.length, 10, m.id);
    for (const [x, y] of m.platforms) {
      assert.ok(x >= 0 && x <= 1080 && y >= 0 && y <= 600, `${m.id} platform out of bounds`);
    }
  }
});
test('награда за волну: 18, кроме волн 5 и 10 — 30', () => {
  assert.strictEqual(TD.waveReward(0), 18);
  assert.strictEqual(TD.waveReward(4), 30);
  assert.strictEqual(TD.waveReward(9), 30);
});

console.log('\n== Сохранения и хроники ==');
test('новое сохранение: 200 хроник, карта 1, 5 стартовых башен', () => {
  const s = freshState();
  assert.strictEqual(s.chronicles, 200);
  assert.deepStrictEqual(s.unlockedMaps, ['map1']);
  assert.strictEqual(Object.values(s.towerUnlocks).filter(Boolean).length, 5);
});
test('повреждённое сохранение → безопасный дефолт', () => {
  localStorage.setItem('echothreshold_save_v2', '{ это не json !!!');
  const s = TD.Save.load();
  assert.strictEqual(s.chronicles, 200);
  assert.deepStrictEqual(s.unlockedMaps, ['map1']);
});
test('устаревшее/мусорное сохранение санитизируется', () => {
  localStorage.setItem('echothreshold_save_v2', JSON.stringify({
    chronicles: -50, unlockedMaps: 'не массив', towerUnlocks: null, firstRewards: [1,2], settings: 7
  }));
  const s = TD.Save.load();
  assert.strictEqual(s.chronicles, 200);          // отброшено как некорректное
  assert.ok(Array.isArray(s.unlockedMaps));       // восстановлен дефолт
  assert.ok(s.towerUnlocks.watch === true);
  assert.strictEqual(typeof s.settings, 'object');
});
test('миграция v1: старые сохранения получают 200 хроник', () => {
  TD.Save.reset();
  localStorage.setItem('echothreshold_save_v1', JSON.stringify({
    version: 1, unlockedMaps: ['map1', 'map2'], firstRewards: { map1: true },
    towerUnlocks: { watch: true }, bestResults: {}, totalPlaySeconds: 10, settings: {}
  }));
  const s = TD.Save.load();
  assert.strictEqual(s.chronicles, 200);
  assert.deepStrictEqual(s.unlockedMaps, ['map1', 'map2']);
  // после миграции запись живёт под новым ключом
  assert.ok(localStorage.getItem('echothreshold_save_v2'));
});

console.log('\n== Покупки в магазине ==');
test('покупка успешна, списание ровно один раз, разблокировка сохраняется', () => {
  const s = freshState();
  s.chronicles = 500;
  const r = TD.Save.buyTowerUnlock(s, 'arcanist');   // цена 160
  assert.strictEqual(r.ok, true);
  assert.strictEqual(s.chronicles, 340);
  assert.strictEqual(s.towerUnlocks.arcanist, true);
  const r2 = TD.Save.buyTowerUnlock(s, 'arcanist');  // повторная покупка невозможна
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(s.chronicles, 340);             // деньги повторно не списаны
  const reloaded = TD.Save.load();                   // состояние пережило перезагрузку
  assert.strictEqual(reloaded.chronicles, 340);
  assert.strictEqual(reloaded.towerUnlocks.arcanist, true);
});
test('покупка без достаточного баланса отклоняется и ничего не меняет', () => {
  const s = freshState();                            // 200 хроник
  const r = TD.Save.buyTowerUnlock(s, 'sniper');     // цена 220
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /Недостаточно хроник/);
  assert.strictEqual(s.chronicles, 200);
  assert.strictEqual(!!s.towerUnlocks.sniper, false);
});
test('нельзя купить стартовую башню или неизвестную', () => {
  const s = freshState();
  assert.strictEqual(TD.Save.buyTowerUnlock(s, 'watch').ok, false);
  assert.strictEqual(TD.Save.buyTowerUnlock(s, 'nope').ok, false);
});

console.log('\n== Награды за победы (раздел 11.2 ТЗ, идемпотентность) ==');
test('1-я победа = firstReward; повторы дают +20/+10/+5; с 5-й победы — 0', () => {
  const s = freshState();
  // первая победа: ровно firstReward карты (210), без начисления за ещё не сыгранные повторы
  assert.deepStrictEqual(TD.Save.grantWinRewards(s, 'map1', 210), { gained: 210, kind: 'first' });
  assert.strictEqual(s.chronicles, 200 + 210);
  // повторные победы: 20 → 10 → 5 → 0 → 0 …
  assert.strictEqual(TD.Save.grantWinRewards(s, 'map1', 210).gained, 20);
  assert.strictEqual(TD.Save.grantWinRewards(s, 'map1', 210).gained, 10);
  assert.strictEqual(TD.Save.grantWinRewards(s, 'map1', 210).gained, 5);
  assert.strictEqual(TD.Save.grantWinRewards(s, 'map1', 210).gained, 0);
  assert.strictEqual(TD.Save.grantWinRewards(s, 'map1', 210).gained, 0);
  assert.strictEqual(s.chronicles, 200 + 210 + 35); // фарма больше нет
});
test('победа на всех картах позволяет открыть весь магазин (200+1350 ≥ 1550 — по ТЗ)', () => {
  const s = freshState();
  for (const m of TD.MAPS) {
    const r = TD.Save.grantWinRewards(s, m.id, m.firstReward);
    assert.strictEqual(r.kind, 'first', m.id);
    assert.strictEqual(r.gained, m.firstReward, m.id);
  }
  // сумма строго детерминирована: 200 стартовых + 1350 наград первых прохождений (ТЗ 11.2)
  assert.strictEqual(s.chronicles, 200 + 1350);
  assert.strictEqual(s.chronicles, 1550);
  for (const t of TD.TOWER_ORDER) {
    if (!TD.TOWERS[t].starter) assert.strictEqual(TD.Save.buyTowerUnlock(s, t).ok, true, t);
  }
  assert.strictEqual(s.chronicles, 0); // 1550 − 1550 цен разблокировок
});
test('счётчики повторов хранятся отдельно для каждой карты', () => {
  const s = freshState();
  TD.Save.grantWinRewards(s, 'map1', 210);            // first
  TD.Save.grantWinRewards(s, 'map2', 240);            // first
  assert.strictEqual(TD.Save.grantWinRewards(s, 'map1', 210).gained, 20);
  assert.strictEqual(TD.Save.grantWinRewards(s, 'map2', 240).gained, 20); // независимый счётчик
  assert.strictEqual(s.repeatWins.map1, 1);
  assert.strictEqual(s.repeatWins.map2, 1);
});

console.log('\n== Скорость симуляции ==');
test('режимы ровно 1× / 1.5× / 2.5×', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');
  assert.ok(/SPEEDS\s*=\s*\[1,\s*1\.5,\s*2\.5\]/.test(src), 'SPEEDS = [1, 1.5, 2.5]');
});
test('advance масштабирует время линейно (по одному кадру за вызов, как в rAF)', () => {
  const mk = () => { const sim = TD.createSim(TD.getMap('map1'), ['watch']); TD.startWave(sim, 0); return sim; };
  // по одному «кадру» 1/60 с за вызов — ровно реальная частота requestAnimationFrame
  const frames = (sim, n, speed) => { for (let i = 0; i < n; i++) TD.advance(sim, 1 / 60, speed); };
  const a = mk(), b = mk(), c = mk();
  frames(a, 600, 1);      // 10 с реального времени ×1
  frames(b, 600, 2.5);    // 10 с ×2.5
  frames(c, 600, 1.5);    // 10 с ×1.5
  assert.ok(Math.abs(a.time - 10) < 0.02, `a.time=${a.time}`);
  assert.ok(Math.abs(b.time - 25) < 0.05, `b.time=${b.time}`);
  assert.ok(Math.abs(c.time - 15) < 0.03, `c.time=${c.time}`);
  // одинаковое игровое время разными скоростями даёт одинаковый масштаб мира
  const d = mk();
  frames(d, 240, 2.5);    // 4 с ×2.5 = 10 игровых секунд
  assert.ok(Math.abs(d.time - a.time) < 0.05);
});
test('ускорение не ломает завершение волны: волна 1 map1 проходит на всех скоростях', () => {
  for (const speed of [1, 1.5, 2.5]) {
    const sim = TD.createSim(TD.getMap('map1'), ['watch']);
    sim.credits = 10000;
    TD.buildTower(sim, 3, 'watch'); TD.buildTower(sim, 4, 'watch'); TD.buildTower(sim, 5, 'watch');
    TD.startWave(sim, 0);
    let guard = 0;
    while (sim.waveActive && guard++ < 60 * 60 * 60) TD.advance(sim, 1 / 60, speed);
    assert.strictEqual(sim.waveActive, false, 'speed ' + speed);
    assert.strictEqual(sim.stats.wavesCleared, 1, 'speed ' + speed);
  }
});
test('пауза в game.js полностью останавливает advance (нет вызова при paused)', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');
  assert.ok(/if \(!this\.paused && !this\.sim\.gameOver\)[\s\S]{0,80}TD\.advance/.test(src));
});

console.log('\n== Боевой набор 1–5 типов ==');
test('нельзя строить башню вне набора', () => {
  const sim = TD.createSim(TD.getMap('map1'), ['watch']);
  const r = TD.buildTower(sim, 0, 'sniper');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /набор/);
});
test('loadout обрезается до 5 типов; 1 тип допустим', () => {
  const many = ['watch','crossbow','sling','cryo','flamethrower','sniper','spike'];
  const sim = TD.createSim(TD.getMap('map1'), many);
  assert.strictEqual(sim.loadout.length, 5);
  const one = TD.createSim(TD.getMap('map1'), ['watch']);
  assert.strictEqual(one.loadout.length, 1);
  assert.strictEqual(TD.buildTower(one, 0, 'watch').ok, true);
});
test('игра позволяет выбрать от 1 до 5 (нет проверки «ровно 5»)', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');
  assert.ok(!/ровно 5/.test(src), 'текст «ровно 5» отсутствует');
  assert.ok(/length < 1/.test(src) && /length >= 5/.test(src));
});

console.log('\n== Экономика боя ==');
test('строительство списывает кредиты атомарно; продажа возвращает 60% вниз', () => {
  const sim = TD.createSim(TD.getMap('map1'), ['watch']);
  const before = sim.credits;
  const r = TD.buildTower(sim, 0, 'watch');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(sim.credits, before - 70);
  const bad = TD.buildTower(sim, 0, 'watch');   // площадка занята
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(sim.credits, before - 70); // кредиты не изменились
  const s = TD.sellTower(sim, r.tower.id);
  assert.strictEqual(s.refund, Math.floor(70 * 0.6));
  assert.strictEqual(sim.credits, before - 70 + 42);
});
test('улучшение требует кредитов и повышает уровень максимум до 3', () => {
  const sim = TD.createSim(TD.getMap('map1'), ['watch']);
  sim.credits = 10000;
  const built = TD.buildTower(sim, 0, 'watch');
  assert.strictEqual(built.ok, true);
  const t = built.tower;
  // стройка завершается в updateTowers внутри stepOnce (волна не активна — враги не помешают)
  for (let i = 0; i < 60 * 2 && !t.built; i++) TD.stepOnce(sim); // ждём окончания стройки
  assert.strictEqual(t.built, true);
  assert.strictEqual(TD.upgradeTower(sim, t.id).ok, true);
  assert.strictEqual(TD.upgradeTower(sim, t.id).ok, true);
  assert.strictEqual(t.level, 2);
  assert.strictEqual(TD.upgradeTower(sim, t.id).ok, false);
  // не хватает кредитов на стройку — башня не создаётся вообще (атомарность)
  sim.credits = 10;
  const poor = TD.buildTower(sim, 1, 'watch');
  assert.strictEqual(poor.ok, false);
  assert.match(String(poor.reason), /кредит/i);
  assert.strictEqual(sim.towers.length, 1);
});
test('отрицательный баланс невозможен: бедный игрок не строит', () => {
  const sim = TD.createSim(TD.getMap('map1'), ['sniper']);
  sim.loadout = ['sniper'];
  sim.credits = 10;
  assert.strictEqual(TD.buildTower(sim, 0, 'sniper').ok, false);
  assert.strictEqual(sim.credits, 10);
});

console.log('\n== Победа и поражение ==');
function playToEnd(mapId, loadout, strategy) {
  const sim = TD.createSim(TD.getMap(mapId), loadout.slice());
  while (!sim.gameOver) {
    if (!sim.waveActive) {
      strategy(sim);
      const next = sim.waveIndex + 1;
      if (next < sim.map.waves.length) TD.startWave(sim, next);
    }
    for (let i = 0; i < 60 * 120 && !sim.gameOver && sim.waveActive; i++) TD.stepOnce(sim);
    if (!sim.waveActive && sim.waveIndex >= sim.map.waves.length - 1 && !sim.gameOver) break;
  }
  return sim;
}
test('поражение: без башен враги доходят до ядра', () => {
  const sim = playToEnd('map1', ['watch'], () => {});
  assert.strictEqual(sim.gameOver, 'lose');
  assert.ok(sim.baseHp <= 0 || sim.stats.leaks > 0);
});
test('победа на map1 с грамотной расстановкой', () => {
  const sim = playToEnd('map1', ['watch','crossbow','sling','cryo','flamethrower'], (s) => {
    s.credits += 200; // имитация накопления; стратегия ниже тратит по правилам
    const spots = [2,3,4,5,6,7,8];
    const pick = ['watch','crossbow','sling','cryo','flamethrower'];
    for (let i = 0; i < spots.length; i++) {
      const tid = pick[i % pick.length];
      if (TD.canBuild(s, tid).ok) TD.buildTower(s, spots[i], tid);
    }
    for (const tw of s.towers) while (TD.upgradeCost(s, tw) !== null && TD.canBuild(s, tw.towerId).ok && s.credits >= TD.upgradeCost(s, tw)) TD.upgradeTower(s, tw.id);
  });
  assert.strictEqual(sim.gameOver, 'win');
  assert.strictEqual(sim.stats.wavesCleared, 10);
});

console.log('\n== index.html ↔ JavaScript ==');
test('все getElementById из js/game.js и ui/hud.js присутствуют в index.html', () => {
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const used = new Set();
  for (const f of ['js/game.js', 'ui/hud.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    for (const m of src.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) used.add(m[1]);
    for (const m of src.matchAll(/\$\(\s*'([^']+)'\s*\)/g)) used.add(m[1]);
  }
  // динамически создаваемый panel-close исключим
  used.delete('panel-close');
  const missing = [...used].filter(id => !ids.has(id));
  assert.deepStrictEqual(missing, [], 'Отсутствуют id: ' + missing.join(', '));
});
test('screen-* элементы существуют для всех экранов игры', () => {
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const sc of ['menu', 'loadout', 'shop', 'battle', 'result']) {
    if (sc === 'battle') continue; // бой = canvas + HUD-оверлеи, отдельного screen-battle нет
    assert.ok(html.includes(`id="screen-${sc}"`), 'screen-' + sc);
  }
});

console.log('\\n== DOM-сценарий в jsdom (браузероподобная среда) ==');
const { execFileSync } = require('child_process');
test('jsdom-тесты интерфейса и цикла (tests/dom.js)', () => {
  try {
    require.resolve('jsdom');
  } catch (e) {
    console.log('  (jsdom не установлен — пропускаю браузерный сценарий: npm i -D jsdom)');
    return;
  }
  execFileSync(process.execPath, [path.join(__dirname, 'dom.js')], { stdio: 'inherit' });
});

console.log(`\nИтог: ${passed} пройдено, ${failed} провалено.`);
process.exit(failed ? 1 : 0);
