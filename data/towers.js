/* "Рубеж Эха" — единый источник истины по башням.
 * Все числа буквально соответствуют разделу 6 мастер-промпта.
 * Типы урона: physical | magic | fire | acid
 * target: groundAir | ground ; effectKind описывает спецмеханику.
 */
(function (root) {
  'use strict';

  // level 0 = базовая, 1 = улучшение I, 2 = улучшение II
  const TOWERS = {
    watch: {
      id: 'watch', name: 'Дозорный', role: 'Универсальная начальная башня',
      unlockCost: 0, starter: true, icon: 'watch',
      damageType: 'physical', targets: 'groundAir', projectileSpeed: 320,
      levels: [
        { buildCost: 70, damage: 18, interval: 0.75, radius: 130, maxTargets: 1 },
        { upgradeCost: 55, damage: 24, interval: 0.70, radius: 135, maxTargets: 1 },
        { upgradeCost: 95, damage: 31, interval: 0.62, radius: 145, maxTargets: 1 }
      ]
    },
    crossbow: {
      id: 'crossbow', name: 'Арбалетчик', role: 'Точный удар по прочным целям',
      unlockCost: 0, starter: true, icon: 'crossbow',
      damageType: 'physical', targets: 'groundAir', projectileSpeed: 420,
      levels: [
        { buildCost: 100, damage: 55, interval: 1.80, radius: 205, maxTargets: 1, armorPen: 15 },
        { upgradeCost: 45, damage: 72, interval: 1.75, radius: 215, maxTargets: 1, armorPen: 20 },
        { upgradeCost: 85, damage: 90, interval: 1.60, radius: 230, maxTargets: 1, armorPen: 25 }
      ]
    },
    sling: {
      id: 'sling', name: 'Праща', role: 'Массовый урон по плотной группе',
      unlockCost: 0, starter: true, icon: 'sling',
      damageType: 'physical', targets: 'ground', projectileSpeed: 250, splash: true,
      levels: [
        { buildCost: 85, damage: 15, interval: 0.90, radius: 125, splashRadius: 36, maxTargets: 3 },
        { upgradeCost: 55, damage: 19, interval: 0.85, radius: 125, splashRadius: 40, maxTargets: 4 },
        { upgradeCost: 90, damage: 24, interval: 0.80, radius: 125, splashRadius: 45, maxTargets: 5 }
      ]
    },
    cryo: {
      id: 'cryo', name: 'Криоматрица', role: 'Контроль быстрых врагов',
      unlockCost: 0, starter: true, icon: 'cryo',
      damageType: 'magic', targets: 'groundAir', projectileSpeed: 300, slow: true,
      levels: [
        { buildCost: 95, damage: 7, interval: 1.00, radius: 145, maxTargets: 1, slowPct: 0.28, slowDur: 1.6 },
        { upgradeCost: 60, damage: 10, interval: 0.90, radius: 155, maxTargets: 1, slowPct: 0.33, slowDur: 1.8 },
        { upgradeCost: 105, damage: 14, interval: 0.85, radius: 165, maxTargets: 1, slowPct: 0.38, slowDur: 2.0 }
      ]
    },
    flamethrower: {
      id: 'flamethrower', name: 'Огнемёт', role: 'Ближний урон по группам',
      unlockCost: 0, starter: true, icon: 'flame',
      damageType: 'fire', targets: 'ground', instant: true, cone: true, burn: true,
      levels: [
        { buildCost: 115, damage: 8, interval: 0.20, radius: 95, coneDeg: 70, maxTargets: 4, burnDps: 3, burnDur: 3 },
        { upgradeCost: 70, damage: 10, interval: 0.20, radius: 100, coneDeg: 80, maxTargets: 5, burnDps: 4, burnDur: 3 },
        { upgradeCost: 120, damage: 12, interval: 0.18, radius: 110, coneDeg: 85, maxTargets: 6, burnDps: 5, burnDur: 3 }
      ]
    },
    arcanist: {
      id: 'arcanist', name: 'Арканист', role: 'Магический урон и метка',
      unlockCost: 160, starter: false, icon: 'arcanist',
      damageType: 'magic', targets: 'groundAir', projectileSpeed: 290, mark: true,
      levels: [
        { buildCost: 130, damage: 42, interval: 1.40, radius: 160, maxTargets: 1, markBonus: 0.08, markDur: 3 },
        { upgradeCost: 65, damage: 55, interval: 1.30, radius: 170, maxTargets: 1, markBonus: 0.12, markDur: 3 },
        { upgradeCost: 110, damage: 70, interval: 1.20, radius: 180, maxTargets: 1, markBonus: 0.15, markDur: 3 }
      ]
    },
    thunder: {
      id: 'thunder', name: 'Громовой узел', role: 'Цепной магический урон',
      unlockCost: 190, starter: false, icon: 'thunder',
      damageType: 'magic', targets: 'groundAir', instant: true, chain: true, chainRange: 65,
      levels: [
        { buildCost: 145, damage: 32, interval: 1.10, radius: 150, maxTargets: 3, chainFactors: [1, 0.65, 0.40] },
        { upgradeCost: 75, damage: 39, interval: 1.05, radius: 158, maxTargets: 4, chainFactors: [1, 0.70, 0.50, 0.35] },
        { upgradeCost: 130, damage: 47, interval: 0.95, radius: 168, maxTargets: 5, chainFactors: [1, 0.75, 0.55, 0.40, 0.30] }
      ]
    },
    sniper: {
      id: 'sniper', name: 'Маяк-снайпер', role: 'Дальний удар по элитам и боссам',
      unlockCost: 220, starter: false, icon: 'sniper',
      damageType: 'physical', targets: 'ground', projectileSpeed: 520, instantHit: true, eliteBonus: true,
      levels: [
        { buildCost: 160, damage: 115, interval: 3.00, radius: 280, maxTargets: 1, bonusVsElite: 0.35 },
        { upgradeCost: 75, damage: 150, interval: 2.80, radius: 300, maxTargets: 1, bonusVsElite: 0.40 },
        { upgradeCost: 125, damage: 195, interval: 2.60, radius: 320, maxTargets: 1, bonusVsElite: 0.50 }
      ]
    },
    spike: {
      id: 'spike', name: 'Шипомёт', role: 'Пробивание линии наземных целей',
      unlockCost: 200, starter: false, icon: 'spike',
      damageType: 'physical', targets: 'ground', projectileSpeed: 360, linePierce: true, pierceWidth: 10,
      levels: [
        { buildCost: 120, damage: 21, interval: 1.20, radius: 120, maxTargets: 4 },
        { upgradeCost: 55, damage: 28, interval: 1.10, radius: 130, maxTargets: 5 },
        { upgradeCost: 95, damage: 36, interval: 1.00, radius: 140, maxTargets: 6 }
      ]
    },
    obelisk: {
      id: 'obelisk', name: 'Обелиск синхронизации', role: 'Поддержка обороны',
      unlockCost: 260, starter: false, icon: 'obelisk',
      damageType: 'none', targets: 'none', support: true,
      levels: [
        { buildCost: 150, damage: 0, interval: 0, radius: 0, auraRadius: 100, attackSpeedBonus: 0.12 },
        { upgradeCost: 80, damage: 0, interval: 0, radius: 0, auraRadius: 120, attackSpeedBonus: 0.17 },
        { upgradeCost: 130, damage: 0, interval: 0, radius: 0, auraRadius: 140, attackSpeedBonus: 0.22 }
      ]
    },
    corroder: {
      id: 'corroder', name: 'Коррозионщик', role: 'Снижение брони прочных врагов',
      unlockCost: 240, starter: false, icon: 'corroder',
      damageType: 'physical', targets: 'groundAir', projectileSpeed: 280, shred: true,
      levels: [
        { buildCost: 125, damage: 10, interval: 0.80, radius: 145, maxTargets: 1, shredAmount: 15, shredMaxStacks: 2, shredDur: 4 },
        { upgradeCost: 65, damage: 14, interval: 0.75, radius: 155, maxTargets: 1, shredAmount: 18, shredMaxStacks: 2, shredDur: 4 },
        { upgradeCost: 110, damage: 18, interval: 0.70, radius: 165, maxTargets: 1, shredAmount: 20, shredMaxStacks: 3, shredDur: 4 }
      ]
    },
    minefield: {
      id: 'minefield', name: 'Минный сад', role: 'Подготовленная зона взрывного урона',
      unlockCost: 280, starter: false, icon: 'mine',
      damageType: 'physical', targets: 'ground', mines: true, mineBlastRadius: 35,
      levels: [
        { buildCost: 100, damage: 70, interval: 4.0, radius: 110, maxMines: 3 },
        { upgradeCost: 50, damage: 95, interval: 4.0, radius: 120, maxMines: 3 },
        { upgradeCost: 90, damage: 130, interval: 3.5, radius: 130, maxMines: 4 }
      ]
    }
  };

  const ORDER = ['watch', 'crossbow', 'sling', 'cryo', 'flamethrower', 'arcanist',
    'thunder', 'sniper', 'spike', 'obelisk', 'corroder', 'minefield'];

  function towerLevelStats(towerId, level) {
    return TOWERS[towerId].levels[level];
  }

  // Полная стоимость экземпляра: строительство + купленные улучшения
  function totalSpent(towerId, level) {
    let sum = TOWERS[towerId].levels[0].buildCost;
    for (let i = 1; i <= level; i++) sum += TOWERS[towerId].levels[i].upgradeCost;
    return sum;
  }

  function sellRefund(towerId, level) {
    return Math.floor(totalSpent(towerId, level) * 0.6);
  }

  function nominalDps(towerId, level) {
    const t = TOWERS[towerId], s = t.levels[level];
    if (t.support || t.mines || s.interval <= 0 || !s.damage) return 0;
    if (t.cone) return (s.damage / s.interval) * s.maxTargets + s.burnDps * s.maxTargets;
    if (t.chain) {
      const fsum = s.chainFactors.reduce((a, b) => a + b, 0);
      return s.damage * fsum / s.interval;
    }
    if (t.splash) return s.damage * s.maxTargets / s.interval;
    if (t.linePierce) return s.damage * s.maxTargets / s.interval;
    return s.damage / s.interval;
  }

  root.TD = root.TD || {};
  root.TD.TOWERS = TOWERS;
  root.TD.TOWER_ORDER = ORDER;
  root.TD.towerLevelStats = towerLevelStats;
  root.TD.totalSpent = totalSpent;
  root.TD.sellRefund = sellRefund;
  root.TD.nominalDps = nominalDps;
})(typeof window !== 'undefined' ? window : globalThis);
