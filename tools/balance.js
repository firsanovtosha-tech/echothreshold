/* Оффлайн-прогон баланса: "компетентный игрок" для каждой карты.
 * Стратегия: после каждой волны достраиваем/улучшаем башни по простым правилам,
 * начиная со стартового набора и открывая новые типы за кредиты разблокировки. */
'use strict';
const path = require('path');
const R = p => require(path.join(__dirname, '..', p));
R('data/towers.js'); R('data/enemies.js'); R('data/maps.js'); R('engine/simulation.js');
const TD = globalThis.TD;

// предпочтительная тактическая расстановка (индексы площадок) для каждой карты
const PREF = {
  map1: [2, 3, 4, 5, 6, 7, 8, 0, 1, 9],
  map2: [3, 4, 5, 7, 8, 9, 0, 1, 2, 6, 10],
  map3: [3, 6, 7, 8, 0, 1, 2, 4, 5, 9, 10],
  map4: [2, 3, 5, 6, 7, 8, 0, 1, 4, 9, 10],
  map5: [3, 4, 6, 7, 8, 0, 1, 2, 5, 9, 10]
};
// порядок интереса к башням (сначала дешёвые надёжные, потом ситуативные)
const INTEREST = ['watch', 'crossbow', 'sling', 'cryo', 'flamethrower', 'arcanist', 'thunder', 'sniper', 'spike', 'corroder', 'minefield', 'obelisk'];

function playMap(mapId, opts) {
  const map = TD.getMap(mapId);
  let loadout = ['watch', 'crossbow', 'sling', 'cryo', 'flamethrower'];
  const sim = TD.createSim(map, loadout.slice());
  sim.loadout = loadout;
  const unlocked = new Set(['watch', 'crossbow', 'sling', 'cryo', 'flamethrower']);
  const pref = PREF[mapId];
  let pi = 0; // указатель следующей свободной площадки из предпочтений

  function tryUnlockMore() {
    for (const t of INTEREST) {
      if (unlocked.has(t)) continue;
      const def = TD.TOWERS[t];
      if (sim.credits >= def.unlockCost + def.levels[0].buildCost && loadout.length < 5) {
        sim.credits -= def.unlockCost;
        unlocked.add(t); loadout.push(t); sim.loadout = loadout.slice();
        return true;
      }
    }
    return false;
  }

  function spendPhase() {
    // 1) открыть новую башню если есть запас
    while (loadout.length < 5 && tryUnlockMore()) { /* несколько открытий подряд при избытке */ }
    // 2) построить на следующей предпочтительной площадке самую нужную доступную башню
    let acted = true;
    while (acted) {
      acted = false;
      // найти следующую свободную площадку
      while (pi < pref.length && sim.platforms[pref[pi]].towerId !== null) pi++;
      if (pi >= pref.length) break;
      // выбрать башню: сначала те, что ещё не стоят нигде, иначе самая сильная доступная
      const counts = {};
      for (const tw of sim.towers) counts[tw.towerId] = (counts[tw.towers || 0], (counts[tw.towerId] || 0) + 1);
      let pick = null;
      for (const t of loadout) {
        const c = TD.TOWERS[t].levels[0].buildCost;
        if (sim.credits >= c && (!counts[t] || counts[t] < 2)) { pick = t; break; }
      }
      if (!pick) for (const t of loadout) if (sim.credits >= TD.TOWERS[t].levels[0].buildCost) { pick = t; break; }
      if (pick) {
        const r = TD.buildTower(sim, pref[pi], pick);
        if (r.ok) { pi++; acted = true; } else break;
      }
    }
    // 3) улучшения существующих башен (round-robin), оставляя резерв
    const RESERVE = 60;
    let upg = true;
    while (upg) {
      upg = false;
      for (const tw of sim.towers) {
        const cost = TD.upgradeCost(sim, tw);
        if (cost !== null && sim.credits - cost >= RESERVE) {
          const r = TD.upgradeTower(sim, tw.id);
          if (r.ok) { upg = true; }
        }
      }
    }
  }

  for (let w = 0; w < map.waves.length && !sim.gameOver; w++) {
    spendPhase();
    TD.startWave(sim, w);
    // гоним до конца волны (максимум 240 с модельного времени на волну)
    let guard = 0;
    while ((sim.waveActive || sim.enemies.length || sim.projectiles.length) && !sim.gameOver && guard < 240 * 60) {
      TD.stepOnce(sim); guard++;
    }
    if (opts && opts.trace) {
      console.log(`  wave ${w + 1}: t=${sim.time.toFixed(0)}s hp=${sim.baseHp} credits=${sim.credits} towers=${sim.towers.length} kills=${sim.stats.kills} leaks=${sim.stats.leaks}`);
    }
  }
  return {
    mapId, result: sim.gameOver || 'timeout',
    hp: sim.baseHp, time: Math.round(sim.time),
    wavesCleared: sim.stats.wavesCleared, kills: sim.stats.kills, leaks: sim.stats.leaks,
    towers: sim.towers.length, creditsLeft: sim.credits
  };
}

const results = [];
for (const m of TD.MAPS) {
  const r = playMap(m.id, { trace: process.argv.includes('--trace') });
  results.push(r);
  console.log(`${m.id} ${m.name}: ${r.result.toUpperCase()} hp=${r.hp}/20 время=${r.time}s волны=${r.wavesCleared}/10 убийств=${r.kills} прорывов=${r.leaks} башен=${r.towers}`);
}
const wins = results.filter(r => r.result === 'win').length;
console.log(`\nИтог: ${wins}/5 побед.`);
process.exit(wins === 5 ? 0 : 1);
