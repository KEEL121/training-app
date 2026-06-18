// @ts-check
// suggestion.js — ルールベースのメニュー提案エンジン(純ロジック・UI非依存)
//
//   Step1 部位決定: 最終トレ日が最も古い部位(回復48h以内は除外、記録ゼロ最優先)
//   Step2 種目選定: 複合種目優先で3〜4種目
//   Step3 漸進性過負荷:
//     記録なし        --> 軽めで10回×3(重量空欄)
//     全セット目標達成 --> 重量+increment、目標回数リセット
//     目標未達あり    --> 同重量で最弱セット+1回
//     3回連続停滞     --> 10%デロード
//   Step4 日本語の理由文を付与

import { GROUP_PRIORITY, MUSCLE_LABEL } from '../data/default-exercises.js';
import { daysBetween } from '../util.js';

/**
 * @typedef {Object} SuggestionItem
 * @property {string} exerciseId
 * @property {string} exerciseName
 * @property {{weight: number|null, reps: number}[]} sets
 * @property {string} reason
 * @property {boolean} [deload]
 */

/**
 * メニュー提案を生成
 * @param {any[]} workouts 全筋トレ記録(deletedAt除外済み)
 * @param {any[]} exercises 種目マスタ(deletedAt除外済み)
 * @param {{targetRepsHigh: number, targetRepsLow: number, recoveryHours: number}} params
 * @param {string} today YYYY-MM-DD
 * @returns {{targetGroup: string|null, targetGroupLabel: string, items: SuggestionItem[]}}
 */
export function suggest(workouts, exercises, params, today) {
  const strength = exercises.filter((e) => e.type === 'strength');
  const exById = Object.fromEntries(strength.map((e) => [e.id, e]));

  // Step1: 部位ごとの最終トレ日
  const lastByGroup = {};
  for (const w of workouts) {
    const ex = exById[w.exerciseId];
    if (!ex || !ex.muscleGroup) continue;
    const g = ex.muscleGroup;
    if (!lastByGroup[g] || w.date > lastByGroup[g]) lastByGroup[g] = w.date;
  }

  const recoveryDays = Math.ceil((params.recoveryHours || 48) / 24);
  const groups = GROUP_PRIORITY.filter((g) => strength.some((e) => e.muscleGroup === g));

  // 回復期間内(recoveryDays未満)の部位は除外
  const eligible = groups.filter((g) => {
    const last = lastByGroup[g];
    return !last || daysBetween(today, last) >= recoveryDays;
  });
  const pool = eligible.length > 0 ? eligible : groups;

  // 記録ゼロ最優先 → 最終日が古い順 → GROUP_PRIORITY順
  pool.sort((a, b) => {
    const la = lastByGroup[a], lb = lastByGroup[b];
    if (!la && !lb) return GROUP_PRIORITY.indexOf(a) - GROUP_PRIORITY.indexOf(b);
    if (!la) return -1;
    if (!lb) return 1;
    if (la !== lb) return la.localeCompare(lb);
    return GROUP_PRIORITY.indexOf(a) - GROUP_PRIORITY.indexOf(b);
  });
  const targetGroup = pool[0] || null;
  if (!targetGroup) return { targetGroup: null, targetGroupLabel: '', items: [] };

  // Step2: 種目選定(複合優先 → sortOrder順、3〜4種目)
  const candidates = strength
    .filter((e) => e.muscleGroup === targetGroup)
    .sort((a, b) => (b.isCompound ? 1 : 0) - (a.isCompound ? 1 : 0) || a.sortOrder - b.sortOrder)
    .slice(0, 4);

  // Step3: 各種目のセット内容
  const items = candidates.map((ex) => suggestForExercise(ex, workouts, params));

  return { targetGroup, targetGroupLabel: MUSCLE_LABEL[targetGroup] || targetGroup, items };
}

/**
 * 1種目の提案(漸進性過負荷+デロード判定)
 * @returns {SuggestionItem}
 */
export function suggestForExercise(exercise, allWorkouts, params) {
  const high = params.targetRepsHigh || 10;
  const low = params.targetRepsLow || 8;
  const inc = exercise.increment || 2.5;

  // この種目の履歴(新しい順)
  const history = allWorkouts
    .filter((w) => w.exerciseId === exercise.id && (w.sets || []).some((s) => s.done !== false))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (history.length === 0) {
    return {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      sets: [{ weight: null, reps: high }, { weight: null, reps: high }, { weight: null, reps: high }],
      reason: '初めての種目。軽めの重量でフォーム確認から(10回×3セット)',
    };
  }

  const last = history[0];
  const lastSets = (last.sets || []).filter((s) => s.done !== false);
  const setCount = Math.min(Math.max(lastSets.length, 2), 5);
  const lastWeight = Math.max(...lastSets.map((s) => s.weight || 0));
  const repsStr = lastSets.map((s) => s.reps).join('/');

  const allReached = lastSets.every((s) => (s.reps || 0) >= high);

  if (allReached) {
    const newWeight = roundToInc(lastWeight + inc, inc);
    return {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      sets: Array.from({ length: setCount }, () => ({ weight: newWeight, reps: low })),
      reason: `前回 ${lastWeight}kg×${repsStr} 全セット達成 → 重量アップ(${newWeight}kg×${low}回目標)`,
    };
  }

  // デロード判定: 同一重量で直近3回連続して全セット目標未達
  const sameWeightHistory = history.filter((w) => {
    const sets = (w.sets || []).filter((s) => s.done !== false);
    return sets.length > 0 && Math.max(...sets.map((s) => s.weight || 0)) === lastWeight;
  });
  const recentThree = sameWeightHistory.slice(0, 3);
  const stalled =
    recentThree.length >= 3 &&
    recentThree.every((w) =>
      (w.sets || []).filter((s) => s.done !== false).some((s) => (s.reps || 0) < high),
    );

  if (stalled) {
    const deloadWeight = roundToInc(lastWeight * 0.9, inc);
    return {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      sets: Array.from({ length: setCount }, () => ({ weight: deloadWeight, reps: high })),
      reason: `${lastWeight}kgで3回連続停滞 → 一度重量を下げてフォーム重視(${deloadWeight}kg)`,
      deload: true,
    };
  }

  // 同重量で最弱セット+1回を目標
  const weakest = Math.min(...lastSets.map((s) => s.reps || 0));
  const targetReps = Math.min(weakest + 1, high);
  return {
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    sets: lastSets.slice(0, setCount).map((s) => ({
      weight: s.weight ?? lastWeight,
      reps: Math.min((s.reps || targetReps) < high ? (s.reps || 0) + 1 : high, high),
    })),
    reason: `前回 ${lastWeight}kg×${repsStr} → 同重量で回数を伸ばす(目標${targetReps}回〜)`,
  };
}

/** increment刻みに丸める(0.5kg未満の端数を防ぐ) */
function roundToInc(weight, inc) {
  if (!inc) return Math.round(weight * 10) / 10;
  return Math.round(weight / inc) * inc;
}
