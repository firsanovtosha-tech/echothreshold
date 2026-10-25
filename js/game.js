/* "Рубеж Эха" — оркестратор: экраны, ввод, игровой цикл (разделы 11–14 мастер-промпта). */
(function (root) {
  'use strict';
  const TD = root.TD;
  const { TOWERS } = TD;

  const STARTER_TOWERS = ['watch', 'crossbow', 'sling', 'cryo', 'flamethrower'];
  const SPEEDS = [1, 1.5, 2.5]; // ровно три режима симуляции (раздел 4 ТЗ)

  class Game {
    constructor() {
      this.canvas = document.getElementById('game');
      this.ctx = this.canvas.getContext('2d');
      this.state = TD.Save.load();
      this.screen = 'menu';       // menu | loadout | shop | battle | result
      this.sim = null;
      this.speedIdx = 0;
      this.paused = false;
      this.selectedTowerType = null;
      this.selectedTower = null;
      this.hoverPlatform = null;
      this.ui = { fx: [], banner: null, shake: 0 };
      this.hud = null;
      this.lastFrame = 0;
      this.playSeconds = 0;
      this.currentLoadout = null;
      this.bindDom();
      this.showScreen('menu');
      requestAnimationFrame(t => this.loop(t));
    }

    get speed() { return SPEEDS[this.speedIdx]; }

    // ---------- DOM / экраны ----------
    bindDom() {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById('btn-start').onclick = () => { TD.Audio.play('ui'); this.openLoadout(); };
      document.getElementById('btn-open-shop').onclick = () => { TD.Audio.play('ui'); this.openShop(); };
      document.getElementById('btn-shop-back').onclick = () => { TD.Audio.play('ui'); this.showScreen('menu'); };
      document.getElementById('btn-reset-save').onclick = () => {
        if (confirm('Сбросить весь прогресс?')) {
          TD.Save.reset();
          try { root.localStorage.removeItem('echothreshold_save_v1'); } catch (e) { /* ignore */ }
          this.state = TD.Save.load();
          this.currentLoadout = null;
          this.renderMenu();
        }
      };
      document.getElementById('btn-back-menu').onclick = () => { TD.Audio.play('ui'); this.showScreen('menu'); };
      document.getElementById('btn-loadout-confirm').onclick = () => this.confirmLoadout();
      document.getElementById('btn-quit').onclick = () => { if (confirm('Покинуть бой? Прогресс боя будет потерян.')) this.endBattle(null); };
      document.getElementById('btn-menu').onclick = () => {
        TD.Audio.play('ui');
        if (this.screen === 'battle' && this.sim && !this.sim.gameOver) {
          if (confirm('Вернуться в меню? Текущий бой будет прерван без награды.')) this.endBattle(null);
        } else {
          this.showScreen('menu');
        }
      };
      document.getElementById('btn-wave').onclick = () => this.callWave();
      document.getElementById('btn-speed').onclick = () => {
        this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
        TD.Audio.play('ui'); this.hud && this.hud.refresh();
      };
      document.getElementById('btn-pause').onclick = () => { this.paused = !this.paused; TD.Audio.play('ui'); this.hud && this.hud.refresh(); };
      document.getElementById('btn-target').onclick = () => {
        if (!this.sim) return;
        const modes = ['first', 'strongest', 'weakest', 'nearestExit'];
        const i = modes.indexOf(this.sim.targetMode);
        this.sim.targetMode = modes[(i + 1) % modes.length];
        TD.Audio.play('ui'); this.hud.refresh();
      };
      document.getElementById('btn-result-next').onclick = () => {
        TD.Audio.play('ui');
        if (this.resultNext) this.resultNext(); else this.showScreen('menu');
      };
      document.getElementById('btn-result-retry').onclick = () => {
        TD.Audio.play('ui');
        this.startBattle(this.currentMapId, this.currentLoadout);
      };
      document.getElementById('btn-result-menu').onclick = () => { TD.Audio.play('ui'); this.showScreen('menu'); };
      document.getElementById('music-toggle').onclick = (e) => {
        const on = e.target.checked;
        if (on) TD.Audio.startMusic(); else TD.Audio.stopMusic();
        this.state.settings.musicVolume = on ? 0.5 : 0;
        TD.Save.save(this.state);
      };
      document.getElementById('sfx-volume').oninput = (e) => {
        const v = parseFloat(e.target.value);
        TD.Audio.setVolumes(this.state.settings.musicVolume, v);
        this.state.settings.sfxVolume = v; TD.Save.save(this.state);
      };
      // canvas input
      this.canvas.addEventListener('click', ev => this.onCanvasClick(ev));
      this.canvas.addEventListener('mousemove', ev => this.onCanvasMove(ev));
      this.canvas.addEventListener('contextmenu', ev => { ev.preventDefault(); this.cancelSelection(); });
      window.addEventListener('keydown', ev => {
        if (this.screen !== 'battle') return;
        if (ev.key === 'Escape') this.cancelSelection();
        if (ev.code === 'Space') { ev.preventDefault(); this.callWave(); }
        if (ev.key === 'p' || ev.key === 'P' || ev.key === 'з') this.paused = !this.paused;
        if (ev.key >= '1' && ev.key <= '5') {
          const idx = parseInt(ev.key, 10) - 1;
          if (this.sim && this.sim.loadout[idx]) {
            this.selectedTowerType = this.selectedTowerType === this.sim.loadout[idx] ? null : this.sim.loadout[idx];
            this.selectedTower = null; this.hud.refresh();
          }
        }
      });
      window.addEventListener('blur', () => { if (this.screen === 'battle') this.paused = true; });
      this.musicToggleInit();
    }

    musicToggleInit() {
      const cb = document.getElementById('music-toggle');
      cb.checked = this.state.settings.musicVolume > 0;
      document.getElementById('sfx-volume').value = this.state.settings.sfxVolume;
    }

    showScreen(name) {
      this.screen = name;
      document.body.classList.toggle('in-battle', name === 'battle');
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      const el = document.getElementById('screen-' + name); // для боя отдельного экрана нет — только HUD-оверлеи
      if (el) el.classList.add('active');
      if (name === 'menu') this.renderMenu();
      if (name === 'shop') this.renderShop();
    }

    renderMenu() {
      const list = document.getElementById('map-list');
      list.innerHTML = '';
      for (const m of TD.MAPS) {
        const unlocked = TD.Save.isMapUnlocked(this.state, m.id);
        const card = document.createElement('div');
        card.className = 'map-card' + (unlocked ? '' : ' locked');
        const best = this.state.bestResults[m.id];
        card.innerHTML = `
          <div class="mc-name">${m.name}</div>
          <div class="mc-threat">${m.threat}</div>
          <div class="mc-meta">Стартовые кредиты: ${m.startCredits} · Награда за 1-е прохождение: ${m.firstReward} ⟡</div>
          ${best ? `<div class="mc-best">Лучший результат: HP ${best.hp}/20 · ${best.timeSec} с</div>` : ''}
          ${unlocked ? '' : '<div class="mc-lock">🔒 Откроется после предыдущей карты</div>'}`;
        if (unlocked) card.onclick = () => { TD.Audio.play('ui'); this.openLoadout(m.id); };
        list.appendChild(card);
      }
      document.getElementById('total-playtime').textContent =
        'Всего наиграно: ' + Math.floor(this.state.totalPlaySeconds / 60) + ' мин ' + (this.state.totalPlaySeconds % 60) + ' с';
      document.getElementById('menu-chronicles').textContent = '⟡ ' + this.state.chronicles + ' хроник';
    }

    openLoadout(preferMap) {
      this.currentMapId = preferMap || this.state.unlockedMaps[this.state.unlockedMaps.length - 1];
      this.showScreen('loadout');
      document.getElementById('loadout-map-title').textContent = TD.getMap(this.currentMapId).name;
      this.renderMapSelect();
      this.renderLoadout();
    }

    renderMapSelect() {
      const sel = document.getElementById('loadout-maps');
      sel.innerHTML = '';
      for (const m of TD.MAPS) {
        if (!TD.Save.isMapUnlocked(this.state, m.id)) continue;
        const opt = document.createElement('option');
        opt.value = m.id; opt.textContent = m.name;
        if (m.id === this.currentMapId) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.onchange = () => { this.currentMapId = sel.value; this.renderLoadout(); };
    }

    isUnlocked(tid) { return !!this.state.towerUnlocks[tid]; }

    renderLoadout() {
      const grid = document.getElementById('tower-grid');
      grid.innerHTML = '';
      // по умолчанию — все пять стартовых типов
      if (!Array.isArray(this.currentLoadout)) this.currentLoadout = STARTER_TOWERS.slice();
      this.currentLoadout = this.currentLoadout.filter(t => TOWERS[t] && this.isUnlocked(t)).slice(0, 5);
      const mapDef = TD.getMap(this.currentMapId);
      document.getElementById('loadout-map-desc').textContent = mapDef.mechanicDesc || '';
      for (const tid of TD.TOWER_ORDER) {
        const tdef = TOWERS[tid];
        const selected = this.currentLoadout.includes(tid);
        const unlockedGlobally = this.isUnlocked(tid);
        const card = document.createElement('div');
        card.className = 'lg-card' + (selected ? ' selected' : '') + (!unlockedGlobally ? ' locked' : '');
        const l0 = tdef.levels[0], l1 = tdef.levels[1], l2 = tdef.levels[2];
        card.innerHTML = `<div class="lg-name">${tdef.name}</div>
          <div class="lg-cost">${unlockedGlobally ? (tdef.starter ? 'стартовая' : 'открыта') : '🔒 ' + tdef.unlockCost + ' ⟡'}</div>
          <div class="lg-role">${tdef.role}</div>
          <div class="lg-stats">Постройка: <b>${l0.buildCost}₡</b> · Улучш. I: <b>${l1.upgradeCost}₡</b> · Улучш. II: <b>${l2.upgradeCost}₡</b><br>
          ${tdef.support ? `аура +${Math.round(l0.attackSpeedBonus * 100)}% / +${Math.round(l2.attackSpeedBonus * 100)}%`
            : tdef.mines ? `урон мины ${l0.damage}→${l2.damage}, мин ${l0.maxMines}→${l2.maxMines}`
            : `урон ${l0.damage}→${l1.damage}→${l2.damage} · радиус ${l0.radius}→${l2.radius}${tdef.targets === 'ground' ? ' · только земля' : ' · земля+воздух'}`}
          </div>
          ${unlockedGlobally ? '' : '<div class="lg-buy">Купите в магазине за хроники</div>'}`;
        card.onclick = () => {
          if (!unlockedGlobally) { this.toastLoadout('Башня не открыта. Купите её в магазине за хроники.'); TD.Audio.play('error'); return; }
          if (selected) {
            this.currentLoadout = this.currentLoadout.filter(x => x !== tid);
          } else {
            if (this.currentLoadout.length >= 5) { this.toastLoadout('Можно выбрать не более 5 типов башен.'); TD.Audio.play('error'); return; }
            this.currentLoadout.push(tid);
          }
          TD.Audio.play('ui');
          this.renderLoadout();
        };
        grid.appendChild(card);
      }
      document.getElementById('loadout-count').textContent = this.currentLoadout.length + '/5';
    }

    toastLoadout(text) {
      const el = document.getElementById('loadout-toast');
      el.textContent = text;
      clearTimeout(this._loToastT);
      this._loToastT = setTimeout(() => { el.textContent = ''; }, 2200);
    }

    confirmLoadout() {
      if (this.currentLoadout.length < 1) { this.toastLoadout('Выберите хотя бы один тип башни.'); return; }
      if (this.currentLoadout.length > 5) { this.toastLoadout('Нельзя выбрать больше 5 типов башен.'); return; }
      TD.Audio.play('ui');
      this.startBattle(this.currentMapId, this.currentLoadout.slice());
    }

    // ---------- магазин хроник ----------
    openShop() { this.showScreen('shop'); }

    renderShop() {
      document.getElementById('shop-chronicles').textContent = '⟡ ' + this.state.chronicles;
      const grid = document.getElementById('shop-grid');
      grid.innerHTML = '';
      for (const tid of TD.TOWER_ORDER) {
        const tdef = TOWERS[tid];
        const unlocked = this.isUnlocked(tid);
        const l0 = tdef.levels[0], l1 = tdef.levels[1], l2 = tdef.levels[2];
        const affordable = this.state.chronicles >= tdef.unlockCost;
        const card = document.createElement('div');
        card.className = 'lg-card' + (unlocked ? ' owned' : (affordable ? '' : ' poor'));
        let statsLine;
        if (tdef.support) statsLine = `Не атакует. Аура: +${Math.round(l0.attackSpeedBonus * 100)}% / +${Math.round(l1.attackSpeedBonus * 100)}% / +${Math.round(l2.attackSpeedBonus * 100)}% скорости атак.`;
        else if (tdef.mines) statsLine = `Мины: урон ${l0.damage}/${l1.damage}/${l2.damage}, до ${l0.maxMines}/${l2.maxMines} активных.`;
        else statsLine = `Урон ${l0.damage} → ${l1.damage} → ${l2.damage}; интервал ${l0.interval.toFixed(2)} с; радиус ${l0.radius} → ${l2.radius}.`;
        card.innerHTML = `<div class="lg-name">${tdef.name}</div>
          <div class="lg-role">${tdef.role}</div>
          <div class="lg-stats">${statsLine}<br>Строительство ${l0.buildCost}₡ · улучш. ${l1.upgradeCost}₡ и ${l2.upgradeCost}₡.</div>
          <div class="lg-cost">${tdef.starter ? 'Стартовая — бесплатно' : unlocked ? '✓ Открыта' : tdef.unlockCost + ' ⟡'}</div>`;
        if (!unlocked) {
          const btn = document.createElement('button');
          btn.textContent = affordable ? 'Купить' : 'Мало хроник';
          btn.disabled = !affordable;
          btn.className = 'primary lg-btn';
          btn.onclick = (e) => {
            e.stopPropagation();
            const r = TD.Save.buyTowerUnlock(this.state, tid);
            if (r.ok) { TD.Audio.play('coin'); this.toastShop(`${tdef.name} открыта! Осталось ⟡ ${r.remaining}.`); }
            else { TD.Audio.play('error'); this.toastShop(r.reason); }
            this.renderShop();
          };
          card.appendChild(btn);
        }
        grid.appendChild(card);
      }
    }

    toastShop(text) {
      const el = document.getElementById('shop-toast');
      el.textContent = text;
      clearTimeout(this._shopToastT);
      this._shopToastT = setTimeout(() => { el.textContent = ''; }, 2600);
    }

    // ---------- бой ----------
    startBattle(mapId, loadout) {
      const mapDef = TD.getMap(mapId);
      const valid = (loadout || []).filter(t => TOWERS[t] && this.isUnlocked(t)).slice(0, 5);
      if (valid.length < 1) { this.toastLoadout('Набор пуст или содержит закрытые башни.'); this.openLoadout(mapId); return; }
      this.sim = TD.createSim(mapDef, valid);
      this.sim.loadout = valid.slice();
      this.currentMapId = mapId; this.currentLoadout = valid.slice();
      this.speedIdx = 0; this.paused = false;
      this.selectedTower = null; this.selectedTowerType = null;
      this.ui.fx = []; this.ui.banner = null; this.ui.shake = 0;
      this._endScheduled = false;
      this.battleStartWall = Date.now();
      this.showScreen('battle');
      document.getElementById('battle-map-name').textContent = mapDef.name;
      if (!this.hud) this.hud = new TD.HUD(this);
      this.hud.refresh();
      if (this.state.settings.musicVolume > 0) TD.Audio.startMusic();
    }

    callWave() {
      const sim = this.sim;
      if (!sim || sim.gameOver) return;
      if (this.paused) return; // на паузе вызов волны игнорируется
      if (sim.waveActive) { this.hud && this.hud.toast('Волна уже идёт!'); return; }
      const next = sim.waveIndex + 1;
      if (next >= sim.map.waves.length) return;
      const r = TD.startWave(sim, next);
      if (r.ok) { TD.Audio.play('wave'); this.hud && this.hud.refresh(); }
    }

    cancelSelection() {
      this.selectedTowerType = null; this.selectedTower = null;
      this.hud && this.hud.refresh();
    }

    canvasCoords(ev) {
      const rect = this.canvas.getBoundingClientRect();
      const x = (ev.clientX - rect.left) * (TD.Render.W / rect.width);
      const y = (ev.clientY - rect.top) * (TD.Render.H / rect.height);
      return [x, y];
    }

    platformAt(x, y) {
      const sim = this.sim;
      for (let i = 0; i < sim.platforms.length; i++) {
        const pf = sim.platforms[i];
        if (Math.hypot(pf.x - x, pf.y - y) <= 24) return i;
      }
      return null;
    }

    towerAt(x, y) {
      const sim = this.sim;
      for (const tw of sim.towers) if (Math.hypot(tw.x - x, tw.y - y) <= 22) return tw;
      return null;
    }

    onCanvasMove(ev) {
      if (!this.sim) return;
      const [x, y] = this.canvasCoords(ev);
      const pi = this.platformAt(x, y);
      if (pi !== this.hoverPlatform) this.hoverPlatform = pi;
    }

    onCanvasClick(ev) {
      const sim = this.sim;
      if (!sim || sim.gameOver) return;
      const [x, y] = this.canvasCoords(ev);
      const pi = this.platformAt(x, y);
      if (pi !== null) {
        const pf = sim.platforms[pi];
        if (pf.towerId === null && this.selectedTowerType) {
          const r = TD.buildTower(sim, pi, this.selectedTowerType);
          if (r.ok) {
            TD.Audio.play('build');
            this.selectedTower = r.tower;
            this.selectedTowerType = null;
            this.hud.refresh();
          } else { TD.Audio.play('error'); this.hud.toast(r.reason); }
          return;
        }
        if (typeof pf.towerId === 'string' && pf.towerId.startsWith('t_')) {
          const tw = sim.towers.find(t => t.id === pf.towerId);
          if (tw) { this.selectedTower = tw; this.selectedTowerType = null; TD.Audio.play('ui'); this.hud.refresh(); }
          return;
        }
      }
      const tw = this.towerAt(x, y);
      if (tw) { this.selectedTower = tw; this.selectedTowerType = null; TD.Audio.play('ui'); this.hud.refresh(); return; }
      this.selectedTower = null;
      this.hud.refresh();
    }

    endBattle(result) {
      const sim = this.sim;
      const played = Math.round((Date.now() - this.battleStartWall) / 1000);
      this.state.totalPlaySeconds += played;
      let win = result === 'win' || (sim && sim.gameOver === 'win');
      let lose = result === 'lose' || (sim && sim.gameOver === 'lose');
      this.lastReward = 0;
      if (win) {
        // идемпотентная выдача хроник: флаг firstRewards/счётчик repeatWins обновляются до сохранения
        const rw = TD.Save.grantWinRewards(this.state, sim.map.id, sim.map.firstReward);
        this.lastReward = rw && typeof rw === 'object' ? rw.gained : (rw || 0);
        TD.Save.unlockNextMap(this.state, sim.map.id);
        TD.Save.recordResult(this.state, sim.map.id, { hp: sim.baseHp, timeSec: Math.round(sim.time), wavesCleared: sim.stats.wavesCleared });
      }
      TD.Save.save(this.state);
      this.showScreen('result');
      this.renderResult(win, lose, played);
    }

    refreshAll() {
      this.hud && this.hud.refresh();
    }

    renderResult(win, lose, playedSec) {
      const title = document.getElementById('result-title');
      const body = document.getElementById('result-body');
      const sim = this.sim;
      if (win) {
        title.textContent = 'Победа!';
        TD.Audio.play('win');
        const nm = nextMapId(sim.map.id);
        this.resultNext = nm && TD.Save.isMapUnlocked(this.state, nm) ? () => this.startBattle(nm, this.currentLoadout) : null;
        document.getElementById('btn-result-next').style.display = this.resultNext ? '' : 'none';
        document.getElementById('btn-result-next').textContent = 'Следующая карта';
      } else if (lose) {
        title.textContent = 'Поражение';
        TD.Audio.play('lose');
        document.getElementById('btn-result-next').style.display = 'none';
        this.resultNext = null;
      } else {
        title.textContent = 'Бой прерван';
        document.getElementById('btn-result-next').style.display = 'none';
        this.resultNext = null;
      }
      body.innerHTML = sim ? `
        <div>Волн очищено: <b>${sim.stats.wavesCleared}/10</b></div>
        <div>HP ядра: <b>${sim.baseHp}/20</b> (потеряно ${20 - sim.baseHp})</div>
        <div>Убийств: <b>${sim.stats.kills}</b> · Прорывов: <b>${sim.stats.leaks}</b></div>
        <div>Награда с врагов: <b>${sim.stats.killRewardTotal}₡</b>${win ? (this.lastReward ? ` · Получено хроник: <b>+${this.lastReward} ⟡</b>` : ' · Повторная победа без награды') : ''}</div>
        <div>Хроники сейчас: <b>⟡ ${this.state.chronicles}</b></div>
        <div>Время боя: <b>${playedSec} с</b></div>` : '';
      this.sim = sim; // держим для рендера фона
    }

    // ---------- цикл ----------
    loop(ts) {
      const dt = Math.min(0.25, (ts - this.lastFrame) / 1000 || 0);
      this.lastFrame = ts;
      if (this.screen === 'battle' && this.sim) {
        if (!this.paused && !this.sim.gameOver) {
          TD.advance(this.sim, dt, this.speed);
          TD.Render.drainEventsIntoFx(this.sim, this.ui);
          this.processAudioEvents();
          // события конца боя
          if (this.sim.gameOver && !this._endScheduled) {
            this._endScheduled = true;
            setTimeout(() => { this._endScheduled = false; this.endBattle(this.sim.gameOver); }, 900);
          }
        } else {
          TD.Render.drainEventsIntoFx(this.sim, this.ui);
        }
        TD.Render.updateFx(this.ui, dt);
        TD.Render.drawFrame(this.ctx, this.sim, this.ui);
        this.tickHud();
      } else if (this.screen === 'menu' || this.screen === 'loadout' || this.screen === 'shop' || this.screen === 'result') {
        // лёгкий фон без симуляции
        this.ctx.clearRect(0, 0, TD.Render.W, TD.Render.H);
      }
      requestAnimationFrame(t => this.loop(t));
    }

    processAudioEvents() {
      // эффекты уже забраны в ui.fx; звук привязываем к свежим fx
      for (const f of this.ui.fx) {
        if (f._a) continue; f._a = true;
        switch (f.kind) {
          case 'ring': if (f.color === 'mine' || f.color === 'sling' || f.color === 'spark') TD.Audio.play('boom'); break;
          case 'leak': TD.Audio.play('leak'); this.ui.shake = this.state.settings.screenShake ? 8 : 0; break;
          case 'text': if (f.color === '#ffd76a') TD.Audio.play('coin'); break;
          case 'laser': TD.Audio.play('shoot'); break;
        }
      }
    }

    _hudTick = 0;
    tickHud() {
      this._hudTick++;
      if (this._hudTick % 6 === 0) this.hud.refresh();
    }
  }

  function nextMapId(id) {
    const i = TD.MAPS.findIndex(m => m.id === id);
    return i >= 0 && i + 1 < TD.MAPS.length ? TD.MAPS[i + 1].id : null;
  }

  root.addEventListener('DOMContentLoaded', () => { root.TDG = new Game(); });
  root.TD.Game = Game;
  root.TD.SPEEDS = SPEEDS;
  root.TD.STARTER_TOWERS = STARTER_TOWERS;
})(window);
