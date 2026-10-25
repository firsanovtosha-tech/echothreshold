/* "Рубеж Эха" — сохранение прогресса в localStorage (раздел 13 мастер-промпта). */
(function (root) {
  'use strict';

  const KEY = 'echothreshold_save_v2';
  const LEGACY_KEYS = ['echothreshold_save_v1'];

  const DEFAULT_STATE = {
    version: 2,
    chronicles: 200,             // постоянная валюта аккаунта (раздел 11.2 ТЗ)
    unlockedMaps: ['map1'],
    firstRewards: {},            // mapId -> true (награда за первое прохождение выдана)
    repeatWins: {},              // mapId -> число повторных побед (для +20/+10/+5)
    towerUnlocks: { watch: true, crossbow: true, sling: true, cryo: true, flamethrower: true },
    bestResults: {},             // mapId -> { hp, timeSec, wavesCleared }
    totalPlaySeconds: 0,
    settings: { musicVolume: 0.5, sfxVolume: 0.7, screenShake: true, colorblind: false }
  };

  // Награда за повторные победы: 1-й повтор +20, 2-й +10, 3-й +5, дальше 0
  function repeatReward(winCount) {
    return winCount === 1 ? 20 : winCount === 2 ? 10 : winCount === 3 ? 5 : 0;
  }

  // Максимальная суммарная выплата за карту за всю кампанию:
  // firstReward + 20 + 10 + 5 (все платные повторы). Используется тестами баланса.
  function winRewardTotal(firstRewardAmount) {
    return firstRewardAmount + 20 + 10 + 5;
  }
  function isPlainObject(o) { return o && typeof o === 'object' && !Array.isArray(o); }

  function sanitizeState(parsed) {
    const merged = structuredCloneSafe(DEFAULT_STATE);
    if (!isPlainObject(parsed)) return merged;
    for (const k of ['unlockedMaps', 'firstRewards', 'repeatWins', 'towerUnlocks', 'bestResults']) {
      if (Array.isArray(parsed[k]) || isPlainObject(parsed[k])) merged[k] = parsed[k];
    }
    if (typeof parsed.migratedFromV1 === 'boolean') merged.migratedFromV1 = parsed.migratedFromV1;
    if (typeof parsed.chronicles === 'number' && Number.isFinite(parsed.chronicles) && parsed.chronicles >= 0) {
      merged.chronicles = Math.floor(parsed.chronicles);
    }
    if (typeof parsed.totalPlaySeconds === 'number' && Number.isFinite(parsed.totalPlaySeconds) && parsed.totalPlaySeconds >= 0) {
      merged.totalPlaySeconds = Math.round(parsed.totalPlaySeconds);
    }
    if (isPlainObject(parsed.settings)) merged.settings = Object.assign({}, DEFAULT_STATE.settings, parsed.settings);
    // жёсткие гарантии целостности
    if (!Array.isArray(merged.unlockedMaps) || merged.unlockedMaps.length === 0) merged.unlockedMaps = ['map1'];
    if (!merged.unlockedMaps.includes('map1')) merged.unlockedMaps.unshift('map1');
    merged.firstRewards = isPlainObject(merged.firstRewards) ? merged.firstRewards : {};
    merged.repeatWins = isPlainObject(merged.repeatWins) ? merged.repeatWins : {};
    merged.bestResults = isPlainObject(merged.bestResults) ? merged.bestResults : {};
    merged.towerUnlocks = Object.assign({}, DEFAULT_STATE.towerUnlocks, isPlainObject(merged.towerUnlocks) ? merged.towerUnlocks : {});
    // стартовые башни всегда разблокированы
    for (const t of TD.TOWER_ORDER) if (TD.TOWERS[t].starter) merged.towerUnlocks[t] = true;
    return merged;
  }

  function readRaw(key) {
    try { return root.localStorage.getItem(key); } catch (e) { return null; }
  }

  function load() {
    let raw = readRaw(KEY);
    let migration = false;
    if (!raw) {
      for (const lk of LEGACY_KEYS) {
        const legacy = readRaw(lk);
        if (legacy) {
          try {
            const old = JSON.parse(legacy);
            if (isPlainObject(old)) {
              // миграция v1: не было хроник — выдаём стартовый запас
              raw = JSON.stringify(Object.assign({}, old, {
                chronicles: typeof old.chronicles === 'number' ? old.chronicles : DEFAULT_STATE.chronicles
              }));
              migration = true;
            }
          } catch (e) { /* повреждённое legacy-сохранение игнорируем */ }
          break;
        }
      }
    }
    if (!raw) return structuredCloneSafe(DEFAULT_STATE);
    try {
      const state = sanitizeState(JSON.parse(raw));
      // миграцию выполняем ОДИН раз и помечаем её флагом в новом ключе,
      // иначе повторное «прочитать v1 → смёржить» удваивало бы прогресс/награды
      if (migration) {
        state.migratedFromV1 = true;
        save(state);
      }
      return state;
    } catch (e) {
      return structuredCloneSafe(DEFAULT_STATE);
    }
  }

  function save(state) {
    try {
      state.totalPlaySeconds = Math.round((state.totalPlaySeconds || 0));
      root.localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) { return false; }
  }

  function reset() {
    try { root.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  function structuredCloneSafe(o) { return JSON.parse(JSON.stringify(o)); }

  function isMapUnlocked(state, mapId) { return state.unlockedMaps.includes(mapId); }

  function unlockNextMap(state, completedMapId) {
    const idx = TD.MAPS.findIndex(m => m.id === completedMapId);
    if (idx >= 0 && idx + 1 < TD.MAPS.length) {
      const next = TD.MAPS[idx + 1].id;
      if (!state.unlockedMaps.includes(next)) {
        state.unlockedMaps.push(next);
        save(state); // разблокировка должна пережить перезагрузку страницы
      }
    }
  }

  function recordResult(state, mapId, result) {
    const prev = state.bestResults[mapId];
    const better = !prev || result.hp > prev.hp || (result.hp === prev.hp && result.timeSec < prev.timeSec);
    if (better) {
      state.bestResults[mapId] = { hp: result.hp, timeSec: result.timeSec, wavesCleared: result.wavesCleared };
      save(state);
    }
  }

  // Покупка разблокировки башни за хроники. Атомарно: проверка → списание ровно один раз → сохранение.
  function buyTowerUnlock(state, towerId) {
    const def = TD.TOWERS[towerId];
    if (!def) return { ok: false, reason: 'Неизвестная башня.' };
    if (state.towerUnlocks[towerId]) return { ok: false, reason: 'Башня уже открыта.' };
    const cost = def.unlockCost;
    if (cost <= 0) return { ok: false, reason: 'Башня доступна бесплатно.' };
    if (state.chronicles < cost) return { ok: false, reason: `Недостаточно хроник: нужно ${cost}, есть ${state.chronicles}.` };
    state.chronicles -= cost;
    state.towerUnlocks[towerId] = true;
    const saved = save(state);
    return { ok: true, remaining: state.chronicles, saved };
  }

  // Награда за победу (раздел 11.2 ТЗ). Идемпотентно по флагам состояния:
  // 1-я победа на карте выдаёт firstReward; победы 2..4 довыдают +20/+10/+5 хроник;
  // начиная с 5-й победы — 0 (защита от бесконечного фарма). Счётчики хранятся по каждой карте.
  function grantWinRewards(state, mapId, firstRewardAmount) {
    let gained = 0, kind = 'repeat';
    if (!state.firstRewards[mapId]) {
      state.firstRewards[mapId] = true;
      state.repeatWins[mapId] = 0;
      gained += firstRewardAmount;
      kind = 'first';
    } else {
      const n = (state.repeatWins[mapId] || 0) + 1; // номер повторной победы (1 = вторая всего)
      if (n <= 3) gained = repeatReward(n);         // 20 / 10 / 5
      state.repeatWins[mapId] = n;
    }
    state.chronicles += gained;
    save(state);
    return { gained, kind };
  }

  root.TD = root.TD || {};
  root.TD.Save = { KEY, load, save, reset, isMapUnlocked, unlockNextMap, recordResult, buyTowerUnlock, grantWinRewards, repeatReward, winRewardTotal, sanitizeState, DEFAULT_STATE };
})(typeof window !== 'undefined' ? window : globalThis);
