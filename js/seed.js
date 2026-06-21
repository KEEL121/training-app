// @ts-check
// seed.js — 初回起動時の初期データ投入

import { getAll, put, getSetting, putSetting, requestPersist } from './db.js';
import { uuid, nowISO } from './util.js';
import { DEFAULT_EXERCISES } from './data/default-exercises.js';
import { DEFAULT_CIRCUIT } from './data/circuits.js';

export const SCHEMA_VERSION = 1;

// 既定種目セットのバージョン。新規種目を追加したらバンプする。
// バンプ時、既存ユーザーにも未登録の既定種目がID照合で一度だけ補充される。
export const SEED_VERSION = 2;

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
  // サーキットのマシン順(初期値)。ユーザーが並べ替えたら上書きされる
  if (!(await getSetting('circuitOrder'))) {
    await putSetting('circuitOrder', DEFAULT_CIRCUIT.machineIds.slice());
  }

  // 既定種目の補充: SEED_VERSION 未満のときだけ実行(起動毎の全件走査を避ける)。
  // 既存・削除済み(deletedAt)とID照合し、未登録のものだけ追加 → 削除した種目は復活しない。
  const seededVersion = await getSetting('seedVersion', 0);
  if (seededVersion >= SEED_VERSION) return;

  const existing = await getAll('exercises', { includeDeleted: true });
  const existingIds = new Set(existing.map((e) => e.id));
  const now = nowISO();
  for (const ex of DEFAULT_EXERCISES) {
    if (existingIds.has(ex.id)) continue; // 既存・インポート済み・削除済みは触らない
    await put('exercises', { ...ex, createdAt: now, deletedAt: null });
  }
  await putSetting('seedVersion', SEED_VERSION);
}
