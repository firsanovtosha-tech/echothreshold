/* "Рубеж Эха" — единый источник истины по врагам (разделы 7 и 8 мастер-промпта). */
(function (root) {
  'use strict';

  // ability: ключ особой механики, реализуемой движком симуляции
  const ENEMIES = {
    // ==== Общие противники (раздел 7) ====
    walker: { id: 'walker', name: 'Прахоход', hp: 65, speed: 28, armor: 0, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 6, leak: 1, ground: true, ability: null, desc: 'Базовый наземный враг.' },
    runner: { id: 'runner', name: 'Бегунок', hp: 42, speed: 48, armor: 0, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 5, leak: 1, ground: true, ability: null, desc: 'Быстрый, мало HP.' },
    armored: { id: 'armored', name: 'Панцирник', hp: 210, speed: 18, armor: 55, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 12, leak: 2, ground: true, ability: null, elite: false, desc: 'Медленный; хорошо держит физические атаки за счёт брони.' },
    shieldbearer: { id: 'shieldbearer', name: 'Щитоносец', hp: 110, shield: 65, speed: 22, armor: 25, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 11, leak: 2, ground: true, ability: 'shieldRegen', desc: 'Когда не получал урон 3 с, восстанавливает щит по 6/с до 65.' },
    flyer: { id: 'flyer', name: 'Крылатый', hp: 60, speed: 52, armor: 0, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 7, leak: 1, ground: false, ability: null, desc: 'Воздушный; башни «только по земле» его не выбирают.' },
    healer: { id: 'healer', name: 'Целитель', hp: 130, speed: 20, armor: 10, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 12, leak: 1, ground: true, ability: 'healAura', heal: { interval: 1.0, radius: 85, amount: 12, maxTargets: 3 }, desc: 'Каждую секунду лечит до 3 других врагов в радиусе 85 на 12 HP.' },
    splitter: { id: 'splitter', name: 'Разделитель', hp: 95, speed: 24, armor: 15, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 9, leak: 1, ground: true, ability: 'split', split: { count: 2, child: 'shard' }, desc: 'При гибели создаёт 2 осколка (без награды).' },
    phaser: { id: 'phaser', name: 'Фазовик', hp: 120, speed: 34, armor: 15, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 12, leak: 1, ground: true, ability: 'phase', phase: { cycle: 4.0, telegraph: 0.6, active: 0.7, reduction: 0.45 }, desc: 'Каждые 4 с на 0.7 с снижает входящий урон на 45%.' },
    titan: { id: 'titan', name: 'Осадный титан', hp: 480, speed: 12, armor: 75, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 22, leak: 3, ground: true, elite: true, slowEff: 1.0, ability: null, desc: 'Элита; крупный силуэт; замедления действуют полностью.' },

    // Осколок Разделителя (не даёт награды)
    shard: { id: 'shard', name: 'Осколок', hp: 34, speed: 35, armor: 0, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 0, leak: 1, ground: true, ability: null, noReward: true, small: true, desc: 'Осколок Разделителя. Награды не даёт.' },

    // ==== Карта 1: Залив Мшистых Колоколен ====
    slime: { id: 'slime', name: 'Липкий слизень', hp: 130, speed: 16, armor: 0, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, fireVuln: 1.30, slowDurFactor: 0.5, reward: 10, leak: 1, ground: true, ability: null, desc: '+30% урона от огня; длительность замедления сокращена на 50%.' },
    spore: { id: 'spore', name: 'Споровик', hp: 100, speed: 20, armor: 5, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 12, leak: 1, ground: true, ability: 'attackDebuffAura', debuffAura: { radius: 90, attackSpeedPenalty: 0.08 }, desc: 'Снижает скорость атак башен в радиусе 90 на 8% (не складывается).' },
    fogger: { id: 'fogger', name: 'Туманник', hp: 75, speed: 31, armor: 0, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 10, leak: 1, ground: true, ability: 'fogCloud', fog: { cycle: 5.0, telegraph: 1.0, dur: 2.5, radius: 90, rangePenalty: 0.15 }, desc: 'Раз в 5 с на 2.5 с снижает радиус ближайших башен в пределах 90 на 15%.' },
    youngqueen: { id: 'youngqueen', name: 'Молодая матка', hp: 850, speed: 12, armor: 35, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 35, leak: 4, ground: true, elite: true, ability: 'summon', summon: { interval: 14.0, count: 2, child: 'shard', telegraph: 1.2 }, boss: false, desc: 'Элита волны 5: раз в 14 с создаёт 2 осколка.' },
    mossqueen: { id: 'mossqueen', name: 'Матка мха', hp: 1650, speed: 10, armor: 50, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 60, leak: 5, ground: true, elite: true, boss: true, slowEff: 0.5, ability: 'boss1', desc: 'Босс: раз в 12 с призывает 4 осколка; на 50% HP один раз ещё 3.' },

    // ==== Карта 2: Медные Ворота ====
    sparkbug: { id: 'sparkbug', name: 'Искровой жук', hp: 85, speed: 40, armor: 5, res: { physical: 0, magic: 0.25, fire: 0, acid: 0 }, reward: 10, leak: 1, ground: true, ability: 'deathBlast', deathBlast: { radius: 42, damage: 35, type: 'magic' }, desc: 'При гибели наносит 35 маг. урона всем врагам в радиусе 42.' },
    marshal: { id: 'marshal', name: 'Железный маршал', hp: 200, speed: 16, armor: 65, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 18, leak: 2, ground: true, ability: 'armorAura', armorAura: { radius: 85, bonus: 15 }, desc: 'Даёт другим врагам в радиусе 85 +15 брони (ауры не складываются).' },
    drill: { id: 'drill', name: 'Буровой таран', hp: 310, speed: 15, armor: 45, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 20, leak: 3, ground: true, elite: false, slowEff: 0.5, ability: 'drillRush', drillRush: { threshold: 0.25, dur: 3.0, speedBonus: 0.25, telegraph: 1.0 }, desc: 'Замедления 50% эффективности; ниже 25% HP один раз ускоряется на 25% на 3 с.' },
    rivetgeneral: { id: 'rivetgeneral', name: 'Генерал Клёпка', hp: 2400, speed: 10, armor: 80, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 70, leak: 5, ground: true, elite: true, boss: true, slowEff: 0.5, ability: 'boss2', desc: 'Босс: каждые 20 с щит 250 на 5 с; на 50% HP вызывает 4 Искровых жуков.' },
    rivetcommander: { id: 'rivetcommander', name: 'Командир заклёпок', hp: 1200, speed: 12, armor: 55, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 40, leak: 4, ground: true, elite: true, ability: 'elite2', desc: 'Элитный: каждые 10 с усиливает ближайших врагов на +10 брони на 5 с.' },

    // ==== Карта 3: Кроны Двух Троп ====
    leafwing: { id: 'leafwing', name: 'Листолёт', hp: 78, speed: 58, armor: 0, res: { physical: 0.20, magic: -0.10, fire: 0, acid: 0 }, reward: 9, leak: 1, ground: false, ability: null, desc: 'Воздушный; +20% физ. сопротивление, уязвим к магии.' },
    rootling: { id: 'rootling', name: 'Корневик', hp: 180, speed: 15, armor: 30, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 15, leak: 2, ground: true, ability: 'towerSuppress', suppress: { cycle: 8.0, telegraph: 1.0, dur: 2.0, radius: 60, attackPenalty: 0.20 }, desc: 'Каждые 8 с на 2 с подавляет одну башню рядом (−20% скорости атак).' },
    pollen: { id: 'pollen', name: 'Пыльцесборщик', hp: 125, speed: 22, armor: 5, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 13, leak: 1, ground: true, ability: 'healAura', heal: { interval: 4.0, radius: 90, amount: 45, maxTargets: 3 }, desc: 'Раз в 4 с лечит до 3 других врагов в радиусе 90 на 45 HP.' },
    oldtrunk: { id: 'oldtrunk', name: 'Старый Ствол', hp: 2600, speed: 9, armor: 65, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 80, leak: 5, ground: true, elite: true, boss: true, slowEff: 0.5, ability: 'boss3', desc: 'Босс: на 70% HP создаёт 3 Корневика-стража; на 40% HP щит 400 на 6 с после телеграфа 2 с.' },
    forkguard: { id: 'forkguard', name: 'Страж развилки', hp: 1500, speed: 10, armor: 50, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 45, leak: 4, ground: true, elite: true, ability: 'elite3', hasteAura: { cycle: 12.0, dur: 4.0, radius: 90, speedBonus: 0.15 }, desc: 'Элитный: раз в 12 с на 4 с ускоряет врагов рядом на 15%.' },
    rootguard: { id: 'rootguard', name: 'Корневик-страж', hp: 180, speed: 15, armor: 30, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 0, leak: 1, ground: true, ability: null, noReward: true, desc: 'Призыв Старого Ствола. Награды не даёт.' },

    // ==== Карта 4: Соляной Разлом ====
    leaper: { id: 'leaper', name: 'Разломный прыгун', hp: 140, speed: 36, armor: 10, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 15, leak: 1, ground: true, ability: 'leap', leap: { cycle: 7.0, telegraph: 1.2, distance: 80 }, desc: 'Каждые 7 с телеграфирует 1.2 с и перемещается вперёд на 80 единиц маршрута.' },
    solemorph: { id: 'solemorph', name: 'Солеморф', hp: 160, speed: 19, armor: 15, res: { physical: -0.10, magic: 0.35, fire: 0, acid: 0 }, reward: 14, leak: 1, ground: true, ability: null, desc: 'Уязвим к физическому, strongly сопротивляется магии (+35%).' },
    saltcolossus: { id: 'saltcolossus', name: 'Соляной колосс', hp: 440, speed: 10, armor: 70, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 24, leak: 3, ground: true, elite: true, ability: 'colossusShield', colossusShield: { cycle: 12.0, telegraph: 1.5, dur: 1.5, amount: 120 }, desc: 'Каждые 12 с после телеграфа создаёт щит 120 на 1.5 с (не складывается).' },
    zerosalt: { id: 'zerosalt', name: 'Нулевой Соль', hp: 3200, speed: 9, armor: 55, res: { physical: 0, magic: 0.10, fire: 0, acid: 0 }, reward: 90, leak: 5, ground: true, elite: true, boss: true, slowEff: 0.5, ability: 'boss4', desc: 'Босс: на 70% HP призывает двух Солеморфов; на 40% HP щит 500 на 5 с.' },
    saltguard: { id: 'saltguard', name: 'Соляной страж', hp: 1700, speed: 10, armor: 60, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 50, leak: 4, ground: true, elite: true, ability: 'elite4', desc: 'Элитный: получает щит 160 один раз на 50% HP после телеграфа 1.5 с.' },

    // ==== Карта 5: Пепельная Обсерватория ====
    ashdouble: { id: 'ashdouble', name: 'Пепельный двойник', hp: 160, speed: 30, armor: 20, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 17, leak: 1, ground: true, ability: 'illusion', illusion: { cycle: 8.0, telegraph: 0.8, dur: 1.2 }, desc: 'Каждые 8 с создаёт иллюзию, отвлекающую один одиночный снаряд. Настоящее тело помечено.' },
    graviton: { id: 'graviton', name: 'Гравитон', hp: 260, speed: 13, armor: 35, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 20, leak: 2, ground: true, ability: 'gravityPulse', gravityPulse: { cycle: 6.0, telegraph: 1.0, dur: 2.0, radius: 90, rangePenalty: 0.15 }, desc: 'Каждые 6 с на 2 с снижает радиус башен в пределах 90 на 15%.' },
    cometbug: { id: 'cometbug', name: 'Кометный жук', hp: 90, speed: 62, armor: 0, res: { physical: 0.25, magic: -0.10, fire: 0, acid: 0 }, reward: 10, leak: 1, ground: false, ability: null, desc: 'Воздушный быстрый; +25% к физике, уязвим к магии.' },
    asharchivist: { id: 'asharchivist', name: 'Архивариус Пепла', hp: 4200, speed: 9, armor: 70, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 110, leak: 5, ground: true, elite: true, boss: true, slowEff: 0.5, ability: 'boss5', desc: 'Босс: на 70% HP призывает 2 Гравитона; на 40% HP щит 500 на 5 с; на 25% HP ускоряется на 20% на 8 с.' },
    ashcentury: { id: 'ashcentury', name: 'Часовой пепла', hp: 1900, speed: 10, armor: 60, res: { physical: 0, magic: 0, fire: 0, acid: 0 }, reward: 55, leak: 4, ground: true, elite: true, ability: 'elite5', desc: 'Элитный: раз в 12 с создаёт щит 180 на 4 с после телеграфа (один щит одновременно).' }
  };

  // параметры призывов боссов (для единообразия)
  const SUMMON_DEFAULTS = {
    mossqueen: { summonInterval: 12.0, shardsPerCast: 4, child: 'shard', halfHpShards: 3 },
    rivetgeneral: { shieldAmount: 250, shieldDur: 5, shieldCycle: 20, halfHpSummon: { enemy: 'sparkbug', count: 4 } },
    oldtrunk: { at70: { enemy: 'rootguard', count: 3 }, at40: { shield: 400, dur: 6, telegraph: 2 } },
    zerosalt: { at70: { enemy: 'solemorph', count: 2 }, at40: { shield: 500, dur: 5 } },
    asharchivist: { at70: { enemy: 'graviton', count: 2 }, at40: { shield: 500, dur: 5, telegraph: 2 }, at25: { speedBonus: 0.20, dur: 8, telegraph: 1.5 } },
    rivetcommander: { buffCycle: 10, buffArmor: 10, buffDur: 5, buffRadius: 90 },
    saltguard: { at50: { shield: 160, dur: 5, telegraph: 1.5 } },
    ashcentury: { shieldCycle: 12, shield: 180, dur: 4, telegraph: 1.2 }
  };

  function getEnemy(id) { return ENEMIES[id]; }

  root.TD = root.TD || {};
  root.TD.ENEMIES = ENEMIES;
  root.TD.SUMMON_DEFAULTS = SUMMON_DEFAULTS;
  root.TD.getEnemy = getEnemy;
})(typeof window !== 'undefined' ? window : globalThis);
