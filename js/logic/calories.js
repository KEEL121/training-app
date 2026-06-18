// @ts-check
// calories.js — METs方式の消費カロリー計算(純ロジック・UI非依存)
// 式: kcal = METs × 体重(kg) × 時間(h) × 1.05

const SET_MINUTES = 3; // 筋トレの時間未入力時: 1セットあたり3分で推定

/**
 * @param {number} mets
 * @param {number} weightKg
 * @param {number} minutes
 * @returns {number} kcal(整数丸め)
 */
export function kcal(mets, weightKg, minutes) {
  if (!mets || !weightKg || !minutes) return 0;
  return Math.round(mets * weightKg * (minutes / 60) * 1.05);
}

/**
 * 筋トレ1記録の消費カロリー
 * @param {{sets: {done?: boolean}[], durationMin?: number|null}} workout
 * @param {{mets: number}} exercise
 * @param {number} weightKg その日(または直近)の体重
 * @returns {{kcal: number, minutes: number, estimated: boolean}} estimated=時間が推定値か
 */
export function workoutKcal(workout, exercise, weightKg) {
  const doneSets = (workout.sets || []).filter((s) => s.done !== false).length;
  const minutes = workout.durationMin || doneSets * SET_MINUTES;
  return {
    kcal: kcal(exercise?.mets ?? 5.0, weightKg, minutes),
    minutes,
    estimated: !workout.durationMin,
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
