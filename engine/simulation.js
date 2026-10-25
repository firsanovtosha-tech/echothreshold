/* "Рубеж Эха" — детерминированная боевая симуляция (разделы 4, 5, 14 мастер-промпта).
 * Фиксированный шаг 1/60 с; рендеринг не влияет на результат.
 * Модуль не зависит от DOM и запускается в Node для автотестов. */
(function (root) {
  'use strict';
  const TD = root.TD;
  const { TOWERS } = TD;
  const { ENEMIES, SUMMON_DEFAULTS } = TD;

  const DT = 1 / 60;            // фиксированный шаг симуляции
  const BURN_TICK = 0.5;        // период тика горения
  const BUILD_TIME = 0.25;      // время строительства башни
  const BASE_HP = 20;
  const SLOW_FLOOR = 0.45;      // скорость не ниже 45% базовой (от замедлений)

  let _uid = 0;
  function uid(p) { return p + '_' + (++_uid); }

  // ---------- геометрические помощники ----------
  function polylineLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  }
  function pointAt(pts, dist) {
    // точка на ломаной на расстоянии dist вдоль неё
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc + seg >= dist || i === pts.length - 1) {
        const t = seg === 0 ? 0 : Math.min(1, Math.max(0, (dist - acc) / seg));
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      }
      acc += seg;
    }
    return pts[pts.length - 1];
  }
  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }

  // ---------- маршруты карты ----------
  function buildRoutes(mapDef) {
    const routes = [];
    if (mapDef.fork) {
      const f = mapDef.fork;
      const join = (a, b) => a.concat(b.slice(1));
      routes.push({ name: 'upper', pts: join(join(f.entry, f.upper), f.exit) });
      routes.push({ name: 'lower', pts: join(join(f.entry, f.lower), f.exit) });
    } else {
      routes.push({ name: 'main', pts: mapDef.route });
    }
    routes.forEach(r => { r.length = polylineLength(r.pts); });
    return routes;
  }

  // ---------- урон по формулам раздела 5.2 ----------
  // Порядок: базовый урон → броня (только физ.) → сопротивление → уязвимости цели → щит → HP
  function computeDamage(enemy, baseDamage, damageType, opts) {
    opts = opts || {};
    if (enemy.dead) return 0;
    let dmg = baseDamage;
    if (damageType === 'physical') {
      const armor = Math.max(0, effectiveArmor(enemy) - shredReduction(enemy) - (opts.armorShred || 0));
      const pen = opts.armorPen || 0; // проникновение Арбалетчика: только для этого попадания
      const effArmor = Math.max(0, armor - pen);
      let m = 100 / (100 + effArmor);
      m = Math.min(1.0, Math.max(0.40, m));
      dmg *= m;
    }
    const resKey = damageType === 'none' ? null : damageType;
    const res = resKey && enemy.res ? (enemy.res[damageType] || 0) : 0;
    dmg *= (1 - res);
    // явно указанные уязвимости цели (например, огонь ×1.30 по слизню)
    if (damageType === 'fire' && enemy.fireVuln) dmg *= enemy.fireVuln;
    // метка Арканиста: входящий магический урон повышен
    if (damageType === 'magic' && enemy.mark) dmg *= (1 + enemy.mark.bonus);
    // фаза Фазовика: снижение входящего урона
    if (enemy.phaseActive) dmg *= (1 - (ENEMIES.phaser.phase.reduction));
    if (dmg < 0) dmg = 0;
    // минимальный урон успешного попадания — 1% исходного
    if (dmg > 0 && dmg < baseDamage * 0.01) dmg = baseDamage * 0.01;
    return dmg;
  }

  function effectiveArmor(enemy) {
    return enemy.baseArmor + (enemy.armorAuraBonus || 0) + (enemy.tempArmorBonus || 0);
  }

  function applyDamage(sim, enemy, baseDamage, damageType, opts) {
    const dealt = computeDamage(enemy, baseDamage, damageType, opts);
    if (dealt <= 0 || enemy.dead) return 0;
    enemy.lastDamagedAt = sim.time;
    // учёт урона по источнику (для подавления Корневика)
    if (opts && opts.sourceTower) {
      const tw = opts.sourceTower;
      tw.recentDamageTo = tw.recentDamageTo || {};
      tw.recentDamageTo[enemy.id] = (tw.recentDamageTo[enemy.id] || 0) + dealt;
    }
    let remaining = dealt;
    if (enemy.shield > 0) {
      const s = Math.min(enemy.shield, remaining);
      enemy.shield -= s;
      remaining -= s;
    }
    enemy.hp -= remaining;
    enemy.totalDamageTaken += dealt;
    if (enemy.hp <= 0) killEnemy(sim, enemy);
    return dealt;
  }

  function healEnemy(sim, enemy, amount) {
    if (enemy.dead) return;
    const before = enemy.hp;
    enemy.hp = Math.min(enemy.maxHp, enemy.hp + amount);
    if (enemy.hp > before) sim.events.push({ type: 'heal', x: enemy.x, y: enemy.y, amount: Math.round(enemy.hp - before), time: sim.time });
  }

  function killEnemy(sim, enemy) {
    if (enemy.dead) return; // ровно один раз
    enemy.dead = true;
    enemy.deathTime = sim.time;
    if (enemy.reward > 0) {
      sim.credits += enemy.reward;
      sim.stats.killRewardTotal += enemy.reward;
      sim.events.push({ type: 'reward', amount: enemy.reward, x: enemy.x, y: enemy.y, time: sim.time });
    }
    sim.stats.kills++;
    sim.events.push({ type: 'death', id: enemy.id, kind: enemy.kindId, x: enemy.x, y: enemy.y, elite: !!enemy.eliteFlag, boss: !!enemy.bossFlag, time: sim.time });
    // Гибель Искрового жука: магический взрыв по другим врагам
    if (enemy.deathBlast) {
      const db = enemy.deathBlast;
      for (const other of sim.enemies) {
        if (other === enemy || other.dead) continue;
        if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= db.radius) {
          applyDamage(sim, other, db.damage, db.type, {});
        }
      }
      sim.events.push({ type: 'blast', x: enemy.x, y: enemy.y, radius: db.radius, color: 'spark', time: sim.time });
    }
    // Разделитель создаёт осколки
    if (enemy.splitOnDeath) {
      for (let i = 0; i < enemy.splitOnDeath.count; i++) {
        const child = spawnEnemyAt(sim, enemy.splitOnDeath.child, enemy.routeIndex, Math.max(0, enemy.dist - 8 - i * 10), false);
        if (child) child.parentId = enemy.id;
      }
    }
  }

  // ---------- эффекты состояний ----------
  function applySlow(sim, enemy, pct, dur, sourceTowerLevelEff) {
    if (enemy.dead) return;
    let efficiency = 1;
    if (enemy.bossFlag) efficiency = 0.5;
    if (typeof enemy.slowEff === 'number') efficiency = enemy.slowEff;
    const finalPct = pct * efficiency;
    const duration = dur * (enemy.slowDurFactor || 1);
    const until = sim.time + duration;
    if (!enemy.slow || enemy.slow.until <= sim.time) {
      enemy.slow = { pct: finalPct, until };
    } else {
      // не складываются: применяется самое сильное активное
      if (finalPct > enemy.slow.pct) enemy.slow.pct = finalPct;
      if (until > enemy.slow.until) enemy.slow.until = until;
    }
  }

  function applyBurn(enemy, dps, dur) {
    if (enemy.dead) return;
    if (!enemy.burn) {
      enemy.burn = { dps: dps, expires: dur, nextTick: BURN_TICK };
    } else {
      enemy.burn.dps = Math.max(enemy.burn.dps, dps);
      enemy.burn.expires = Math.max(enemy.burn.expires, dur); // повторное наложение обновляет длительность, DPS не суммируется
    }
  }

  function applyMark(enemy, bonus, dur) {
    if (enemy.dead) return;
    const until = dur; // хранится как оставшееся время
    if (!enemy.mark) enemy.mark = { bonus, timeLeft: until };
    else { enemy.mark.bonus = Math.max(enemy.mark.bonus, bonus); enemy.mark.timeLeft = Math.max(enemy.mark.timeLeft, until); }
  }

  function applyShred(enemy, amount, maxStacks, dur) {
    if (enemy.dead) return;
    if (!enemy.shred) enemy.shred = { stacks: 0, amount, timeLeft: 0 };
    enemy.shred.amount = Math.max(enemy.shred.amount, amount);
    enemy.shred.stacks = Math.min(maxStacks, enemy.shred.stacks + 1);
    enemy.shred.timeLeft = dur;
    enemy.shred.maxStacks = maxStacks;
  }

  // снижение брони Коррозионщика применяется к эффективной броне цели
  function shredReduction(enemy) {
    if (!enemy.shred || enemy.shred.timeLeft <= 0 || !enemy.shred.stacks) return 0;
    return enemy.shred.amount * enemy.shred.stacks;
  }

  // ---------- спавн ----------
  function spawnEnemyAt(sim, kindId, routeIndex, dist, fromWave) {
    const def = ENEMIES[kindId];
    if (!def) return null;
    const route = sim.routes[routeIndex % sim.routes.length];
    const e = {
      id: uid('e'), kindId,
      name: def.name,
      maxHp: def.hp, hp: def.hp,
      shieldMax: def.shield || 0, shield: def.shield || 0,
      baseArmor: def.armor,
      speed: def.speed,
      ground: def.ground !== false,
      reward: def.noReward ? 0 : (def.reward || 0),
      leak: def.leak,
      res: Object.assign({}, def.res),
      fireVuln: def.fireVuln || 0,
      slowEff: typeof def.slowEff === 'number' ? def.slowEff : undefined,
      slowDurFactor: def.slowDurFactor || 1,
      eliteFlag: !!def.elite, bossFlag: !!def.boss,
      ability: def.ability,
      routeIndex: routeIndex % sim.routes.length,
      dist: dist || 0,
      x: 0, y: 0,
      dead: false,
      slow: null, burn: null, mark: null, shred: null, phaseActive: false,
      lastDamagedAt: -999, totalDamageTaken: 0,
      // таймеры способностей (все стартуют с задержкой, чтобы не срабатывать на нулевой секунде)
      abTimer: def.heal ? def.heal.interval : 0,
      abState: null, abStateTimer: 0,
      summonedHalf: false, usedOnce: {},
      illusion: null,
      deathBlast: def.deathBlast || null,
      splitOnDeath: def.split || null,
      defRef: def
    };
    const p = pointAt(sim.routes[e.routeIndex].pts, e.dist);
    e.x = p[0]; e.y = p[1];
    sim.enemies.push(e);
    sim.events.push({ type: 'spawn', id: e.id, kind: kindId, x: e.x, y: e.y, time: sim.time });
    return e;
  }

  // ---------- симуляция ----------
  function createSim(mapDef, loadout, options) {
    options = options || {};
    _uid = 0;
    const sim = {
      map: mapDef,
      routes: buildRoutes(mapDef),
      platforms: mapDef.platforms.map((p, i) => ({ index: i, x: p[0], y: p[1], towerId: null })),
      towers: [], projectiles: [], mines: [], illusions: [],
      enemies: [], effects: [], events: [],
      time: 0, accumulator: 0,
      credits: mapDef.startCredits,
      baseHp: BASE_HP,
      waveIndex: -1,           // индекс текущей/последней волны (0..9)
      waveActive: false,
      waveSpawnQueue: [],      // [{t, kind, groupIndex}]
      waveEndAt: -1,           // момент, когда все спавны завершены
      forkCounter: 0,          // детерминированное чередование ветвей
      riftCycleT: 0, riftActiveZone: -1, riftTelegraphT: 0, riftBoostT: 0,
      gameOver: null,          // 'win' | 'lose' | null
      stats: { kills: 0, leaks: 0, leakedHp: 0, killRewardTotal: 0, wavesCleared: 0, spentBuild: 0, spentUpgrade: 0 },
      loadout: loadout.slice(0, 5),
      targetMode: 'first',     // first | strongest | weakest | nearestExit
      rngState: 12345,         // детерминированный ГПСЧ (не используется для кампанийных волн)
      finishedRewarded: false
    };
    return sim;
  }

  function rand(sim) { // xorshift, детерминированный при одном seed
    let x = sim.rngState;
    x ^= x << 13; x |= 0; x ^= x >>> 17; x ^= x << 5; x |= 0;
    sim.rngState = x >>> 0;
    return (sim.rngState % 100000) / 100000;
  }

  function startWave(sim, index) {
    if (sim.gameOver || sim.waveActive) return { ok: false, reason: 'wave-busy' };
    if (index < 0 || index >= sim.map.waves.length) return { ok: false, reason: 'no-wave' };
    sim.waveIndex = index;
    sim.waveActive = true;
    sim.stats.currentWaveStartedAt = sim.time;
    // строим очередь спавна: группы подряд; следующая группа через 2 с после появления последнего врага предыдущей;
    // босс/элита — через 4 с после последней обычной группы
    const queue = [];
    let t = 0;
    const groups = sim.map.waves[index];
    for (let gi = 0; gi < groups.length; gi++) {
      const grp = groups[gi];
      const isBossGroup = !!grp.bossDelay;
      if (isBossGroup) {
        t += grp.bossDelay;
        queue.push({ t, kind: grp.enemy, groupIndex: gi, boss: true });
      } else {
        for (let i = 0; i < grp.count; i++) {
          queue.push({ t, kind: grp.enemy, groupIndex: gi });
          t += grp.interval;
        }
        if (gi < groups.length - 1 && !groups[gi + 1].bossDelay) t += 2.0;
      }
    }
    sim.waveSpawnQueue = queue;
    sim.waveLastSpawnT = queue.length ? queue[queue.length - 1].t : 0;
    sim.waveStartT = sim.time;
    sim.events.push({ type: 'wave-start', wave: index + 1, time: sim.time });
    return { ok: true };
  }

  // выбор ветви на карте-развилке: наземные обычные враги чередуются 50/50; воздушные и боссы — верхняя (общий вход/выход идентичны)
  function chooseRouteForSpawn(sim, kindId, isBoss) {
    if (sim.routes.length < 2) return 0;
    const def = ENEMIES[kindId];
    const isGround = def.ground !== false;
    if (isBoss || !isGround) return 0; // детерминированный выбор «верхней» ветви
    const idx = sim.forkCounter % 2;
    sim.forkCounter++;
    return idx;
  }

  // ---------- экономика: атомарные операции ----------
  function canBuild(sim, towerId) {
    if (sim.gameOver) return { ok: false, reason: 'Бой завершён.' };
    if (!sim.loadout.includes(towerId)) return { ok: false, reason: 'Башня не входит в выбранный набор.' };
    const cost = TOWERS[towerId].levels[0].buildCost;
    if (sim.credits < cost) return { ok: false, reason: `Не хватает кредитов: нужно ${cost}, есть ${sim.credits}.` };
    return { ok: true, cost };
  }

  function buildTower(sim, platformIndex, towerId) {
    const chk = canBuild(sim, towerId);
    if (!chk.ok) return chk;
    const pf = sim.platforms[platformIndex];
    if (!pf) return { ok: false, reason: 'Нет такой площадки.' };
    if (pf.towerId !== null) return { ok: false, reason: 'Площадка занята.' };
    sim.credits -= chk.cost; // атомарно: списание после всех проверок
    sim.stats.spentBuild += chk.cost;
    pf.towerId = 'pending';
    const tw = {
      id: uid('t'), towerId, level: 0, x: pf.x, y: pf.y, platformIndex,
      cooldown: BUILD_TIME, built: false, angle: 0,
      spent: chk.cost, targetId: null,
      mineTimer: 0, suppress: null
    };
    sim.towers.push(tw);
    pf.towerId = tw.id;
    sim.events.push({ type: 'build', tower: tw.id, x: pf.x, y: pf.y, time: sim.time });
    return { ok: true, tower: tw };
  }

  function upgradeCost(sim, tower) {
    if (tower.level >= 2) return null;
    return TOWERS[tower.towerId].levels[tower.level + 1].upgradeCost;
  }

  function upgradeTower(sim, towerIdInstance) {
    const tw = sim.towers.find(t => t.id === towerIdInstance);
    if (!tw) return { ok: false, reason: 'Башня не найдена.' };
    if (sim.gameOver) return { ok: false, reason: 'Бой завершён.' };
    const cost = upgradeCost(sim, tw);
    if (cost === null) return { ok: false, reason: 'Максимальный уровень.' };
    if (sim.credits < cost) return { ok: false, reason: `Не хватает кредитов: нужно ${cost}, есть ${sim.credits}.` };
    sim.credits -= cost;
    sim.stats.spentUpgrade += cost;
    tw.level++;
    tw.spent += cost;
    sim.events.push({ type: 'upgrade', tower: tw.id, level: tw.level, time: sim.time });
    return { ok: true, tower: tw };
  }

  function sellTower(sim, towerIdInstance) {
    const tw = sim.towers.find(t => t.id === towerIdInstance);
    if (!tw) return { ok: false, reason: 'Башня не найдена.' };
    if (sim.gameOver) return { ok: false, reason: 'Бой завершён.' };
    const refund = TD.sellRefund(tw.towerId, tw.level);
    sim.credits += refund;
    sim.platforms[tw.platformIndex].towerId = null;
    // удалить связанные мины этой башни
    sim.mines = sim.mines.filter(m => m.ownerId !== tw.id);
    sim.towers = sim.towers.filter(t => t !== tw);
    sim.events.push({ type: 'sell', tower: tw.id, x: tw.x, y: tw.y, refund, time: sim.time });
    return { ok: true, refund };
  }

  // ---------- выбор целей ----------
  function towerStats(tw) { return TOWERS[tw.towerId].levels[tw.level]; }

  function effectiveRadius(sim, tw) {
    const s = towerStats(tw);
    let r = s.radius || 0;
    if (tw.rangeDebuffUntil !== undefined && tw.rangeDebuffUntil > sim.time) r *= (1 - tw.rangeDebuffPct);
    return r;
  }

  function attackInterval(sim, tw) {
    const s = towerStats(tw);
    let iv = s.interval;
    if (iv <= 0) return 0;
    // Обелиск: деление на (1 + bonusAttackSpeed); берётся наибольший бонус от одного Обелиска
    let obBonus = 0;
    for (const o of sim.towers) {
      if (o === tw || o.towerId !== 'obelisk' || !o.built) continue;
      const os = towerStats(o);
      if (Math.hypot(o.x - tw.x, o.y - tw.y) <= os.auraRadius) {
        obBonus = Math.max(obBonus, os.attackSpeedBonus);
      }
    }
    iv = iv / (1 + obBonus);
    // дебафф Споровика: −8% скорости атак → интервал увеличивается
    for (const e of sim.enemies) {
      if (e.dead || !e.defRef.debuffAura) continue;
      const da = e.defRef.debuffAura;
      if (Math.hypot(e.x - tw.x, e.y - tw.y) <= da.radius) {
        iv = iv / (1 - da.attackSpeedPenalty);
        break; // одинаковые ауры не складываются
      }
    }
    // подавление Корневика
    if (tw.suppressUntil && tw.suppressUntil > sim.time) iv = iv / (1 - tw.suppressPct);
    return iv;
  }

  function eligibleTargets(sim, tw) {
    const tdef = TOWERS[tw.towerId];
    const list = [];
    for (const e of sim.enemies) {
      if (e.dead) continue;
      if (tdef.targets === 'ground' && !e.ground) continue;
      if (tdef.targets === 'none') continue;
      const r = effectiveRadius(sim, tw);
      if (Math.hypot(e.x - tw.x, e.y - tw.y) <= r) list.push(e);
    }
    return list;
  }

  function pickTarget(sim, tw, candidates) {
    if (!candidates.length) return null;
    const mode = sim.targetMode;
    let best = candidates[0];
    for (const e of candidates) {
      switch (mode) {
        case 'strongest':
          if (e.maxHp > best.maxHp) best = e; break;
        case 'weakest':
          if (e.hp < best.hp) best = e; break;
        case 'nearestExit':
          // ближе всего к выходу = наибольшая пройденная дистанция относительно длины маршрута
          if (progressOf(sim, e) > progressOf(sim, best)) best = e; break;
        default: // 'first' — первый на маршруте = greatest progress
          if (progressOf(sim, e) > progressOf(sim, best)) best = e;
      }
    }
    return best;
  }

  function progressOf(sim, e) {
    const routeLen = sim.routes[e.routeIndex].length;
    return e.dist / routeLen; // доля пути к выходу
  }

  // ---------- полёт снарядов ----------
  function fireProjectile(sim, tw, target) {
    const tdef = TOWERS[tw.towerId];
    const s = towerStats(tw);
    sim.projectiles.push({
      id: uid('p'), tower: tw, towerIdStr: tw.towerId, level: tw.level,
      x: tw.x, y: tw.y, targetId: target.id, target,
      speed: tdef.projectileSpeed || 300,
      damage: s.damage, damageType: tdef.damageType,
      splash: !!tdef.splash, splashRadius: s.splashRadius || 0,
      slow: tdef.slow ? { pct: s.slowPct, dur: s.slowDur } : null,
      mark: tdef.mark ? { bonus: s.markBonus, dur: s.markDur } : null,
      shred: tdef.shred ? { amount: s.shredAmount, maxStacks: s.shredMaxStacks, dur: s.shredDur } : null,
      linePierce: !!tdef.linePierce, pierceWidth: tdef.pierceWidth || 10, pierceCount: s.maxTargets,
      dirX: 0, dirY: 0, done: false, traveled: 0, segment: 0, hitIds: [],
      life: 4.0
    });
  }

  function updateProjectiles(sim, dt) {
    for (const p of sim.projectiles) {
      if (p.done) continue;
      p.life -= dt;
      if (p.life <= 0) { p.done = true; continue; }
      const tgt = p.target;
      // иллюзия Пепельного двойника может отвлечь одиночный снаряд
      let tx = tgt && !tgt.dead ? tgt.x : null, ty = tgt && !tgt.dead ? tgt.y : null;
      if (tgt && !tgt.dead && tgt.illusion && tgt.illusion.active) {
        tx = tgt.illusion.x; ty = tgt.illusion.y;
      }
      if (tx === null) {
        // цель погибла: снаряд гаснет (урон не начисляется дважды)
        p.done = true; continue;
      }
      const dx = tx - p.x, dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (p.linePierce) {
        // прямой полёт к захваченной точке; поражает врагов на линии шириной pierceWidth
        if (p.segment === 0) { p.dirX = dx / (d || 1); p.dirY = dy / (d || 1); p.segment = 1; p.maxTravel = Math.max(200, d + 80); }
        p.x += p.dirX * step; p.y += p.dirY * step;
        p.traveled += step;
        // поражение новых целей на траектории
        for (const e of sim.enemies) {
          if (e.dead || p.hitIds.includes(e.id) || !e.ground) continue;
          if (p.hitIds.length >= p.pierceCount) break;
          const dd = distToSegment(e.x, e.y, p.x - p.dirX * step, p.y - p.dirY * step, p.x, p.y);
          if (dd <= p.pierceWidth + enemyRadius(e)) {
            p.hitIds.push(e.id);
            applyDamage(sim, e, p.damage, p.damageType, {});
          }
        }
        if (p.traveled >= p.maxTravel || p.hitIds.length >= p.pierceCount) p.done = true;
        continue;
      }
      if (d <= step + enemyRadius(tgt)) {
        impactProjectile(sim, p, tgt);
        p.done = true;
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
    }
    sim.projectiles = sim.projectiles.filter(p => !p.done);
  }

  function enemyRadius(e) {
    if (e.bossFlag) return 22;
    if (e.eliteFlag) return 16;
    if (e.defRef.small) return 7;
    return 10;
  }

  function impactProjectile(sim, p, tgt) {
    const tw = p.tower;
    const s = towerStats(tw);
    const opts = { armorPen: s.armorPen || 0, sourceTower: tw };
    if (p.splash) {
      // центр взрыва — точка попадания по цели; поражаются ближайшие до N наземных врагов
      const inRange = sim.enemies.filter(e => !e.dead && e.ground && Math.hypot(e.x - tgt.x, e.y - tgt.y) <= p.splashRadius)
        .sort((a, b) => Math.hypot(a.x - tgt.x, a.y - tgt.y) - Math.hypot(b.x - tgt.x, b.y - tgt.y))
        .slice(0, s.maxTargets);
      for (const e of inRange) applyDamage(sim, e, p.damage, p.damageType, opts);
      sim.events.push({ type: 'blast', x: tgt.x, y: tgt.y, radius: p.splashRadius, color: 'sling', time: sim.time });
    } else {
      applyDamage(sim, tgt, p.damage, p.damageType, opts);
      if (p.slow) applySlow(sim, tgt, p.slow.pct, p.slow.dur);
      if (p.mark) applyMark(tgt, p.mark.bonus, p.mark.dur);
      if (p.shred) applyShred(tgt, p.shred.amount, p.shred.maxStacks, p.shred.dur);
    }
    sim.events.push({ type: 'hit', x: tgt.x, y: tgt.y, kind: p.towerIdStr, time: sim.time });
  }

  // ---------- мгновенные атаки (огнемёт, громовой узел) ----------
  function instantAttack(sim, tw) {
    const tdef = TOWERS[tw.towerId];
    const s = towerStats(tw);
    const opts = { sourceTower: tw };
    if (tdef.cone) {
      const targets = eligibleTargets(sim, tw);
      if (!targets.length) return false;
      // конус поворачивается к выбранной цели; по умолчанию первая допустимая цель
      const primary = pickTarget(sim, tw, targets);
      const ang = Math.atan2(primary.y - tw.y, primary.x - tw.x);
      tw.angle = ang;
      const half = (s.coneDeg * Math.PI / 180) / 2;
      const r = effectiveRadius(sim, tw);
      const inCone = targets.filter(e => {
        const a = Math.atan2(e.y - tw.y, e.x - tw.x);
        let diff = Math.abs(a - ang);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        return diff <= half && Math.hypot(e.x - tw.x, e.y - tw.y) <= r;
      }).sort((a, b) => progressOf(sim, b) - progressOf(sim, a)).slice(0, s.maxTargets);
      for (const e of inCone) {
        applyDamage(sim, e, s.damage, 'fire', opts);
        applyBurn(e, s.burnDps, s.burnDur);
      }
      sim.events.push({ type: 'cone', x: tw.x, y: tw.y, ang, half, radius: r, time: sim.time });
      return true;
    }
    if (tdef.chain) {
      const targets = eligibleTargets(sim, tw);
      if (!targets.length) return false;
      const primary = pickTarget(sim, tw, targets);
      const hit = [primary];
      let cur = primary;
      for (let i = 1; i < s.maxTargets; i++) {
        let best = null, bestD = Infinity;
        for (const e of sim.enemies) {
          if (e.dead || hit.includes(e)) continue;
          if (!canTarget(tw, e)) continue;
          const d = Math.hypot(e.x - cur.x, e.y - cur.y);
          if (d <= tdef.chainRange && d < bestD) { bestD = d; best = e; }
        }
        if (!best) break;
        hit.push(best); cur = best;
      }
      for (let i = 0; i < hit.length; i++) {
        applyDamage(sim, hit[i], s.damage * s.chainFactors[i], 'magic', opts);
      }
      sim.events.push({ type: 'chain', points: hit.map(h => [h.x, h.y]), from: [tw.x, tw.y], time: sim.time });
      return true;
    }
    return false;
  }

  function canTarget(tw, e) {
    // для цепи: ограничения по воздуху/земле наследуются от башни
    const tdef = TOWERS[tw.towerId];
    if (tdef.targets === 'ground' && !e.ground) return false;
    return true;
  }

  // ---------- мины ----------
  function nearestRoutePoint(sim, x, y, maxDist) {
    // ближайшая точка на любом маршруте карты
    let best = null, bestD = Infinity;
    for (let ri = 0; ri < sim.routes.length; ri++) {
      const pts = sim.routes[ri].pts;
      for (let i = 1; i < pts.length; i++) {
        const d = distToSegment(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
        if (d < bestD) {
          bestD = d;
          // проекция
          const ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1];
          const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
          let t = len2 === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / len2;
          t = Math.max(0, Math.min(1, t));
          best = { x: ax + dx * t, y: ay + dy * t, routeIndex: ri };
        }
      }
    }
    if (!best || bestD > maxDist) return null;
    return best;
  }

  function updateMines(sim, dt) {
    for (const tw of sim.towers) {
      if (tw.towerId !== 'minefield' || !tw.built) continue;
      const s = towerStats(tw);
      const own = sim.mines.filter(m => m.ownerId === tw.id);
      tw.mineTimer -= dt;
      if (tw.mineTimer <= 0 && own.length < s.maxMines) {
        const rp = nearestRoutePoint(sim, tw.x, tw.y, s.radius);
        if (rp) {
          sim.mines.push({ id: uid('m'), ownerId: tw.id, x: rp.x, y: rp.y, routeIndex: rp.routeIndex, damage: s.damage, blastRadius: TOWERS.minefield.mineBlastRadius + (tw.level === 1 ? 5 : tw.level === 2 ? 10 : 0), armed: true });
          sim.events.push({ type: 'mine-place', x: rp.x, y: rp.y, time: sim.time });
        }
        tw.mineTimer = s.interval; // если маршрута нет — таймер следующей попытки продолжается
      } else if (tw.mineTimer <= 0) {
        tw.mineTimer = s.interval;
      }
    }
    // срабатывание
    for (const m of sim.mines) {
      for (const e of sim.enemies) {
        if (e.dead || !e.ground) continue;
        if (Math.hypot(e.x - m.x, e.y - m.y) <= enemyRadius(e) + 6) {
          const victims = sim.enemies.filter(v => !v.dead && v.ground && Math.hypot(v.x - m.x, v.y - m.y) <= m.blastRadius);
          for (const v of victims) applyDamage(sim, v, m.damage, 'physical', {});
          sim.events.push({ type: 'blast', x: m.x, y: m.y, radius: m.blastRadius, color: 'mine', time: sim.time });
          m.triggered = true;
          break;
        }
      }
    }
    sim.mines = sim.mines.filter(m => !m.triggered);
  }

  // ---------- способности врагов ----------
  function updateEnemyAbilities(sim, dt) {
    for (const e of sim.enemies) {
      if (e.dead) continue;
      const def = e.defRef;
      // регенерация щита Щитоносца
      if (e.ability === 'shieldRegen') {
        if (sim.time - e.lastDamagedAt >= 3 && e.shield < e.shieldMax) {
          e.shield = Math.min(e.shieldMax, e.shield + 6 * dt);
        }
      }
      // лечение
      if (def.heal) {
        e.abTimer -= dt;
        if (e.abTimer <= 0) {
          e.abTimer = def.heal.interval;
          const near = sim.enemies.filter(o => o !== e && !o.dead && Math.hypot(o.x - e.x, o.y - e.y) <= def.heal.radius && o.hp < o.maxHp)
            .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp)).slice(0, def.heal.maxTargets);
          for (const o of near) healEnemy(sim, o, def.heal.amount);
          if (near.length) sim.events.push({ type: 'heal-pulse', x: e.x, y: e.y, radius: def.heal.radius, time: sim.time });
        }
      }
      // Фазовик
      if (e.ability === 'phase') {
        const ph = def.phase;
        e.abStateTimer -= dt;
        if (e.abStateTimer <= 0) {
          if (e.abState === 'telegraph') { e.abState = 'active'; e.phaseActive = true; e.abStateTimer = ph.active; }
          else if (e.abState === 'active') { e.abState = null; e.phaseActive = false; e.abStateTimer = ph.cycle - ph.telegraph - ph.active; }
          else { e.abState = 'telegraph'; e.abStateTimer = ph.telegraph; }
        }
      }
      // Туманник: снижение радиуса башен (цикл: ожидание → телеграф 1.0 с → эффект 2.5 с)
      if (e.ability === 'fogCloud') {
        const fg = def.fog;
        e.abStateTimer -= dt;
        if (e.abStateTimer <= 0) {
          if (e.abState === 'active') {
            e.abState = null; e.abStateTimer = Math.max(0, fg.cycle - fg.telegraph - fg.dur);
          } else if (e.abState === 'telegraph') {
            e.abState = 'active'; e.abStateTimer = fg.dur;
            for (const tw of sim.towers) {
              if (Math.hypot(tw.x - e.x, tw.y - e.y) <= fg.radius) {
                // не складывается: применяется максимальное снижение
                if (!tw.rangeDebuffUntil || tw.rangeDebuffUntil <= sim.time || tw.rangeDebuffPct <= fg.rangePenalty) {
                  tw.rangeDebuffUntil = sim.time + fg.dur; tw.rangeDebuffPct = fg.rangePenalty;
                }
              }
            }
            sim.events.push({ type: 'fog', x: e.x, y: e.y, radius: fg.radius, time: sim.time });
          } else {
            e.abState = 'telegraph'; e.abStateTimer = fg.telegraph;
          }
        }
      }
      // Корневик: подавление башни, нанёсшей больше всего урона недавно
      if (e.ability === 'towerSuppress') {
        const sp = def.suppress;
        e.abStateTimer -= dt;
        if (e.abStateTimer <= 0) {
          if (e.abState === 'telegraph') {
            e.abState = null; e.abStateTimer = sp.cycle;
            let best = null, bestDmg = 0;
            for (const tw of sim.towers) {
              if (!tw.built) continue;
              const d = Math.hypot(tw.x - e.x, tw.y - e.y);
              if (d <= sp.radius) {
                const dealt = tw.recentDamageTo ? (tw.recentDamageTo[e.id] || 0) : 0;
                if (dealt > bestDmg || (dealt === bestDmg && best === null)) { bestDmg = dealt; best = tw; }
              }
            }
            if (best) {
              best.suppressUntil = sim.time + sp.dur; best.suppressPct = sp.attackPenalty;
              sim.events.push({ type: 'suppress', x: best.x, y: best.y, time: sim.time });
            }
          } else {
            e.abState = 'telegraph'; e.abStateTimer = sp.telegraph;
          }
        }
      }
      // Прыгун
      if (e.ability === 'leap') {
        const lp = def.leap;
        e.abStateTimer -= dt;
        if (e.abStateTimer <= 0) {
          if (e.abState === 'telegraph') {
            e.abState = null; e.abStateTimer = lp.cycle;
            const routeLen = sim.routes[e.routeIndex].length;
            e.dist = Math.min(routeLen - 1, e.dist + lp.distance); // не перескакивает финиш
            sim.events.push({ type: 'leap', x: e.x, y: e.y, time: sim.time });
          } else {
            e.abState = 'telegraph'; e.abStateTimer = lp.telegraph;
          }
        }
      }
      // Пепельный двойник: иллюзия
      if (e.ability === 'illusion') {
        const il = def.illusion;
        e.abStateTimer -= dt;
        if (e.abStateTimer <= 0) {
          if (e.abState === 'telegraph') {
            e.abState = null; e.abStateTimer = il.cycle;
            e.illusion = { active: true, x: e.x + 26, y: e.y - 14, timeLeft: il.dur };
            sim.events.push({ type: 'illusion', x: e.x, y: e.y, time: sim.time });
          } else {
            e.abState = 'telegraph'; e.abStateTimer = il.telegraph;
          }
        }
        if (e.illusion && e.illusion.active) {
          e.illusion.timeLeft -= dt;
          if (e.illusion.timeLeft <= 0) e.illusion.active = false;
        }
      }
      // Гравитон: импульс радиуса
      if (e.ability === 'gravityPulse') {
        const gp = def.gravityPulse;
        e.abStateTimer -= dt;
        if (e.abStateTimer <= 0) {
          if (e.abState === 'telegraph') {
            e.abState = null; e.abStateTimer = gp.cycle;
            for (const tw of sim.towers) {
              if (Math.hypot(tw.x - e.x, tw.y - e.y) <= gp.radius) {
                if (!tw.rangeDebuffUntil || tw.rangeDebuffUntil <= sim.time || tw.rangeDebuffPct <= gp.rangePenalty) {
                  tw.rangeDebuffUntil = sim.time + gp.dur; tw.rangeDebuffPct = gp.rangePenalty;
                }
              }
            }
            sim.events.push({ type: 'gravity', x: e.x, y: e.y, radius: gp.radius, time: sim.time });
          } else {
            e.abState = 'telegraph'; e.abStateTimer = gp.telegraph;
          }
        }
      }
      // Маршал: аура брони (пересчёт каждый кадр прост: флаг auara)
      // Буровой таран: рывок ниже 25% HP один раз
      if (e.ability === 'drillRush' && !e.usedOnce.drill && e.hp / e.maxHp <= def.drillRush.threshold) {
        e.usedOnce.drill = true;
        e.rushUntil = sim.time + def.drillRush.dur;
        e.rushTelegraph = sim.time + def.drillRush.telegraph;
        sim.events.push({ type: 'rush', x: e.x, y: e.y, time: sim.time });
      }
      // Соляной колосс: периодический щит
      if (e.ability === 'colossusShield') {
        const cs = def.colossusShield;
        e.abStateTimer -= dt;
        if (e.abStateTimer <= 0) {
          if (e.abState === 'telegraph') {
            e.abState = null; e.abStateTimer = cs.cycle;
            if (e.shield <= 0) { e.shield = cs.amount; e.shieldExpires = sim.time + cs.dur; e.shieldPeriodic = true; }
          } else {
            e.abState = 'telegraph'; e.abStateTimer = cs.telegraph;
          }
        }
      }
      // Элиты/боссы
      if (e.ability === 'summon') {
        const sm = def.summon;
        e.abStateTimer -= dt;
        if (e.abStateTimer <= 0) {
          if (e.abState === 'telegraph') {
            e.abState = null; e.abStateTimer = sm.interval;
            for (let i = 0; i < sm.count; i++) {
              const c = spawnEnemyAt(sim, sm.child, e.routeIndex, Math.max(0, e.dist - 10 - i * 8), false);
              if (c) c.parentId = e.id;
            }
            sim.events.push({ type: 'summon', x: e.x, y: e.y, count: sm.count, time: sim.time });
          } else {
            e.abState = 'telegraph'; e.abStateTimer = sm.telegraph;
          }
        }
      }
      if (e.ability === 'boss1') {
        const sd = SUMMON_DEFAULTS.mossqueen;
        e.abTimer -= dt;
        if (e.abTimer <= 0) {
          e.abTimer = sd.summonInterval;
          for (let i = 0; i < sd.shardsPerCast; i++) {
            const c = spawnEnemyAt(sim, sd.child, e.routeIndex, Math.max(0, e.dist - 10 - i * 8), false);
            if (c) c.parentId = e.id;
          }
          sim.events.push({ type: 'summon', x: e.x, y: e.y, count: sd.shardsPerCast, time: sim.time });
        }
        if (!e.summonedHalf && e.hp <= e.maxHp * 0.5) {
          e.summonedHalf = true;
          for (let i = 0; i < sd.halfHpShards; i++) {
            const c = spawnEnemyAt(sim, sd.child, e.routeIndex, Math.max(0, e.dist - 10 - i * 8), false);
            if (c) c.parentId = e.id;
          }
          sim.events.push({ type: 'summon', x: e.x, y: e.y, count: sd.halfHpShards, half: true, time: sim.time });
        }
      }
      if (e.ability === 'boss2') {
        const sd = SUMMON_DEFAULTS.rivetgeneral;
        e.abTimer -= dt;
        if (e.abTimer <= 0) {
          e.abTimer = sd.shieldCycle;
          e.shield = sd.shieldAmount; e.shieldExpires = sim.time + sd.shieldDur; e.shieldPeriodic = true;
          sim.events.push({ type: 'shield-cast', x: e.x, y: e.y, amount: sd.shieldAmount, time: sim.time });
        }
        if (!e.summonedHalf && e.hp <= e.maxHp * 0.5) {
          e.summonedHalf = true;
          for (let i = 0; i < sd.halfHpSummon.count; i++) {
            const c = spawnEnemyAt(sim, sd.halfHpSummon.enemy, e.routeIndex, Math.max(0, e.dist - 12 - i * 8), false);
            if (c) c.parentId = e.id;
          }
          sim.events.push({ type: 'summon', x: e.x, y: e.y, count: sd.halfHpSummon.count, half: true, time: sim.time });
        }
      }
      if (e.ability === 'elite2') {
        const sd = SUMMON_DEFAULTS.rivetcommander;
        e.abTimer -= dt;
        if (e.abTimer <= 0) {
          e.abTimer = sd.buffCycle;
          const near = sim.enemies.filter(o => o !== e && !o.dead && Math.hypot(o.x - e.x, o.y - e.y) <= sd.buffRadius);
          for (const o of near) { o.tempArmorBonus = sd.buffArmor; o.tempArmorUntil = sim.time + sd.buffDur; }
          sim.events.push({ type: 'buff-armor', x: e.x, y: e.y, radius: sd.buffRadius, time: sim.time });
        }
      }
      if (e.ability === 'boss3') {
        const sd = SUMMON_DEFAULTS.oldtrunk;
        if (!e.usedOnce.at70 && e.hp <= e.maxHp * 0.7) {
          e.usedOnce.at70 = true;
          for (let i = 0; i < sd.at70.count; i++) {
            const c = spawnEnemyAt(sim, sd.at70.enemy, e.routeIndex, Math.max(0, e.dist - 12 - i * 10), false);
            if (c) c.parentId = e.id;
          }
          sim.events.push({ type: 'summon', x: e.x, y: e.y, count: sd.at70.count, time: sim.time });
        }
        if (!e.usedOnce.at40 && e.hp <= e.maxHp * 0.4) {
          e.usedOnce.at40 = true;
          e.shieldTelegraphUntil = sim.time + sd.at40.telegraph;
          e.pendingShield = { amount: sd.at40.shield, at: sim.time + sd.at40.telegraph, dur: sd.at40.dur };
          sim.events.push({ type: 'telegraph-shield', x: e.x, y: e.y, time: sim.time });
        }
      }
      if (e.ability === 'elite3') {
        const ha = def.hasteAura;
        e.abTimer -= dt;
        if (e.abTimer <= 0) {
          e.abTimer = ha.cycle;
          e.hasteUntil = sim.time + ha.dur;
          sim.events.push({ type: 'haste', x: e.x, y: e.y, radius: ha.radius, time: sim.time });
        }
      }
      if (e.ability === 'boss4') {
        const sd = SUMMON_DEFAULTS.zerosalt;
        if (!e.usedOnce.at70 && e.hp <= e.maxHp * 0.7) {
          e.usedOnce.at70 = true;
          for (let i = 0; i < sd.at70.count; i++) {
            const c = spawnEnemyAt(sim, sd.at70.enemy, e.routeIndex, Math.max(0, e.dist - 12 - i * 10), false);
            if (c) c.parentId = e.id;
          }
          sim.events.push({ type: 'summon', x: e.x, y: e.y, count: sd.at70.count, time: sim.time });
        }
        if (!e.usedOnce.at40 && e.hp <= e.maxHp * 0.4) {
          e.usedOnce.at40 = true;
          e.shield = sd.at40.shield; e.shieldExpires = sim.time + sd.at40.dur; e.shieldPeriodic = true;
          sim.events.push({ type: 'shield-cast', x: e.x, y: e.y, amount: sd.at40.shield, time: sim.time });
        }
      }
      if (e.ability === 'elite4') {
        const sd = SUMMON_DEFAULTS.saltguard;
        if (!e.usedOnce.at50 && e.hp <= e.maxHp * 0.5) {
          e.usedOnce.at50 = true;
          e.pendingShield = { amount: sd.at50.shield, at: sim.time + sd.at50.telegraph, dur: sd.at50.dur };
          sim.events.push({ type: 'telegraph-shield', x: e.x, y: e.y, time: sim.time });
        }
      }
      if (e.ability === 'boss5') {
        const sd = SUMMON_DEFAULTS.asharchivist;
        if (!e.usedOnce.at70 && e.hp <= e.maxHp * 0.7) {
          e.usedOnce.at70 = true;
          for (let i = 0; i < sd.at70.count; i++) {
            const c = spawnEnemyAt(sim, sd.at70.enemy, e.routeIndex, Math.max(0, e.dist - 12 - i * 10), false);
            if (c) c.parentId = e.id;
          }
          sim.events.push({ type: 'summon', x: e.x, y: e.y, count: sd.at70.count, time: sim.time });
        }
        if (!e.usedOnce.at40 && e.hp <= e.maxHp * 0.4) {
          e.usedOnce.at40 = true;
          e.pendingShield = { amount: sd.at40.shield, at: sim.time + sd.at40.telegraph, dur: sd.at40.dur };
          sim.events.push({ type: 'telegraph-shield', x: e.x, y: e.y, time: sim.time });
        }
        if (!e.usedOnce.at25 && e.hp <= e.maxHp * 0.25) {
          e.usedOnce.at25 = true;
          e.rushUntil = sim.time + sd.at25.dur + sd.at25.telegraph;
          e.rushTelegraph = sim.time + sd.at25.telegraph;
          e.rushBonus = sd.at25.speedBonus;
          sim.events.push({ type: 'rush', x: e.x, y: e.y, time: sim.time });
        }
      }
      if (e.ability === 'elite5') {
        const sd = SUMMON_DEFAULTS.ashcentury;
        e.abTimer -= dt;
        if (e.abTimer <= 0) {
          e.abTimer = sd.shieldCycle;
          if (e.shield <= 0) {
            e.pendingShield = { amount: sd.shield, at: sim.time + sd.telegraph, dur: sd.dur };
            sim.events.push({ type: 'telegraph-shield', x: e.x, y: e.y, time: sim.time });
          }
        }
      }
      // отложенный щит после телеграфа
      if (e.pendingShield && sim.time >= e.pendingShield.at) {
        if (e.shield <= 0) { // новые щиты не складываются
          e.shield = e.pendingShield.amount;
          e.shieldExpires = sim.time + e.pendingShield.dur;
          e.shieldPeriodic = true;
          sim.events.push({ type: 'shield-cast', x: e.x, y: e.y, amount: e.pendingShield.amount, time: sim.time });
        }
        e.pendingShield = null;
      }
      // истечение временных эффектов
      if (e.shieldExpires && sim.time >= e.shieldExpires && e.shieldPeriodic) { e.shield = 0; e.shieldExpires = null; }
      if (e.tempArmorUntil && sim.time >= e.tempArmorUntil) { e.tempArmorBonus = 0; e.tempArmorUntil = null; }
      if (e.mark) { e.mark.timeLeft -= dt; if (e.mark.timeLeft <= 0) e.mark = null; }
      if (e.shred) { e.shred.timeLeft -= dt; if (e.shred.timeLeft <= 0) e.shred.stacks = 0; }
      if (e.burn) {
        if (e.burn.expires > 0) {
          e.burn.expires -= dt;
          e.burn.nextTick -= dt;
          while (e.burn.nextTick <= 0 && !e.dead) {
            e.burn.nextTick += BURN_TICK;
            applyDamage(sim, e, e.burn.dps * BURN_TICK, 'fire', {});
          }
          if (e.burn.expires <= 0) e.burn = null;
        }
      }
    }
  }

  // ---------- ауры брони маршалов (единый пересчёт) ----------
  function refreshArmorAuras(sim) {
    for (const e of sim.enemies) e.armorAuraBonus = 0;
    for (const m of sim.enemies) {
      if (m.dead || !m.defRef.armorAura) continue;
      const aa = m.defRef.armorAura;
      for (const e of sim.enemies) {
        if (e === m || e.dead) continue;
        if (Math.hypot(e.x - m.x, e.y - m.y) <= aa.radius) {
          e.armorAuraBonus = Math.max(e.armorAuraBonus, aa.bonus); // не складываются
        }
      }
    }
  }

  // ---------- механика карты 4: разломы ----------
  function updateRift(sim, dt) {
    if (sim.map.mechanic !== 'rift') return;
    sim.riftCycleT += dt;
    if (sim.riftActiveZone === -1 && sim.riftTelegraphT <= 0 && sim.riftBoostT <= 0) {
      if (sim.riftCycleT >= 10) {
        sim.riftCycleT = 0;
        sim.riftActiveZone = Math.floor(rand(sim) * sim.map.riftZones.length);
        sim.riftTelegraphT = 1.5;
        sim.events.push({ type: 'rift-telegraph', zone: sim.riftActiveZone, time: sim.time });
      }
    }
    if (sim.riftTelegraphT > 0) {
      sim.riftTelegraphT -= dt;
      if (sim.riftTelegraphT <= 0) { sim.riftTelegraphT = 0; sim.riftBoostT = 2.0; }
    } else if (sim.riftBoostT > 0) {
      sim.riftBoostT -= dt;
      if (sim.riftBoostT <= 0) { sim.riftBoostT = 0; sim.riftActiveZone = -1; }
    }
  }

  function riftSpeedFactor(sim, e) {
    if (sim.map.mechanic !== 'rift' || sim.riftBoostT <= 0) return 1;
    const zone = sim.map.riftZones[sim.riftActiveZone];
    const pr = e.dist / sim.routes[e.routeIndex].length;
    return (pr >= zone.from && pr <= zone.to) ? 1.15 : 1;
  }

  // ---------- движение и прорывы ----------
  function moveEnemies(sim, dt) {
    for (const e of sim.enemies) {
      if (e.dead) continue;
      let spd = e.speed;
      // замедление (пол не ниже 45%)
      if (e.slow && e.slow.until > sim.time) {
        const factor = Math.max(SLOW_FLOOR, 1 - e.slow.pct);
        spd *= factor;
      } else e.slow = null;
      // ускорения
      if (e.rushUntil && sim.time < e.rushUntil) {
        const rb = e.rushBonus !== undefined ? e.rushBonus : (e.defRef.drillRush ? e.defRef.drillRush.speedBonus : 0);
        if (sim.time >= (e.rushTelegraph || 0)) spd *= (1 + rb);
      }
      // аура ускорения Стража развилки
      for (const h of sim.enemies) {
        if (h === e || h.dead || h.ability !== 'elite3') continue;
        if (h.hasteUntil && sim.time < h.hasteUntil && Math.hypot(e.x - h.x, e.y - h.y) <= h.defRef.hasteAura.radius) {
          spd *= (1 + h.defRef.hasteAura.speedBonus);
          break; // не суммируется со вторым таким же
        }
      }
      spd *= riftSpeedFactor(sim, e);
      e.dist += spd * dt;
      const routeLen = sim.routes[e.routeIndex].length;
      if (e.dist >= routeLen) {
        // прорыв
        e.dead = true; e.leaked = true;
        sim.baseHp -= e.leak;
        sim.stats.leaks++;
        sim.stats.leakedHp += e.leak;
        sim.events.push({ type: 'leak', kind: e.kindId, damage: e.leak, time: sim.time });
        if (sim.baseHp <= 0) {
          sim.baseHp = 0;
          sim.gameOver = 'lose';
          sim.events.push({ type: 'game-over', result: 'lose', time: sim.time });
        }
        continue;
      }
      const p = pointAt(sim.routes[e.routeIndex].pts, e.dist);
      e.x = p[0]; e.y = p[1];
    }
  }

  // ---------- башни ----------
  function updateTowers(sim, dt) {
    for (const tw of sim.towers) {
      if (!tw.built) {
        tw.cooldown -= dt;
        if (tw.cooldown <= 0) { tw.built = true; }
        continue;
      }
      const tdef = TOWERS[tw.towerId];
      if (tdef.support || tdef.mines) continue;
      const s = towerStats(tw);
      tw.cooldown -= dt;
      if (tw.cooldown > 0) continue;
      const candidates = eligibleTargets(sim, tw);
      const target = pickTarget(sim, tw, candidates);
      if (!target) { tw.cooldown = 0; continue; } // ждём цель, перезарядка готова
      const iv = attackInterval(sim, tw);
      tw.cooldown = iv;
      tw.targetId = target.id;
      tw.angle = Math.atan2(target.y - tw.y, target.x - tw.x);
      if (tdef.instant) {
        const did = instantAttack(sim, tw);
        if (!did) tw.cooldown = 0;
      } else if (tdef.eliteBonus) {
        // Маяк-снайпер: мгновенное точечное попадание без снаряда
        let dmg = s.damage;
        if (target.eliteFlag || target.bossFlag) dmg *= (1 + s.bonusVsElite);
        applyDamage(sim, target, dmg, tdef.damageType, { sourceTower: tw });
        sim.events.push({ type: 'sniper-shot', from: [tw.x, tw.y], to: [target.x, target.y], time: sim.time });
      } else {
        fireProjectile(sim, tw, target);
      }
    }
    // учёт урона по источнику для Корневика
    // (упрощённо: recentDamage обновляется внутри applyDamage через событие)
  }

  // ---------- шаг симуляции ----------
  function stepOnce(sim) {
    if (sim.gameOver) return;
    sim.time += DT;
    // спавн
    if (sim.waveActive) {
      while (sim.waveSpawnQueue.length && sim.waveStartT + sim.waveSpawnQueue[0].t <= sim.time) {
        const item = sim.waveSpawnQueue.shift();
        const ri = chooseRouteForSpawn(sim, item.kind, !!item.boss);
        spawnEnemyAt(sim, item.kind, ri, 0, true);
      }
    }
    refreshArmorAuras(sim);
    updateRift(sim, DT);
    moveEnemies(sim, DT);
    updateEnemyAbilities(sim, DT);
    updateTowers(sim, DT);
    updateProjectiles(sim, DT);
    updateMines(sim, DT);
    // очистка мёртвых (один раз логически удаляем)
    sim.enemies = sim.enemies.filter(e => !e.dead);
    // конец волны: все спавны выполнены, врагов нет, снарядов/мин-эффектов, способных повлиять, тоже
    if (sim.waveActive && sim.waveSpawnQueue.length === 0 && sim.enemies.length === 0 && sim.projectiles.length === 0) {
      const allSpawnDone = sim.time - sim.waveStartT >= sim.waveLastSpawnT;
      if (allSpawnDone) {
        sim.waveActive = false;
        const rw = TD.waveReward(sim.waveIndex);
        sim.credits += rw;
        sim.stats.wavesCleared++;
        sim.stats.waveRewardTotal = (sim.stats.waveRewardTotal || 0) + rw;
        sim.events.push({ type: 'wave-clear', wave: sim.waveIndex + 1, reward: rw, time: sim.time });
        if (sim.waveIndex === sim.map.waves.length - 1 && sim.baseHp > 0) {
          sim.gameOver = 'win';
          sim.events.push({ type: 'game-over', result: 'win', time: sim.time });
        }
      }
    }
  }

  // Публичный API: advance по накопителю времени (для реального рантайма)
  function advance(sim, realDtSeconds, speedMultiplier) {
    if (sim.gameOver) return 0;
    const scaled = realDtSeconds * (speedMultiplier || 1);
    sim.accumulator += Math.min(scaled, 0.5); // защита от «временного долга» при потере фокуса
    let steps = 0;
    while (sim.accumulator >= DT && steps < 300) {
      stepOnce(sim);
      sim.accumulator -= DT;
      steps++;
      if (sim.gameOver) { sim.accumulator = 0; break; }
    }
    return steps;
  }

  // Полностью детерминированный прогон без рендеринга (для тестов)
  function runFixed(sim, seconds) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n && !sim.gameOver; i++) stepOnce(sim);
    return sim;
  }

  root.TD = TD;
  TD.DT = DT;
  TD.createSim = createSim;
  TD.startWave = startWave;
  TD.buildTower = buildTower;
  TD.upgradeTower = upgradeTower;
  TD.sellTower = sellTower;
  TD.canBuild = canBuild;
  TD.upgradeCost = upgradeCost;
  TD.stepOnce = stepOnce;
  TD.advance = advance;
  TD.runFixed = runFixed;
  TD.computeDamage = computeDamage;
  TD.pointAt = pointAt;
  TD.polylineLength = polylineLength;
  TD.buildRoutes = buildRoutes;
  TD.effectiveArmor = effectiveArmor;
  TD.BUILD_TIME = BUILD_TIME;
})(typeof window !== 'undefined' ? window : globalThis);
