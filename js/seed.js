// @ts-check
// seed.js — 初回起動時の初期データ投入

import { getAll, put, getSetting, putSetting, requestPersist } from './db.js';
import { uuid, nowISO } from './util.js';
import { DEFAULT_EXERCISES } from './data/default-exercises.js';

export const SCHEMA_VERSION = 1;

export const DEFAULT_SUGGESTION = { targetRepsHigh: 10, targetRepsLow: 8, recoveryHours: 48 };
export const DEFAULT_REST_TIMER = { sec: 90, enabled: true };

/** 初回起動時のセットアップ(冪等) */
export async function seedIfNeeded() {
  // 永続ストレージ要求はデータ投入前に(iOSストレージ削除対策)
  await requestPersist();

  if (!(await getSetting('deviceId'))) {
    await putSetting('deviceId', uuid());
  }
  if (!(await getSetting('suggestion'))) {
    await putSetting('suggestion', { ...DEFAULT_SUGGESTION });
  }
  if (!(await getSetting('restTimer'))) {
    await putSetting('restTimer', { ...DEFAULT_REST_TIMER });
  }
  if (!(await getSetting('dateCutoff'))) {
    await putSetting('dateCutoff', { hour: 3 }); // 深夜トレは午前3時まで前日扱い
  }

  const seededVersion = await getSetting('seedVersion', 0);
  if (seededVersion >= 1) return;

  const existing = await getAll('exercises', { includeDeleted: true });
  const existingIds = new Set(existing.map((e) => e.id));
  const now = nowISO();
  for (const ex of DEFAULT_EXERCISES) {
    if (existingIds.has(ex.id)) continue; // インポート済み等で存在する場合は触らない
    await put('exercises', { ...ex, createdAt: now, deletedAt: null });
  }
  await putSetting('seedVersion', 1);
}
