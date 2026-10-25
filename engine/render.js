/* "Рубеж Эха" — canvas-рендер (раздел 12 мастер-промпта).
 * Логическое разрешение 1080×600; CSS-масштабирование сохраняет пропорции. */
(function (root) {
  'use strict';
  const TD = root.TD;
  const { TOWERS } = TD;

  const W = 1080, H = 600;

  // палитра по ролям и картам
  const MAP_PALETTES = {
    map1: { bg: '#10231b', path: '#274a38', edge: '#3f6d52', plat: '#1d3a2c', accent: '#7fd6a3' },
    map2: { bg: '#1c1712', path: '#4a3a26', edge: '#7a5c39', plat: '#33281d', accent: '#e0a458' },
    map3: { bg: '#132013', path: '#31502f', edge: '#527a4b', plat: '#22381f', accent: '#9ede7f' },
    map4: { bg: '#1b1e26', path: '#3d4657', edge: '#6b7a94', plat: '#282e3a', accent: '#bcd4ff' },
    map5: { bg: '#201a1e', path: '#46393f', edge: '#6f5a63', plat: '#31272c', accent: '#e08fb0' }
  };

  const ENEMY_COLORS = {
    walker: '#8fae70', runner: '#c7e06a', armored: '#7d8ea3', shieldbearer: '#9db4c8',
    flyer: '#b09de0', healer: '#7fe0b8', splitter: '#c08b5a', phaser: '#6fd0d8', titan: '#5c6b7a', shard: '#d8b06a',
    slime: '#6ac46a', spore: '#b5d86a', fogger: '#8fb8c9', youngqueen: '#4fae72', mossqueen: '#2f8f5b',
    sparkbug: '#ffd35a', marshal: '#9aa8b8', drill: '#b0713c', rivetgeneral: '#c94f3d', rivetcommander: '#d97a4a',
    leafwing: '#7fd06a', rootling: '#7a5a3c', pollen: '#e8d44f', oldtrunk: '#5a7a4a', forkguard: '#6a9a5a', rootguard: '#8a6a4a',
    leaper: '#d8d8e8', solemorph: '#c8c0d8', saltcolossus: '#aab4cc', zerosalt: '#e0e4f0', saltguard: '#c0cadf',
    ashdouble: '#b0a0a8', graviton: '#8a7a9a', cometbug: '#e0b070', asharchivist: '#9a6a7a', ashcentury: '#a88a94'
  };

  function drawFrame(ctx, sim, ui) {
    const pal = MAP_PALETTES[sim.map.id] || MAP_PALETTES.map1;
    ctx.save();
    // тряска экрана
    if (ui.shake > 0) {
      const a = Math.random() * Math.PI * 2;
      ctx.translate(Math.cos(a) * ui.shake, Math.sin(a) * ui.shake);
    }
    // фон
    ctx.fillStyle = pal.bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    drawDecor(ctx, sim, pal);
    drawPaths(ctx, sim, pal);
    drawMechanic(ctx, sim, ui);
    drawPlatforms(ctx, sim, pal, ui);
    drawBase(ctx, sim);
    drawMines(ctx, sim);
    drawTowers(ctx, sim, ui);
    drawEnemies(ctx, sim, ui);
    drawProjectiles(ctx, sim);
    drawEffects(ctx, sim, ui);
    drawFloatingTexts(ctx, ui);
    drawPlacementGhost(ctx, sim, ui);
    drawRangePreview(ctx, sim, ui);
    ctx.restore();
  }

  function drawDecor(ctx, sim, pal) {
    // мягкие пятна декораций, стабильные для каждой карты (по seed из id)
    ctx.globalAlpha = 0.10;
    let s = 0;
    for (const ch of sim.map.id) s += ch.charCodeAt(0);
    for (let i = 0; i < 26; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const x = (s % W), y = ((s >> 8) % H);
      ctx.fillStyle = i % 2 ? pal.edge : pal.accent;
      ctx.beginPath(); ctx.arc(x, y, 14 + (s % 30), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (sim.map.mechanic === 'nodes') {
      // гравитационные узлы (декорация)
      for (const [x, y] of [[540, 300], [850, 290]]) {
        ctx.strokeStyle = 'rgba(160,140,200,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  function strokeRoute(ctx, pts, width, color) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }

  function drawPaths(ctx, sim, pal) {
    for (const r of sim.routes) {
      strokeRoute(ctx, r.pts, 46, pal.edge);
      strokeRoute(ctx, r.pts, 38, pal.path);
    }
    // стрелки направления
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (const r of sim.routes) {
      for (let d = 60; d < r.length - 40; d += 120) {
        const p = TD.pointAt(r.pts, d), q = TD.pointAt(r.pts, d + 6);
        const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
        ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawMechanic(ctx, sim, ui) {
    if (sim.map.mechanic === 'rift') {
      const zones = sim.map.riftZones;
      for (const r of sim.routes) {
        for (let zi = 0; zi < zones.length; zi++) {
          const z = zones[zi];
          const a = TD.pointAt(r.pts, r.length * z.from);
          const b = TD.pointAt(r.pts, r.length * z.to);
          const active = sim.riftActiveZone === zi;
          ctx.strokeStyle = active ? (sim.riftBoostT > 0 ? 'rgba(230,240,255,0.85)' : 'rgba(230,240,255,0.45)') : 'rgba(150,170,210,0.25)';
          ctx.lineWidth = active ? 44 : 34;
          ctx.setLineDash([14, 10]);
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }

  function drawPlatforms(ctx, sim, pal, ui) {
    for (const pf of sim.platforms) {
      const occupied = pf.towerId !== null;
      const free = !occupied;
      ctx.save();
      ctx.translate(pf.x, pf.y);
      ctx.fillStyle = pal.plat;
      ctx.strokeStyle = free && ui.selectedTowerType ? pal.accent : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = free && ui.selectedTowerType ? 3 : 2;
      roundRect(ctx, -20, -20, 40, 40, 8);
      ctx.fill(); ctx.stroke();
      if (free) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.moveTo(0, -6); ctx.lineTo(0, 6); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawBase(ctx, sim) {
    // ядро у выхода каждого маршрута
    for (const r of sim.routes) {
      const end = r.pts[r.pts.length - 1];
      const pulse = 0.6 + 0.4 * Math.sin(sim.time * 3);
      ctx.fillStyle = `rgba(120,220,255,${0.25 * pulse})`;
      ctx.beginPath(); ctx.arc(end[0] - 14, end[1], 26, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#7fdcff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(end[0] - 14, end[1], 16, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#bff0ff';
      ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillText('ЯДРО ' + sim.baseHp, end[0] - 14, end[1] + 34);
    }
    // вход
    const start = sim.routes[0].pts[0];
    ctx.fillStyle = 'rgba(255,120,120,0.8)';
    ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left';
    ctx.fillText('ВХОД', Math.max(4, start[0]), start[1] - 28);
  }

  // ---------- башни ----------
  const TOWER_GLYPHS = {
    watch: c => { c.moveTo(0, -10); c.lineTo(8, 8); c.lineTo(-8, 8); c.closePath(); },
    crossbow: c => { c.moveTo(-9, -6); c.lineTo(9, -6); c.moveTo(0, -9); c.lineTo(0, 8); c.moveTo(-6, 8); c.lineTo(6, 8); },
    sling: c => { c.arc(0, 0, 8, 0, Math.PI * 2); c.moveTo(0, 0); c.lineTo(6, -8); },
    cryo: c => { for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; c.moveTo(0, 0); c.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); } },
    flame: c => { c.moveTo(-6, 8); c.quadraticCurveTo(0, -2, -2, -8); c.quadraticCurveTo(4, -2, 6, 8); c.closePath(); },
    arcanist: c => { c.moveTo(0, -9); c.lineTo(7, 0); c.lineTo(0, 9); c.lineTo(-7, 0); c.closePath(); },
    thunder: c => { c.moveTo(2, -9); c.lineTo(-5, 1); c.lineTo(0, 1); c.lineTo(-2, 9); c.lineTo(5, -1); c.lineTo(0, -1); c.closePath(); },
    sniper: c => { c.arc(0, 0, 8, 0, Math.PI * 2); c.moveTo(0, -11); c.lineTo(0, 11); c.moveTo(-11, 0); c.lineTo(11, 0); },
    spike: c => { c.moveTo(-9, 6); c.lineTo(-3, -8); c.lineTo(3, 6); c.moveTo(3, 6); c.lineTo(9, -4); },
    obelisk: c => { c.moveTo(0, -11); c.lineTo(6, 8); c.lineTo(-6, 8); c.closePath(); c.moveTo(0, -4); c.lineTo(0, 4); },
    corroder: c => { c.arc(0, 2, 7, 0, Math.PI * 2); c.moveTo(-4, -6); c.lineTo(-2, -2); c.moveTo(4, -6); c.lineTo(2, -2); },
    mine: c => { c.arc(0, 0, 6, 0, Math.PI * 2); c.moveTo(0, -9); c.lineTo(0, -6); c.moveTo(0, 6); c.lineTo(0, 9); c.moveTo(-9, 0); c.lineTo(-6, 0); c.moveTo(6, 0); c.lineTo(9, 0); }
  };

  function towerColor(tdef) {
    switch (tdef.damageType) {
      case 'fire': return '#ff8c42';
      case 'magic': return '#b48ce0';
      case 'acid': return '#9ade4f';
      default: return '#e8dcc0';
    }
  }

  function drawTowers(ctx, sim, ui) {
    for (const tw of sim.towers) {
      const tdef = TOWERS[tw.towerId];
      const col = tdef.support ? '#8fd8ff' : towerColor(tdef);
      ctx.save();
      ctx.translate(tw.x, tw.y);
      if (!tw.built) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        roundRect(ctx, -14, -14, 28, 28, 6); ctx.stroke();
        ctx.fillStyle = col;
        ctx.fillRect(-14, 16, 28 * (1 - tw.cooldown / TD.BUILD_TIME), 3);
        ctx.restore(); continue;
      }
      // подсветка выбранной
      if (ui.selectedTower && ui.selectedTower.id === tw.id) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.stroke();
      }
      // дебаффы
      if (tw.suppressUntil && tw.suppressUntil > sim.time) {
        ctx.strokeStyle = 'rgba(255,80,80,0.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.stroke();
      }
      // корпус
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(0, 4, 13, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(tw.angle + Math.PI / 2);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.fillStyle = 'rgba(20,24,28,0.9)';
      roundRect(ctx, -11, -11, 22, 22, 5); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      const glyph = TOWER_GLYPHS[tdef.icon] || TOWER_GLYPHS.watch;
      glyph(ctx);
      ctx.stroke();
      ctx.rotate(-(tw.angle + Math.PI / 2));
      // уровни
      ctx.fillStyle = '#ffd76a';
      for (let i = 0; i < tw.level; i++) {
        ctx.beginPath(); ctx.arc(-8 + i * 8, 16, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  // ---------- враги ----------
  function enemyBodyPath(c, e, r) {
    const k = e.kindId;
    if (!e.ground) { // воздух: овал + крылья
      c.arc(0, 0, r, 0, Math.PI * 2);
      return;
    }
    if (e.bossFlag) { c.moveTo(0, -r); c.lineTo(r, -r / 2); c.lineTo(r, r / 2); c.lineTo(0, r); c.lineTo(-r, r / 2); c.lineTo(-r, -r / 2); c.closePath(); return; }
    if (e.eliteFlag) { c.rect(-r, -r, r * 2, r * 2); return; }
    if (k === 'runner' || k === 'cometbug' || k === 'leafwing') { c.moveTo(r, 0); c.lineTo(-r, -r * 0.8); c.lineTo(-r * 0.4, 0); c.lineTo(-r, r * 0.8); c.closePath(); return; }
    if (k === 'armored' || k === 'marshal' || k === 'drill' || k === 'titan') { c.rect(-r, -r, r * 2, r * 2); return; }
    if (k === 'slime' || k === 'shard') { c.arc(0, r * 0.2, r, Math.PI, 0); c.closePath(); return; }
    c.arc(0, 0, r, 0, Math.PI * 2);
  }

  function drawEnemies(ctx, sim, ui) {
    for (const e of sim.enemies) {
      if (e.dead) continue;
      const r = simEnemyRadius(e);
      const col = ENEMY_COLORS[e.kindId] || '#cccccc';
      ctx.save();
      ctx.translate(e.x, e.y);
      if (!e.ground) {
        // тень на земле и «полёт»
        ctx.save(); ctx.translate(0, 14); ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.8, r * 0.35, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        ctx.translate(0, -10);
        // крылья
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        const flap = Math.sin(sim.time * 14 + e.dist) * 4;
        ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(-r - 6, -flap); ctx.moveTo(r, 0); ctx.lineTo(r + 6, -flap); ctx.stroke();
      }
      // телеграфы способностей
      if (e.abState === 'telegraph' || e.pendingShield) {
        ctx.strokeStyle = 'rgba(255,220,80,0.9)'; ctx.lineWidth = 2;
        const rr = r + 6 + Math.sin(sim.time * 12) * 2;
        ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.stroke();
      }
      if (e.phaseActive) ctx.globalAlpha = 0.55;
      if (e.slow && e.slow.until > sim.time) {
        ctx.fillStyle = 'rgba(120,200,255,0.35)';
        ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = col;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); enemyBodyPath(ctx, e, r); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
      // метка Арканиста
      if (e.mark) {
        ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -r - 8); ctx.lineTo(4, -r - 2); ctx.lineTo(-4, -r - 2); ctx.closePath(); ctx.stroke();
      }
      // щит
      if (e.shield > 0) {
        ctx.strokeStyle = 'rgba(140,220,255,0.9)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, r + 4, -Math.PI * 0.9, Math.PI * 0.9); ctx.stroke();
      }
      // горение
      if (e.burn) {
        ctx.fillStyle = 'rgba(255,120,40,' + (0.5 + 0.3 * Math.sin(sim.time * 10)) + ')';
        ctx.beginPath(); ctx.arc(-r * 0.4, -r - 3, 3, 0, Math.PI * 2); ctx.arc(r * 0.4, -r - 5, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      // полоса HP
      const wBar = Math.max(22, r * 2.4);
      const hpFrac = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(-wBar / 2, -r - 14, wBar, 4);
      ctx.fillStyle = e.bossFlag || e.eliteFlag ? '#ffb02e' : '#5ad06a';
      ctx.fillRect(-wBar / 2, -r - 14, wBar * hpFrac, 4);
      if (e.shieldMax > 0 || e.shield > 0) {
        const sh = Math.min(1, e.shield / Math.max(1, e.shieldMax || e.pendingShieldAmount || 120));
        ctx.fillStyle = '#6fc3ff'; ctx.fillRect(-wBar / 2, -r - 19, wBar * sh, 3);
      }
      // броня/сопротивления значками
      if (TD.effectiveArmor(e) >= 40) {
        ctx.fillStyle = '#c8d4e0'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
        ctx.fillText('▲', 0, r + 12);
      }
      ctx.restore();
      // иллюзия двойника — отдельный призрак с маркером
      if (e.illusion && e.illusion.active) {
        ctx.save();
        ctx.translate(e.illusion.x, e.illusion.y);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = ENEMY_COLORS[e.kindId] || '#ccc';
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, 6); ctx.moveTo(6, -6); ctx.lineTo(-6, 6); ctx.stroke();
        ctx.restore();
        // маркер настоящего тела
        ctx.save(); ctx.translate(e.x, e.y);
        ctx.strokeStyle = '#7CFFB2'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, r + 7, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  }

  function simEnemyRadius(e) {
    if (e.bossFlag) return 22;
    if (e.eliteFlag) return 16;
    if (e.defRef.small) return 7;
    return 10;
  }

  function drawProjectiles(ctx, sim) {
    for (const p of sim.projectiles) {
      const col = p.damageType === 'magic' ? '#b48ce0' : p.damageType === 'fire' ? '#ff8c42' : '#ffe9b0';
      ctx.fillStyle = col;
      ctx.beginPath();
      if (p.linePierce) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.dirY, p.dirX));
        ctx.fillRect(-8, -1.5, 16, 3); ctx.restore();
      } else {
        ctx.arc(p.x, p.y, p.splash ? 4.5 : 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawMines(ctx, sim) {
    for (const m of sim.mines) {
      ctx.save(); ctx.translate(m.x, m.y);
      ctx.fillStyle = '#3a4450';
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  // события эффектов превращаем в затухающие частицы через ui.fx список
  function drainEventsIntoFx(sim, ui) {
    for (const ev of sim.events) {
      switch (ev.type) {
        case 'hit': ui.fx.push({ kind: 'spark', x: ev.x, y: ev.y, t: 0, dur: 0.18 }); break;
        case 'blast': ui.fx.push({ kind: 'ring', x: ev.x, y: ev.y, r: ev.radius, t: 0, dur: 0.35, color: ev.color }); break;
        case 'cone': ui.fx.push({ kind: 'cone', x: ev.x, y: ev.y, ang: ev.ang, half: ev.half, radius: ev.radius, t: 0, dur: 0.22 }); break;
        case 'chain': ui.fx.push({ kind: 'chain', from: ev.from, points: ev.points, t: 0, dur: 0.25 }); break;
        case 'sniper-shot': ui.fx.push({ kind: 'laser', from: ev.from, to: ev.to, t: 0, dur: 0.3 }); break;
        case 'reward': ui.fx.push({ kind: 'text', text: '+' + ev.amount, x: ev.x, y: ev.y - 12, t: 0, dur: 0.9, color: '#ffd76a' }); break;
        case 'heal': ui.fx.push({ kind: 'text', text: '+' + ev.amount, x: ev.x, y: ev.y - 12, t: 0, dur: 0.8, color: '#7fe0b8' }); break;
        case 'leak': ui.fx.push({ kind: 'leak', t: 0, dur: 0.5, damage: ev.damage }); break;
        case 'death': ui.fx.push({ kind: 'death', x: ev.x, y: ev.y, t: 0, dur: 0.4, elite: ev.elite, boss: ev.boss }); break;
        case 'fog': ui.fx.push({ kind: 'ring', x: ev.x, y: ev.y, r: ev.radius, t: 0, dur: 0.6, color: 'fog' }); break;
        case 'gravity': ui.fx.push({ kind: 'ring', x: ev.x, y: ev.y, r: ev.radius, t: 0, dur: 0.6, color: 'grav' }); break;
        case 'summon': ui.fx.push({ kind: 'ring', x: ev.x, y: ev.y, r: 26, t: 0, dur: 0.5, color: 'summon' }); break;
        case 'shield-cast': ui.fx.push({ kind: 'ring', x: ev.x, y: ev.y, r: 24, t: 0, dur: 0.4, color: 'shield' }); break;
        case 'mine-place': ui.fx.push({ kind: 'ring', x: ev.x, y: ev.y, r: 12, t: 0, dur: 0.3, color: 'summon' }); break;
        case 'build': ui.fx.push({ kind: 'ring', x: ev.x, y: ev.y, r: 22, t: 0, dur: 0.4, color: 'build' }); break;
        case 'sell': ui.fx.push({ kind: 'text', text: '+' + ev.refund, x: ev.x, y: ev.y - 10, t: 0, dur: 0.9, color: '#ffd76a' }); break;
        case 'wave-clear': ui.banner = { text: 'Волна ' + ev.wave + ' очищена  +' + ev.reward + '₡', t: 0, dur: 2.2 }; break;
        case 'wave-start': ui.banner = { text: 'Волна ' + ev.wave, t: 0, dur: 1.6 }; break;
      }
    }
    sim.events.length = 0;
  }

  function drawEffects(ctx, sim, ui) {
    for (const f of ui.fx) {
      const k = f.t / f.dur;
      const alpha = 1 - k;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      switch (f.kind) {
        case 'spark':
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(f.x, f.y, 3 * (1 - k) + 1, 0, Math.PI * 2); ctx.fill();
          break;
        case 'ring': {
          const col = f.color === 'fog' ? 'rgba(180,200,220,' : f.color === 'grav' ? 'rgba(160,140,220,' :
            f.color === 'summon' ? 'rgba(140,230,160,' : f.color === 'shield' ? 'rgba(120,200,255,' :
              f.color === 'build' ? 'rgba(255,255,255,' : f.color === 'mine' ? 'rgba(255,140,80,' :
                f.color === 'spark' ? 'rgba(255,220,90,' : 'rgba(255,170,80,';
          ctx.strokeStyle = col + alpha + ')';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + 0.6 * k), 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'cone':
          ctx.fillStyle = 'rgba(255,140,60,' + (alpha * 0.35) + ')';
          ctx.beginPath(); ctx.moveTo(f.x, f.y);
          ctx.arc(f.x, f.y, f.radius, f.ang - f.half, f.ang + f.half);
          ctx.closePath(); ctx.fill();
          break;
        case 'chain':
          ctx.strokeStyle = 'rgba(180,150,255,' + alpha + ')';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(f.from[0], f.from[1]);
          for (const pt of f.points) {
            // зигзаг
            const px = pt[0], py = pt[1];
            ctx.lineTo(px + (Math.random() * 8 - 4), py + (Math.random() * 8 - 4));
            ctx.lineTo(px, py);
          }
          ctx.stroke();
          break;
        case 'laser':
          ctx.strokeStyle = 'rgba(255,240,200,' + alpha + ')';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(f.from[0], f.from[1]); ctx.lineTo(f.to[0], f.to[1]); ctx.stroke();
          break;
        case 'death': {
          ctx.fillStyle = f.boss ? 'rgba(255,80,80,' : f.elite ? 'rgba(255,170,60,' : 'rgba(200,200,200,';
          ctx.strokeStyle = ctx.fillStyle + alpha + ')';
          ctx.lineWidth = 2;
          const rr = (f.boss ? 30 : f.elite ? 20 : 12) * (0.5 + k);
          ctx.beginPath(); ctx.arc(f.x, f.y, rr, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'leak':
          ctx.fillStyle = 'rgba(255,60,60,' + (alpha * 0.25) + ')';
          ctx.fillRect(0, 0, W, H);
          break;
        case 'text':
          ctx.fillStyle = f.color;
          ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
          ctx.fillText(f.text, f.x, f.y - 14 * k);
          break;
      }
      ctx.restore();
    }
    // баннер волны
    if (ui.banner) {
      const k = ui.banner.t / ui.banner.dur;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - k) * 2);
      ctx.fillStyle = '#eaf6ff';
      ctx.font = 'bold 26px monospace'; ctx.textAlign = 'center';
      ctx.fillText(ui.banner.text, W / 2, 80);
      ctx.restore();
    }
  }

  function drawFloatingTexts() { /* тексты живут в fx */ }

  function drawPlacementGhost(ctx, sim, ui) {
    if (!ui.selectedTowerType || ui.hoverPlatform === null) return;
    const pf = sim.platforms[ui.hoverPlatform];
    if (!pf || pf.towerId !== null) return;
    const tdef = TOWERS[ui.selectedTowerType];
    const s = tdef.levels[0];
    const ok = TD.canBuild(sim, ui.selectedTowerType).ok;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = ok ? '#7CFFB2' : '#ff6a6a';
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(pf.x, pf.y, 20, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawRangePreview(ctx, sim, ui) {
    const show = [];
    if (ui.selectedTower) show.push({ tw: ui.selectedTower });
    if (ui.selectedTowerType && ui.hoverPlatform !== null) {
      const pf = sim.platforms[ui.hoverPlatform];
      if (pf && pf.towerId === null) show.push({ ghost: true, x: pf.x, y: pf.y, towerId: ui.selectedTowerType, level: 0 });
    }
    for (const item of show) {
      let x, y, tdef, s;
      if (item.ghost) { x = item.x; y = item.y; tdef = TOWERS[item.towerId]; s = tdef.levels[0]; }
      else { x = item.tw.x; y = item.tw.y; tdef = TOWERS[item.tw.towerId]; s = TOWERS[item.tw.towerId].levels[item.tw.level]; }
      const r = s.radius || s.auraRadius || 0;
      if (!r) continue;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  root.TD = TD;
  TD.Render = {
    W, H, drawFrame, drainEventsIntoFx,
    updateFx(ui, dt) {
      for (const f of ui.fx) f.t += dt;
      ui.fx = ui.fx.filter(f => f.t < f.dur);
      if (ui.banner) { ui.banner.t += dt; if (ui.banner.t >= ui.banner.dur) ui.banner = null; }
      if (ui.shake > 0) ui.shake = Math.max(0, ui.shake - dt * 24);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
