/* "Рубеж Эха" — карты, маршруты, площадки, волны (разделы 9 и 10 мастер-промпта). */
(function (root) {
  'use strict';

  // Помощник записи групп волны: g(enemy, count, interval)
  function g(enemy, count, interval) { return { enemy, count, interval }; }
  // boss/элита после последней обычной группы через delay секунд
  function gb(enemy, delay) { return { enemy, count: 1, interval: 0, bossDelay: delay }; }

  const MAPS = [
    {
      id: 'map1', name: 'Залив Мшистых Колоколен', firstReward: 210, startCredits: 250,
      threat: 'Обучающая: броня у Панцирника, рои Бегунков, огонь против слизней. Туманники снижают радиус башен.',
      locals: ['slime', 'spore', 'fogger'],
      route: [[0, 300], [160, 300], [160, 170], [370, 170], [370, 390], [620, 390], [620, 250], [850, 250], [1000, 250]],
      platforms: [[120, 235], [215, 125], [285, 215], [420, 260], [485, 335], [560, 435], [680, 320], [745, 195], [860, 320], [915, 190]],
      mechanic: 'fog',
      mechanicDesc: 'Болотный туман отмечает Туманников; карта сама по себе дальность не уменьшает.',
      waves: [
        [g('walker', 10, 0.9)],
        [g('runner', 12, 0.7)],
        [g('walker', 7, 0.9), g('runner', 5, 0.7)],
        [g('slime', 6, 1.2), g('runner', 6, 0.7)],
        [g('walker', 6, 0.9), gb('youngqueen', 4)],
        [g('armored', 5, 1.4), g('walker', 6, 0.9)],
        [g('spore', 3, 2.0), g('runner', 8, 0.7)],
        [g('flyer', 8, 0.8), g('armored', 4, 1.4)],
        [g('fogger', 3, 1.8), g('slime', 5, 1.2), g('runner', 6, 0.7)],
        [g('armored', 4, 1.4), g('spore', 3, 2.0), gb('mossqueen', 4)]
      ]
    },
    {
      id: 'map2', name: 'Медные Ворота', firstReward: 240, startCredits: 260,
      threat: 'Прочная броня маршалов, взрывы искровых жуков, рывки буровых таранов.',
      locals: ['sparkbug', 'marshal', 'drill'],
      route: [[0, 100], [240, 100], [240, 500], [500, 500], [500, 130], [760, 130], [760, 450], [1000, 450]],
      platforms: [[115, 165], [190, 60], [310, 220], [320, 445], [420, 555], [440, 300], [560, 70], [675, 185], [690, 390], [825, 510], [890, 390]],
      mechanic: 'none',
      mechanicDesc: 'Длинные прямые участки выигрывают снайперу; узкие повороты — Праще и Шипомёту.',
      waves: [
        [g('walker', 10, 0.9)],
        [g('runner', 8, 0.7), g('sparkbug', 4, 1.0)],
        [g('armored', 5, 1.4), g('walker', 6, 0.9)],
        [g('marshal', 4, 2.2), g('runner', 8, 0.7)],
        [g('sparkbug', 6, 1.0), gb('rivetcommander', 4)],
        [g('drill', 4, 1.8), g('walker', 6, 0.9)],
        [g('marshal', 3, 2.4), g('armored', 5, 1.4), g('runner', 5, 0.7)],
        [g('flyer', 8, 0.8), g('sparkbug', 4, 1.0)],
        [g('drill', 3, 1.8), g('marshal', 3, 2.4), g('runner', 6, 0.7)],
        [g('shieldbearer', 6, 1.3), g('drill', 4, 1.8), gb('rivetgeneral', 4)]
      ]
    },
    {
      id: 'map3', name: 'Кроны Двух Троп', firstReward: 270, startCredits: 270,
      threat: 'Развилка: наземные волны делятся 50/50 между ветвями. Воздушные Листолёты, лечение Пыльцесборщиков.',
      locals: ['leafwing', 'rootling', 'pollen'],
      fork: {
        entry: [[0, 300], [150, 300]],
        upper: [[150, 300], [220, 150], [470, 150], [600, 300]],
        lower: [[150, 300], [220, 450], [470, 450], [600, 300]],
        exit: [[600, 300], [760, 300], [760, 180], [900, 180], [1000, 180]]
      },
      route: [[0, 300], [150, 300], [220, 150], [470, 150], [600, 300], [760, 300], [760, 180], [900, 180], [1000, 180]],
      platforms: [[90, 235], [175, 85], [320, 105], [500, 215], [175, 520], [320, 505], [500, 390], [665, 245], [725, 365], [835, 120], [910, 240]],
      mechanic: 'fork',
      mechanicDesc: 'Наземные враги обычных групп чередуются между верхней и нижней ветвью 50/50 (детерминированно). Босс и элиты идут по общему маршруту после слияния.',
      waves: [
        [g('walker', 10, 0.9)],
        [g('leafwing', 8, 0.8), g('runner', 6, 0.7)],
        [g('pollen', 5, 1.7), g('walker', 6, 0.9)],
        [g('rootling', 4, 2.0), g('runner', 8, 0.7)],
        [g('leafwing', 6, 0.8), gb('forkguard', 4)],
        [g('armored', 5, 1.4), g('pollen', 4, 1.7)],
        [g('rootling', 3, 2.0), g('leafwing', 8, 0.8)],
        [g('flyer', 8, 0.8), g('armored', 5, 1.4)],
        [g('pollen', 4, 1.7), g('rootling', 4, 2.0), g('runner', 6, 0.7)],
        [g('armored', 5, 1.4), g('leafwing', 6, 0.8), gb('oldtrunk', 4)]
      ]
    },
    {
      id: 'map4', name: 'Соляной Разлом', firstReward: 300, startCredits: 285,
      threat: 'Прыгуны смещаются вперёд по маршруту; разломы ускоряют врагов; прочные колоссы.',
      locals: ['leaper', 'solemorph', 'saltcolossus'],
      route: [[0, 500], [150, 500], [150, 350], [400, 350], [400, 200], [650, 200], [650, 450], [850, 450], [850, 300], [1000, 300]],
      platforms: [[85, 430], [220, 285], [295, 395], [345, 270], [465, 145], [550, 260], [600, 390], [735, 505], [790, 380], [910, 235], [920, 385]],
      mechanic: 'rift',
      mechanicDesc: 'Три секции маршрута отмечены разломами: раз в 10 с одна секция пульсирует 1.5 с, затем 2 с враги в ней получают +15% скорости.',
      riftZones: [{ from: 0.18, to: 0.30 }, { from: 0.45, to: 0.58 }, { from: 0.74, to: 0.86 }],
      waves: [
        [g('walker', 10, 0.9)],
        [g('leaper', 8, 1.0)],
        [g('solemorph', 5, 1.5), g('runner', 6, 0.7)],
        [g('saltcolossus', 4, 2.2), g('walker', 5, 0.9)],
        [g('solemorph', 5, 1.5), gb('saltguard', 4)],
        [g('leaper', 5, 1.0), g('armored', 5, 1.4)],
        [g('saltcolossus', 3, 2.2), g('runner', 6, 0.7)],
        [g('flyer', 8, 0.8), g('solemorph', 5, 1.5)],
        [g('leaper', 4, 1.0), g('saltcolossus', 4, 2.2), g('runner', 4, 0.7)],
        [g('solemorph', 5, 1.5), g('saltcolossus', 4, 2.2), gb('zerosalt', 4)]
      ]
    },
    {
      id: 'map5', name: 'Пепельная Обсерватория', firstReward: 330, startCredits: 300,
      threat: 'Иллюзии отвлекают одиночные снаряды; Гравитоны снижают радиус; быстрые кометные жуки в воздухе.',
      locals: ['ashdouble', 'graviton', 'cometbug'],
      route: [[0, 300], [200, 300], [200, 100], [420, 100], [420, 500], [650, 500], [650, 180], [850, 180], [850, 400], [1000, 400]],
      platforms: [[100, 235], [150, 370], [275, 55], [345, 185], [355, 425], [500, 555], [565, 430], [590, 120], [730, 110], [765, 260], [910, 325]],
      mechanic: 'nodes',
      mechanicDesc: 'Два гравитационных узла — только декорация; радиус меняют лишь телеграфируемые импульсы Гравитонов.',
      waves: [
        [g('walker', 10, 0.9)],
        [g('cometbug', 8, 0.8), g('runner', 6, 0.7)],
        [g('ashdouble', 5, 1.5), g('walker', 5, 0.9)],
        [g('graviton', 4, 2.0), g('runner', 8, 0.7)],
        [g('cometbug', 6, 0.8), gb('ashcentury', 4)],
        [g('shieldbearer', 5, 1.3), g('ashdouble', 5, 1.5)],
        [g('graviton', 3, 2.0), g('cometbug', 8, 0.8)],
        [g('armored', 5, 1.4), g('ashdouble', 6, 1.5), g('runner', 5, 0.7)],
        [g('graviton', 4, 2.0), g('cometbug', 6, 0.8), g('shieldbearer', 4, 1.3)],
        [g('ashdouble', 5, 1.5), g('graviton', 4, 2.0), gb('asharchivist', 4)]
      ]
    }
  ];

  // Награда за завершение волны: 18, кроме волн 5 и 10 — 30
  function waveReward(waveIndex) {
    return (waveIndex === 4 || waveIndex === 9) ? 30 : 18;
  }

  function getMap(id) { return MAPS.find(m => m.id === id); }

  root.TD = root.TD || {};
  root.TD.MAPS = MAPS;
  root.TD.waveReward = waveReward;
  root.TD.getMap = getMap;
})(typeof window !== 'undefined' ? window : globalThis);
