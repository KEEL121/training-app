// @ts-check
// stats.js — ボリューム・推定1RM・週次集計(純ロジック・UI非依存)
// 週は月曜開始

import { weekStart, parseLocal, localDateStr } from '../util.js';
import { workoutKcal, cardioKcal, resolveWeight } from './calories.js';

/** 1記録のトレーニングボリューム(Σ 重量×回数、完了セットのみ) */
export function volume(workout) {
  return (workout.sets || [])
    .filter((s) => s.done !== false)
    .reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
}

/** 推定1RM(Epley式: w × (1 + reps/30))。記録内の最大値 */
export function e1RM(workout) {
  let best = 0;
  for (const s of workout.sets || []) {
    if (s.done === false || !s.weight || !s.reps) continue;
    best = Math.max(best, s.weight * (1 + s.reps / 30));
  }
  return Math.round(best * 10) / 10;
}

/** 記録内の最大重量 */
export function maxWeight(workout) {
  let best = 0;
  for (const s of workout.sets || []) {
    if (s.done === false || !s.weight) continue;
    best = Math.max(best, s.weight);
  }
  return best;
}

/**
 * 週次ボリューム集計(部位別)
 * @returns {Map<string, Object<string, number>>} 週開始日 → {muscleGroup: volume}
 */
export function weeklyVolumeByGroup(workouts, exerciseById) {
  const map = new Map();
  for (const w of workouts) {
    const ex = exerciseById[w.exerciseId];
    if (!ex) continue;
    const wk = weekStart(w.date);
    if (!map.has(wk)) map.set(wk, {});
    const bucket = map.get(wk);
    const g = ex.muscleGroup || 'other';
    bucket[g] = (bucket[g] || 0) + volume(w);
  }
  return map;
}

/**
 * 週次消費カロリー集計(筋トレ/有酸素別)
 * @returns {Map<string, {strength: number, cardio: number}>}
 */
export function weeklyKcal(workouts, cardioRecords, exerciseById, bodyRecords, profile) {
  const map = new Map();
  const bucket = (wk) => {
    if (!map.has(wk)) map.set(wk, { strength: 0, cardio: 0 });
    return map.get(wk);
  };
  for (const w of workouts) {
    const ex = exerciseById[w.exerciseId];
    const weight = resolveWeight(w.date, bodyRecords, profile);
    if (!ex || !weight) continue;
    bucket(weekStart(w.date)).strength += workoutKcal(w, ex, weight).kcal;
  }
  for (const cr of cardioRecords) {
    const ex = exerciseById[cr.exerciseId];
    const weight = resolveWeight(cr.date, bodyRecords, profile);
    if (!ex || !weight) continue;
    bucket(weekStart(cr.date)).cardio += cardioKcal(cr, ex, weight);
  }
  return map;
}

/**
 * 体重の7日移動平均(不定期記録対応: 各記録日について過去7日間の平均)
 * @param {{date: string, weightKg: number}[]} bodyRecords 昇順ソート済みでなくてよい
 * @returns {{date: string, avg: number}[]}
 */
export function movingAvg7(bodyRecords, field = 'weightKg') {
  const recs = bodyRecords
    .filter((b) => b[field] != null && b[field] > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  return recs.map((r, i) => {
    const from = new Date(parseLocal(r.date));
    from.setDate(from.getDate() - 6);
    const fromStr = localDateStr(from);
    const window = recs.filter((x, j) => j <= i && x.date >= fromStr);
    const avg = window.reduce((s, x) => s + x[field], 0) / window.length;
    return { date: r.date, avg: Math.round(avg * 100) / 100 };
  });
}

/** 種目ごとの自己ベスト(最大重量)更新日を求める */
export function personalBests(workoutsOfExercise) {
  const sorted = [...workoutsOfExercise].sort((a, b) => a.date.localeCompare(b.date));
  const prDates = new Set();
  let best = 0;
  for (const w of sorted) {
    const mw = maxWeight(w);
    if (mw > best) {
      best = mw;
      prDates.add(w.date);
    }
  }
  return { best, prDates };
}
