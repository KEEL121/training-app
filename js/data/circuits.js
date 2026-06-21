// @ts-check
// circuits.js — サーキットトレーニングのプリセット定義
// 実際の実施順は settings.circuitOrder(ユーザーが並べ替え可)を使う。
// 秒数・有酸素種目・収録マシンは固定(v1)。

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
  timing: { machineSec: 60, restSec: 30, aerobicSec: 60, rest2Sec: 30 },
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
