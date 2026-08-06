// @ts-check
// calories.js — METs方式の消費カロリー計算(純ロジック・UI非依存)
//
// 式: kcal = (METs - 1) × 体重(kg) × 時間(h) × 1.05
//   1.05 = 1MET(3.5mL/kg/min)を kcal/kg/h に換算した係数
//        (3.5 × 5kcal/L ÷ 1000 × 60 = 1.05)
//   (METs - 1) とするのは「じっとしていても消費する分(安静時代謝)」を差し引き、
//   運動で"追加で"消費した分(net)を返すため。METsをそのまま使うと約20%過大になり、
//   「食べた分を運動で相殺する」用途で必ず失敗する。
//
// 筋トレは「挙上している時間」と「セット間レスト」でMETsが大きく違う。
// レストまで種目のMETsで計上すると実測の1.8倍程度に膨らむため、両者を分けて計算する。

const SET_MINUTES = 3;        // 時間未入力時の推定: 1セットあたり3分(レスト込み)
const SET_WORK_MINUTES = 0.5; // うち実際に挙上している時間(残りはレスト扱い)
const REST_METS = 2.0;        // セット間の立位・軽い動き

/** 安静時代謝を差し引いた正味の消費kcal(丸めなし) */
function netKcal(mets, weightKg, minutes) {
  if (!mets || !weightKg || !minutes || minutes <= 0) return 0;
  return Math.max(0, mets - 1) * weightKg * (minutes / 60) * 1.05;
}

/**
 * 単一METsでの消費カロリー(安静時代謝を控除した正味・整数丸め)
 * @param {number} mets
 * @param {number} weightKg
 * @param {number} minutes
 * @returns {number} kcal
 */
export function kcal(mets, weightKg, minutes) {
  return Math.round(netKcal(mets, weightKg, minutes));
}

/**
 * 筋トレ1記録の消費カロリー(挙上時間とレスト時間を分けて計算)
 * durationMin が明示的に0の記録は「時間を別レコードに計上済み」の意味で0kcalを返す
 * (サーキット由来のマシン記録がこれ。セッション全体を1件の有酸素記録で計上している)
 * @param {{sets: {done?: boolean}[], durationMin?: number|null}} workout
 * @param {{mets: number}} exercise
 * @param {number} weightKg その日(または直近)の体重
 * @returns {{kcal: number, minutes: number, estimated: boolean}} estimated=時間が推定値か
 */
export function workoutKcal(workout, exercise, weightKg) {
  const doneSets = (workout.sets || []).filter((s) => s.done !== false).length;
  const minutes = workout.durationMin != null ? workout.durationMin : doneSets * SET_MINUTES;
  const workMin = Math.min(minutes, doneSets * SET_WORK_MINUTES);
  const restMin = Math.max(0, minutes - workMin);
  return {
    kcal: Math.round(
      netKcal(exercise?.mets ?? 5.0, weightKg, workMin) + netKcal(REST_METS, weightKg, restMin),
    ),
    minutes,
    estimated: workout.durationMin == null,
  };
}

/**
 * 有酸素1記録の消費カロリー
 * @param {{durationMin: number}} cardio
 * @param {{mets: number}} exercise
 * @param {number} weightKg
 */
export function cardioKcal(cardio, exercise, weightKg) {
  return kcal(exercise?.mets ?? 5.0, weightKg, cardio.durationMin || 0);
}

/**
 * ある日付時点で使う体重を解決する。
 * 優先順: その日のbody → それ以前で直近のbody → プロフィールのfallback → null
 * @param {string} dateStr YYYY-MM-DD
 * @param {{date: string, weightKg: number}[]} bodyRecords (deletedAt除外済み)
 * @param {{fallbackWeightKg?: number}|null} profile
 */
export function resolveWeight(dateStr, bodyRecords, profile) {
  const candidates = bodyRecords
    .filter((b) => b.date <= dateStr && b.weightKg > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (candidates.length > 0) return candidates[0].weightKg;
  if (profile && profile.fallbackWeightKg > 0) return profile.fallbackWeightKg;
  return null;
}
