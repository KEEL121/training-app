// @ts-check
// circuits.js — サーキットトレーニングのプリセット定義
// 実際の実施順は settings.circuitOrder、秒数は settings.circuitTiming(どちらもユーザー変更可)。
// 有酸素種目・収録マシンは固定(v1)。

export const DEFAULT_CIRCUIT = {
  id: 'circuit-default',
  name: 'サーキットトレーニング',
  // マシン順(初期値)。実際の順は settings.circuitOrder
  machineIds: [
    'ex-leg-extension',
    'ex-leg-curl',
    'ex-squat',
    'ex-lat-pulldown',
    'ex-seated-row',
    'ex-shoulder-press',
    'ex-bicep-curl',
    'ex-triceps-press',
    'ex-abdominal',
    'ex-chest-press',
  ],
  aerobicId: 'ex-stair-climbing', // 各サイクルの有酸素ステーション
  // セッション全体の消費カロリーを計上する種目(8.0 METs)。
  // マシン実働+階段の足し算ではレスト時間が落ちて3〜4割の過小評価になる
  sessionId: 'ex-circuit-training',
  timing: { machineSec: 60, restSec: 30, aerobicSec: 60, rest2Sec: 30 },
};

/**
 * ゴム負荷の段階数。サーキットの器具はレベル選択式で重量(kg)が分からないため、
 * サーキットの記録は kg ではなくこのレベルで残す。
 * 器具を替える場合はここだけ変える。
 * ※ sync.js のサニタイザ範囲とは意図的に別(あちらはスキーマ境界で、
 *   ここを下げても既存データが消えないように広く取ってある)。
 */
export const LEVEL_MAX = 12;

/**
 * 秒数設定の許容範囲(設定画面の入力欄もこの定義から生成する)。
 * 1サイクル=4セグメント構成は固定のため(進捗計算が segIndex/4 前提)、
 * 「レストなし」に相当する0秒は許可せず下限を5秒とする。
 */
export const TIMING_LIMITS = {
  machineSec: { min: 10, max: 300, label: 'マシン(秒)' },
  restSec: { min: 5, max: 300, label: 'マシン後のレスト(秒)' },
  aerobicSec: { min: 10, max: 600, label: '有酸素(階段昇降)(秒)' },
  rest2Sec: { min: 5, max: 300, label: '有酸素後のレスト(秒)' },
};

/**
 * @typedef {Object} Segment
 * @property {'machine'|'rest'|'aerobic'} kind
 * @property {number} sec
 * @property {string} [exerciseId]  machine/aerobic のとき
 * @property {number} [machineIndex] machine のとき(0始まり、何台目か)
 */

/**
 * マシン順とタイミングから全セグメント列を生成。
 * 1サイクル = machine → rest → aerobic → rest。これを machineIds 台ぶん。
 * @param {string[]} order マシンIDの実施順
 * @param {{machineSec:number,restSec:number,aerobicSec:number,rest2Sec:number}} timing
 * @param {string} aerobicId
 * @returns {Segment[]}
 */
export function buildSegments(order, timing, aerobicId) {
  const segs = [];
  order.forEach((exId, i) => {
    segs.push({ kind: 'machine', sec: timing.machineSec, exerciseId: exId, machineIndex: i });
    segs.push({ kind: 'rest', sec: timing.restSec });
    segs.push({ kind: 'aerobic', sec: timing.aerobicSec, exerciseId: aerobicId });
    segs.push({ kind: 'rest', sec: timing.rest2Sec });
  });
  return segs;
}

/** 合計所要秒数 */
export function totalSeconds(order, timing) {
  return order.length * (timing.machineSec + timing.restSec + timing.aerobicSec + timing.rest2Sec);
}

/** 合計所要時間の表示用文字列(例: "30分") */
export function formatTotal(order, timing) {
  return `${Math.round(totalSeconds(order, timing) / 60)}分`;
}

/**
 * 保存された circuitTiming を検証して正規化。
 * 未設定・型不正・範囲外は既定値/範囲内へ丸める(不正値でタイマーが壊れないように)。
 * @param {any} value
 * @returns {{machineSec:number,restSec:number,aerobicSec:number,rest2Sec:number}}
 */
export function normalizeTiming(value) {
  const out = {};
  for (const key of Object.keys(TIMING_LIMITS)) {
    const lim = TIMING_LIMITS[key];
    const v = Math.round(Number(value == null ? NaN : value[key]));
    out[key] = Number.isFinite(v)
      ? Math.min(Math.max(v, lim.min), lim.max)
      : DEFAULT_CIRCUIT.timing[key];
  }
  // @ts-ignore 上のループで4キーすべて埋まる
  return out;
}

/**
 * 保存された circuitOrder を検証して正規化。
 * 既知マシンIDのみ・重複除去し、DEFAULT_CIRCUIT.machineIds に在って欠けたものは末尾補完。
 * @param {any} order
 * @param {Set<string>} validIds 現存する種目ID集合(削除済み除外後)
 * @returns {string[]}
 */
export function normalizeOrder(order, validIds) {
  const base = DEFAULT_CIRCUIT.machineIds;
  const known = new Set(base);
  const seen = new Set();
  const result = [];
  if (Array.isArray(order)) {
    for (const id of order) {
      if (typeof id === 'string' && known.has(id) && !seen.has(id) && (!validIds || validIds.has(id))) {
        result.push(id);
        seen.add(id);
      }
    }
  }
  // 欠けている既定マシン(未削除のもの)を末尾に補完
  for (const id of base) {
    if (!seen.has(id) && (!validIds || validIds.has(id))) result.push(id);
  }
  return result.length > 0 ? result : base.slice();
}
