// @ts-check
// sync.js — エクスポート/インポート/マージ(純ロジック+I/O)
//
// セキュリティ方針(インポートは本アプリ唯一の外部入力経路):
// - 許可リスト方式: 既知ストア・既知フィールドのみを新オブジェクトに詰め替える
//   (受信オブジェクトをそのままputしない → プロトタイプ汚染も構造的に排除)
// - 型・範囲・長さチェック。違反レコードはスキップして件数報告
// - DoSガード: ファイル50MB・各ストア10万件上限
//
// マージ方針:
// - IDベース newer-wins(updatedAt比較)。tombstone(deletedAt)も同ルールで伝播
// - 同値時のtie-breakはレコードJSONの辞書順(決定論的=往復しても振動しない)
// - 双方が前回同期以降に更新したレコードは「競合」として自動適用せず呼び出し側へ返す
// - settings.deviceId はインポート対象から除外

import { getAll, bulkPutSync, STORES } from '../db.js';
import { SCHEMA_VERSION } from '../seed.js';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_RECORDS_PER_STORE = 100000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^ex-[a-z0-9-]{1,50}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?([+-]\d{2}:?\d{2})?$/;

/* ============ エクスポート ============ */

export async function buildExport() {
  const data = {};
  for (const store of STORES) {
    data[store] = await getAll(store, { includeDeleted: true }); // tombstone含む全件
  }
  // deviceId はマージに使用せず、含めると端末追跡子が平文で外部に出るため同梱しない
  return {
    app: 'training-log',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function exportFileName(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `training-export-${y}-${m}-${d}.json`;
}

/* ============ バリデーション(許可リスト方式) ============ */

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, min, max) => (Number.isFinite(v) && v >= min && v <= max ? v : null);
const bool = (v) => v === true;
const isoOrNull = (v) => (typeof v === 'string' && ISO_RE.test(v) ? v : null);

/** 既知フィールドのみ詰め替えるサニタイザ群。不正レコードはnullを返す */
const sanitizers = {
  exercises(r) {
    const id = typeof r.id === 'string' && (UUID_RE.test(r.id) || SLUG_RE.test(r.id)) ? r.id : null;
    const name = str(r.name, 100).trim();
    const type = r.type === 'strength' || r.type === 'cardio' ? r.type : null;
    if (!id || !name || !type) return null;
    const groups = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core'];
    return {
      id, name, type,
      muscleGroup: groups.includes(r.muscleGroup) ? r.muscleGroup : null,
      mets: num(r.mets, 0.5, 30) ?? 5.0,
      increment: num(r.increment, 0, 100) ?? 2.5,
      isCompound: bool(r.isCompound),
      hasDistance: bool(r.hasDistance),
      sortOrder: num(r.sortOrder, 0, 100000) ?? 500,
      ...timestamps(r),
    };
  },
  workouts(r) {
    const id = typeof r.id === 'string' && UUID_RE.test(r.id) ? r.id : null;
    const date = typeof r.date === 'string' && DATE_RE.test(r.date) ? r.date : null;
    const exerciseId = typeof r.exerciseId === 'string' && (UUID_RE.test(r.exerciseId) || SLUG_RE.test(r.exerciseId)) ? r.exerciseId : null;
    if (!id || !date || !exerciseId || !Array.isArray(r.sets)) return null;
    const sets = r.sets.slice(0, 50).map((s) => ({
      weight: num(s?.weight, 0, 1000),
      reps: num(s?.reps, 0, 1000),
      done: s?.done !== false,
    }));
    return {
      id, date, exerciseId, sets,
      durationMin: num(r.durationMin, 1, 1440),
      note: str(r.note, 500),
      ...timestamps(r),
    };
  },
  cardio(r) {
    const id = typeof r.id === 'string' && UUID_RE.test(r.id) ? r.id : null;
    const date = typeof r.date === 'string' && DATE_RE.test(r.date) ? r.date : null;
    const exerciseId = typeof r.exerciseId === 'string' && (UUID_RE.test(r.exerciseId) || SLUG_RE.test(r.exerciseId)) ? r.exerciseId : null;
    const durationMin = num(r.durationMin, 1, 1440);
    if (!id || !date || !exerciseId || !durationMin) return null;
    return {
      id, date, exerciseId, durationMin,
      distanceKm: num(r.distanceKm, 0, 1000),
      note: str(r.note, 500),
      ...timestamps(r),
    };
  },
  body(r) {
    const date = typeof r.date === 'string' && DATE_RE.test(r.date) ? r.date : null;
    const weightKg = num(r.weightKg, 20, 300);
    if (!date || !weightKg) return null;
    return {
      date, weightKg,
      bodyFatPct: num(r.bodyFatPct, 1, 60),
      muscleKg: num(r.muscleKg, 5, 150),
      source: r.source === 'ocr' ? 'ocr' : 'manual',
      note: str(r.note, 500),
      ...timestamps(r),
    };
  },
  settings(r) {
    const allowedKeys = ['profile', 'suggestion', 'restTimer', 'dateCutoff', 'onboarded', 'seedVersion'];
    // deviceId / lastExportAt / activeWorkout は端末固有のため取り込まない
    if (typeof r.key !== 'string' || !allowedKeys.includes(r.key)) return null;
    let value = null;
    switch (r.key) {
      case 'profile':
        value = {
          fallbackWeightKg: num(r.value?.fallbackWeightKg, 20, 300),
          heightCm: num(r.value?.heightCm, 100, 250),
        };
        break;
      case 'suggestion':
        value = {
          targetRepsHigh: num(r.value?.targetRepsHigh, 1, 50) ?? 10,
          targetRepsLow: num(r.value?.targetRepsLow, 1, 50) ?? 8,
          recoveryHours: num(r.value?.recoveryHours, 0, 336) ?? 48,
        };
        break;
      case 'restTimer':
        value = { sec: num(r.value?.sec, 10, 600) ?? 90, enabled: r.value?.enabled !== false };
        break;
      case 'dateCutoff':
        value = { hour: num(r.value?.hour, 0, 12) ?? 3 };
        break;
      case 'onboarded': value = r.value === true; break;
      case 'seedVersion': value = num(r.value, 0, 100) ?? 0; break;
    }
    return { key: r.key, value, ...timestamps(r) };
  },
};

function timestamps(r) {
  return {
    createdAt: isoOrNull(r.createdAt) || new Date().toISOString(),
    updatedAt: isoOrNull(r.updatedAt) || new Date(0).toISOString(),
    deletedAt: isoOrNull(r.deletedAt),
  };
}

/**
 * インポートファイルの検証+サニタイズ
 * @param {string} jsonText
 * @returns {{ok: true, data: Object<string, any[]>, skipped: number} | {ok: false, error: string}}
 */
export function parseImport(jsonText) {
  if (jsonText.length > MAX_FILE_BYTES) return { ok: false, error: 'ファイルが大きすぎます(50MB上限)' };
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: 'JSONとして読み込めませんでした' };
  }
  if (!parsed || parsed.app !== 'training-log') {
    return { ok: false, error: 'このアプリのエクスポートファイルではありません' };
  }
  if (typeof parsed.schemaVersion !== 'number' || parsed.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: '新しいバージョンのファイルです。アプリを更新してください' };
  }
  // schemaVersion < 現行 の場合はここでマイグレーション関数を通す(v1では不要)

  const data = {};
  let skipped = 0;
  for (const store of STORES) {
    const rows = Array.isArray(parsed.data?.[store]) ? parsed.data[store] : [];
    if (rows.length > MAX_RECORDS_PER_STORE) {
      return { ok: false, error: `${store} のレコード数が多すぎます` };
    }
    data[store] = [];
    for (const raw of rows) {
      if (typeof raw !== 'object' || raw === null) { skipped++; continue; }
      const clean = sanitizers[store](raw);
      if (clean) data[store].push(clean);
      else skipped++;
    }
  }
  return { ok: true, data, skipped };
}

