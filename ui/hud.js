/* "Рубеж Эха" — HUD, панель башен, контекстная подсказка (раздел 12 мастер-промпта). */
(function (root) {
  'use strict';
  const TD = root.TD;

  function $(id) { return document.getElementById(id); }

  class HUD {
    constructor(game) {
      this.game = game;
      this.el = {
        credits: $('hud-credits'),
        hp: $('hud-hp'),
        wave: $('hud-wave'),
        phase: $('hud-phase'),
        speedBtn: $('btn-speed'),
        pauseBtn: $('btn-pause'),
        targetBtn: $('btn-target'),
        towerPanel: $('tower-panel'),
        tooltip: $('tooltip'),
        toast: $('toast'),
        menuBtn: $('btn-menu')
      };
      this.targetNames = { first: 'Первый', strongest: 'Сильнейший', weakest: 'Слабейший', nearestExit: 'Ближе к выходу' };
      this._toastTimer = null;
    }

    refresh() {
      const g = this.game, sim = g.sim;
      if (!sim) return;
      this.el.credits.textContent = '₡ ' + sim.credits;
      this.el.hp.textContent = '♥ ' + sim.baseHp + '/20';
      this.el.wave.textContent = 'Волна ' + Math.max(1, sim.waveIndex + 1) + '/10';
      this.el.phase.textContent = sim.gameOver === 'win' ? 'Победа' : sim.gameOver === 'lose' ? 'Поражение'
        : sim.waveActive ? 'Фаза боя' : 'Фаза подготовки';
      this.el.speedBtn.textContent = g.speed + '×';
      this.el.pauseBtn.textContent = g.paused ? '▶ Продолжить' : '⏸ Пауза';
      this.el.targetBtn.textContent = 'Цель: ' + this.targetNames[sim.targetMode];
      this.renderTowerPanel();
    }

    renderTowerPanel() {
      const g = this.game, sim = g.sim;
      const panel = this.el.towerPanel;
      panel.innerHTML = '';
      if (!sim) return;
      if (g.selectedTower) {
        const tw = g.selectedTower;
        const tdef = TD.TOWERS[tw.towerId];
        const s = tdef.levels[tw.level];
        const head = document.createElement('div');
        head.className = 'panel-head';
        head.innerHTML = `<b>${tdef.name}</b> · ур. ${tw.level + 1}<span class="close" id="panel-close">✕</span>`;
        panel.appendChild(head);
        const stats = document.createElement('div');
        stats.className = 'panel-stats';
        stats.innerHTML = this.statsHtml(tdef, s);
        panel.appendChild(stats);
        const actions = document.createElement('div');
        actions.className = 'panel-actions';
        const upCost = TD.upgradeCost(sim, tw);
        const btnUp = document.createElement('button');
        btnUp.textContent = upCost === null ? 'Макс. уровень' : `Улучшить (${upCost}₡)`;
        btnUp.disabled = upCost === null || sim.credits < upCost || !!sim.gameOver;
        btnUp.onclick = () => { const r = TD.upgradeTower(sim, tw.id); if (!r.ok) this.toast(r.reason); g.refreshAll(); };
        const btnSell = document.createElement('button');
        btnSell.className = 'danger';
        const refund = TD.sellRefund(tw.towerId, tw.level);
        btnSell.textContent = `Продать (+${refund}₡)`;
        btnSell.onclick = () => { TD.sellTower(sim, tw.id); g.selectedTower = null; this.toast(`Продано: +${refund}₡`); g.refreshAll(); };
        actions.appendChild(btnUp); actions.appendChild(btnSell);
        panel.appendChild(actions);
        $('panel-close').onclick = () => { g.selectedTower = null; g.refreshAll(); };
      } else {
        const head = document.createElement('div');
        head.className = 'panel-head';
        head.innerHTML = '<b>Строительство</b>';
        panel.appendChild(head);
        for (const tid of sim.loadout) {
          const tdef = TD.TOWERS[tid];
          const s = tdef.levels[0];
          const card = document.createElement('div');
          card.className = 'tower-card' + (g.selectedTowerType === tid ? ' selected' : '') + (sim.credits < s.buildCost ? ' disabled' : '');
          card.innerHTML = `<div class="tc-name">${tdef.name}</div><div class="tc-cost">${s.buildCost}₡</div><div class="tc-desc">${tdef.role}</div>`;
          card.onmouseenter = () => this.showTowerTip(tdef, card);
          card.onmouseleave = () => this.hideTooltip();
          card.onclick = () => {
            if (sim.gameOver) return;
            g.selectedTowerType = g.selectedTowerType === tid ? null : tid;
            g.selectedTower = null;
            this.refresh();
          };
          panel.appendChild(card);
        }
        const hint = document.createElement('div');
        hint.className = 'panel-hint';
        hint.textContent = 'Выберите башню, затем свободную площадку на карте.';
        panel.appendChild(hint);
      }
    }

    statsHtml(tdef, s) {
      const rows = [];
      const dps = tdef.support ? null : (s.interval > 0 ? Math.round(s.damage / s.interval * 10) / 10 : null);
      if (tdef.support) {
        rows.push(['Аура радиуса', s.auraRadius]);
        rows.push(['Скор. атак союзникам', '+' + Math.round(s.attackSpeedBonus * 100) + '%']);
      } else if (tdef.mines) {
        rows.push(['Урон мины', s.damage]);
        rows.push(['Мин одновременно', s.maxMines]);
        rows.push(['Радиус поиска', s.radius]);
      } else {
        rows.push(['Урон', s.damage + ' (' + dmgTypeName(tdef.damageType) + ')']);
        rows.push(['Интервал', s.interval.toFixed(2) + ' с']);
        if (dps !== null) rows.push(['Номинальный DPS', dps]);
        rows.push(['Радиус', s.radius]);
        if (s.armorPen) rows.push(['Проник брони', s.armorPen]);
        if (s.splashRadius) rows.push(['Взрыв', s.splashRadius + ' · до ' + s.maxTargets]);
        if (s.slowPct) rows.push(['Замедление', Math.round(s.slowPct * 100) + '% · ' + s.slowDur + ' с']);
        if (s.burnDps) rows.push(['Горение', s.burnDps + '/с · ' + s.burnDur + ' с']);
        if (s.markBonus) rows.push(['Метка', '+' + Math.round(s.markBonus * 100) + '% маг. урона']);
        if (s.chainFactors) rows.push(['Цепь', 'до ' + s.maxTargets + ' целей']);
        if (s.bonusVsElite) rows.push(['Бонус по элите', '+' + Math.round(s.bonusVsElite * 100) + '%']);
        if (s.shredAmount) rows.push(['Снижение брони', s.shredAmount + ' ×' + s.shredMaxStacks]);
        rows.push(['Цели', tdef.targets === 'groundAir' ? 'земля+воздух' : 'только земля']);
      }
      return rows.map(r => `<div class="row"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('');
    }

    showTowerTip(tdef, anchor) {
      const tip = this.el.tooltip;
      const s = tdef.levels[0];
      tip.innerHTML = `<b>${tdef.name}</b><br>${tdef.role}<br>${tipMechanics(tdef)}<br><i>Стоимость: ${s.buildCost}₡</i>`;
      const rect = anchor.getBoundingClientRect();
      tip.style.left = Math.min(window.innerWidth - 280, rect.left) + 'px';
      tip.style.top = (rect.top - 8) + 'px';
      tip.classList.add('visible');
    }

    hideTooltip() { this.el.tooltip.classList.remove('visible'); }

    toast(text) {
      const t = this.el.toast;
      t.textContent = text;
      t.classList.add('visible');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => t.classList.remove('visible'), 2600);
    }
  }

  function dmgTypeName(t) {
    return { physical: 'физ.', magic: 'маг.', fire: 'огонь', acid: 'кислота', none: '—' }[t] || t;
  }

  function tipMechanics(tdef) {
    switch (tdef.id) {
      case 'watch': return 'Дешёвая башня для ранней обороны.';
      case 'crossbow': return 'Пробивает броню одиночных прочных целей.';
      case 'sling': return 'Взрыв по группе рядом с целью.';
      case 'cryo': return 'Не прерывает горение, эффективно против быстрых.';
      case 'flamethrower': return 'Держит цель в огне; неэффективен против воздуха.';
      case 'arcanist': return 'Метка усиливает весь входящий магический урон.';
      case 'thunder': return 'Цепляет ближайшие цели со снижением урона.';
      case 'sniper': return 'Очень дальний удар, бонус по элитам и боссам.';
      case 'spike': return 'Пробивает линию до N наземных врагов.';
      case 'obelisk': return 'Ускоряет все башни в ауре (берётся один лучший Обелиск).';
      case 'corroder': return 'Стаки снижения брони усиливают физ. урон группы.';
      case 'minefield': return 'Мины ставятся на ближайший маршрут; одна мина — один взрыв.';
      default: return '';
    }
  }

  root.TD = TD;
  TD.HUD = HUD;
})(typeof window !== 'undefined' ? window : globalThis);
