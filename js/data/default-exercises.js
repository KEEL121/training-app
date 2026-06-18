// @ts-check
// default-exercises.js — 種目マスタ初期データ
// 重要: IDは固定slug。UUIDにするとスマホ/PC間でIDが食い違い、
//       エクスポート/インポートのマージが破綻するため必ず固定IDを使う。
// METs値は国立健康・栄養研究所「身体活動のメッツ(METs)表」準拠の代表値:
//   筋トレ一般(8-15回挙上) 5.0 / 高強度(ビッグ3系) 6.0 / 自重(中強度) 3.8

export const MUSCLE_GROUPS = [
  { key: 'chest', label: '胸' },
  { key: 'back', label: '背中' },
  { key: 'legs', label: '脚' },
  { key: 'shoulders', label: '肩' },
  { key: 'arms', label: '腕' },
  { key: 'core', label: '体幹' },
];

export const MUSCLE_LABEL = Object.fromEntries(MUSCLE_GROUPS.map((g) => [g.key, g.label]));

/** 部位ローテーションの同率時の優先順 */
export const GROUP_PRIORITY = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core'];

const s = (id, name, muscleGroup, opts = {}) => ({
  id, name, type: 'strength', muscleGroup,
  mets: opts.mets ?? 5.0,
  increment: opts.increment ?? 2.5,
  isCompound: opts.isCompound ?? false,
  hasDistance: false,
  sortOrder: opts.sortOrder ?? 100,
});

const c = (id, name, mets, hasDistance, sortOrder) => ({
  id, name, type: 'cardio', muscleGroup: null,
  mets, increment: 0, isCompound: false, hasDistance, sortOrder,
});

export const DEFAULT_EXERCISES = [
  // ---- 胸 ----
  s('ex-bench-press', 'ベンチプレス', 'chest', { isCompound: true, mets: 6.0, sortOrder: 10 }),
  s('ex-incline-bench', 'インクラインベンチプレス', 'chest', { isCompound: true, sortOrder: 20 }),
  s('ex-dumbbell-press', 'ダンベルプレス', 'chest', { increment: 1.0, sortOrder: 30 }),
  s('ex-chest-press', 'チェストプレス(マシン)', 'chest', { sortOrder: 40 }),
  s('ex-pec-fly', 'ペックフライ', 'chest', { sortOrder: 50 }),
  s('ex-pushup', '腕立て伏せ', 'chest', { mets: 3.8, increment: 1.0, sortOrder: 60 }),
  // ---- 背中 ----
  s('ex-deadlift', 'デッドリフト', 'back', { isCompound: true, mets: 6.0, sortOrder: 10 }),
  s('ex-bent-over-row', 'ベントオーバーロー', 'back', { isCompound: true, sortOrder: 20 }),
  s('ex-lat-pulldown', 'ラットプルダウン', 'back', { sortOrder: 30 }),
  s('ex-seated-row', 'シーテッドロー', 'back', { sortOrder: 40 }),
  s('ex-pullup', '懸垂', 'back', { mets: 3.8, increment: 1.0, isCompound: true, sortOrder: 50 }),
  // ---- 脚 ----
  s('ex-squat', 'スクワット', 'legs', { isCompound: true, mets: 6.0, sortOrder: 10 }),
  s('ex-leg-press', 'レッグプレス', 'legs', { isCompound: true, increment: 5.0, sortOrder: 20 }),
  s('ex-lunge', 'ランジ', 'legs', { increment: 1.0, sortOrder: 30 }),
  s('ex-leg-extension', 'レッグエクステンション', 'legs', { sortOrder: 40 }),
  s('ex-leg-curl', 'レッグカール', 'legs', { sortOrder: 50 }),
  s('ex-calf-raise', 'カーフレイズ', 'legs', { sortOrder: 60 }),
  // ---- 肩 ----
  s('ex-shoulder-press', 'ショルダープレス', 'shoulders', { isCompound: true, sortOrder: 10 }),
  s('ex-side-raise', 'サイドレイズ', 'shoulders', { increment: 1.0, sortOrder: 20 }),
  s('ex-rear-raise', 'リアレイズ', 'shoulders', { increment: 1.0, sortOrder: 30 }),
  s('ex-upright-row', 'アップライトロー', 'shoulders', { sortOrder: 40 }),
  // ---- 腕 ----
  s('ex-barbell-curl', 'バーベルカール', 'arms', { sortOrder: 10 }),
  s('ex-dumbbell-curl', 'ダンベルカール', 'arms', { increment: 1.0, sortOrder: 20 }),
  s('ex-hammer-curl', 'ハンマーカール', 'arms', { increment: 1.0, sortOrder: 30 }),
  s('ex-triceps-extension', 'トライセプスエクステンション', 'arms', { increment: 1.0, sortOrder: 40 }),
  s('ex-pressdown', 'ケーブルプレスダウン', 'arms', { sortOrder: 50 }),
  // ---- 体幹 ----
  s('ex-crunch', 'クランチ(腹筋)', 'core', { mets: 3.8, increment: 1.0, sortOrder: 10 }),
  s('ex-leg-raise', 'レッグレイズ', 'core', { mets: 3.8, increment: 1.0, sortOrder: 20 }),
  s('ex-ab-roller', 'アブローラー', 'core', { increment: 1.0, sortOrder: 30 }),
  s('ex-back-extension', 'バックエクステンション', 'core', { mets: 3.8, increment: 1.0, sortOrder: 40 }),
  // ---- 有酸素 ----
  c('ex-walking', 'ウォーキング(4km/h)', 3.5, true, 10),
  c('ex-brisk-walking', '速歩(6.4km/h)', 5.0, true, 20),
  c('ex-jogging', 'ジョギング', 7.0, true, 30),
  c('ex-running', 'ランニング(8km/h)', 8.3, true, 40),
  c('ex-cycling', 'サイクリング/エアロバイク', 6.8, true, 50),
  c('ex-swimming', '水泳(クロール ゆっくり)', 8.3, true, 60),
  c('ex-rowing', 'ローイングマシン', 7.0, true, 70),
  c('ex-stair-climbing', '階段昇降/ステアクライマー', 9.0, false, 80),
  c('ex-jump-rope', '縄跳び', 11.0, false, 90),
  c('ex-elliptical', 'エリプティカル', 5.0, false, 100),
];