/* ============ マージ ============ */

/**
 * マージ計画を作成(まだ書き込まない)
 * @param {Object<string, any[]>} incoming parseImport済みデータ
 * @param {string|null} baselineISO 前回同期時刻(これ以降に双方が更新→競合扱い)。nullなら競合判定なし
 * @returns {Promise<{adds: number, updates: number, deletes: number,
 *   conflicts: {store: string, local: any, incoming: any}[],
 *   toWrite: Object<string, any[]>}>}
 */
export async function planMerge(incoming, baselineISO) {
  const toWrite = {};
  const conflicts = [];
  let adds = 0, updates = 0, deletes = 0;

  for (const store of STORES) {
    const keyField = store === 'body' ? 'date' : store === 'settings' ? 'key' : 'id';
    const localAll = await getAll(store, { includeDeleted: true });
    const localByKey = new Map(localAll.map((r) => [r[keyField], r]));
    toWrite[store] = [];

    for (const inc of incoming[store] || []) {
      const local = localByKey.get(inc[keyField]);
      if (!local) {
        toWrite[store].push(inc);
        if (inc.deletedAt) deletes++; else adds++;
        continue;
      }
      if (recordsEqual(local, inc)) continue;

      // 競合判定: 双方がbaseline以降に更新
      if (
        baselineISO &&
        local.updatedAt > baselineISO &&
        inc.updatedAt > baselineISO &&
        local.updatedAt !== inc.updatedAt
      ) {
        conflicts.push({ store, local, incoming: inc });
        continue;
      }

      const winner = pickWinner(local, inc);
      if (winner === inc) {
        toWrite[store].push(inc);
        if (inc.deletedAt && !local.deletedAt) deletes++;
        else updates++;
      }
    }
  }
  return { adds, updates, deletes, conflicts, toWrite };
}

/** newer-wins。同時刻はJSON辞書順で決定論的にtie-break(往復で振動しない) */
export function pickWinner(a, b) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return stableStringify(a) >= stableStringify(b) ? a : b;
}

/** キー順に依存しない正規化JSON(サニタイザの詰め替えでキー順が変わるため必須) */
function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

function recordsEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

/**
 * マージ適用。競合の解決結果(ユーザー選択済み)も合わせて書き込む。
 * 全ストアを単一トランザクションで原子的に書く。
 */
export async function applyMerge(plan, resolvedConflicts = []) {
  const toWrite = { ...plan.toWrite };
  for (const { store, record } of resolvedConflicts) {
    if (!toWrite[store]) toWrite[store] = [];
    toWrite[store].push(record);
  }
  await bulkPutSync(toWrite);
}
