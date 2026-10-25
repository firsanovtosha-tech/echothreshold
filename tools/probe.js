'use strict';
const path = require('path');
const R = p => require(path.join(__dirname, '..', p));
R('data/towers.js'); R('data/enemies.js'); R('data/maps.js'); R('engine/simulation.js');
const TD = globalThis.TD;

// probe1: без башен — должна быть поражение (HP обнуляется)
{
  const sim = TD.createSim(TD.getMap('map1'), ['watch']);
  for (let w = 0; w < 10 && !sim.gameOver; w++) { TD.startWave(sim, w); TD.runFixed(sim, 300); }
  console.log('probe1 no-towers:', sim.gameOver, 'hp', sim.baseHp, 'leaks', sim.stats.leaks);
}
// probe2: одна Дозорная башня на map1 — сколько волн выдержит
{
  const sim = TD.createSim(TD.getMap('map1'), ['watch']);
  TD.buildTower(sim, 3, 'watch');
  let cleared = 0;
  for (let w = 0; w < 10 && !sim.gameOver; w++) { TD.startWave(sim, w); TD.runFixed(sim, 300); if (sim.stats.wavesCleared > cleared) cleared = sim.stats.wavesCleared; }
  console.log('probe2 one-watch:', 'cleared', cleared, 'result', sim.gameOver || 'ongoing', 'hp', sim.baseHp);
}
// probe3: только крио-спам (5 башен L0 cryo) на map1
{
  const sim = TD.createSim(TD.getMap('map1'), ['cryo']);
  [2,3,4,5,6].forEach(p => TD.buildTower(sim, p, 'cryo'));
  for (let w = 0; w < 10 && !sim.gameOver; w++) { TD.startWave(sim, w); TD.runFixed(sim, 300); }
  console.log('probe3 cryo-only:', sim.gameOver || 'ongoing', 'hp', sim.baseHp, 'cleared', sim.stats.wavesCleared);
}
// probe4: неправильный набор — снайперы+огнемёты против воздуха на map5 wave8 (flyers)
{
  const sim = TD.createSim(TD.getMap('map5'), ['sniper','flamethrower']);
  [3,4,6,7].forEach(p => TD.buildTower(sim, p, 'sniper'));
  TD.startWave(sim, 7); TD.runFixed(sim, 200);
  console.log('probe4 ground-only vs air:', 'leaks', sim.stats.leaks, '(ожидаем прорыв воздуха)');
}
// probe5: полная защита L2 на map1 (перебор)
{
  const sim = TD.createSim(TD.getMap('map1'), ['watch','crossbow','sling','cryo','flamethrower']);
  sim.credits = 99999;
  const kinds=['watch','crossbow','sling','cryo','flamethrower'];
  sim.platforms.forEach((pf,i)=>{ const r=TD.buildTower(sim,i,kinds[i%5]); if(r.ok){TD.upgradeTower(sim,r.tower.id);TD.upgradeTower(sim,r.tower.id);} });
  for (let w = 0; w < 10 && !sim.gameOver; w++) { TD.startWave(sim, w); TD.runFixed(sim, 300); }
  console.log('probe5 full-L2:', sim.gameOver, 'hp', sim.baseHp, 'time', Math.round(sim.time), 's');
}
