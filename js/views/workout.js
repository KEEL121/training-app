// @ts-check
// workout.js — 筋トレ記録(種目選択 → セット入力)
// 設計の要点:
// - セット完了チェックの瞬間にIndexedDBへ即時保存(ジムでの中断・タブ破棄対策)
// - activeWorkout(settings)で進行中セッションを保持し、再開可能にする
// - レストタイマー自動開始 + Screen Wake Lock
// - 「+セット追加」は直前セットの値を複製

import { el, clear, uuid, todayStr, formatDateJa, fmtNum, vibrate } from '../util.js';
import { get, getAll, getAllByIndex, put, getSetting, putSetting } from '../db.js';
import { MUSCLE_GROUPS, MUSCLE_LABEL } from '../data/default-exercises.js';
import { volume } from '../logic/stats.js';
import { workoutKcal, resolveWeight } from '../logic/calories.js';
import { toast, openActionMenu } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { createStepper } from '../ui/stepper.js';
import { startRestTimer, resumeRestTimerIfActive, detachRestTimerBar, stopRestTimer } from '../ui/rest-timer.js';
import { navigate, onLeave } from '../router.js';

/* ============ 種目選択画面 (#/workout) ============ */

export async function renderPicker(container) {
  container.append(
    el('div', { class: 'view-header' },
      el('button', { class: 'back-btn', 'aria-label': '戻る', onClick: () => navigate('/') }, icon('chevronLeft')),
      el('h1', { text: '筋トレ — 種目を選択' }),
    ),
  );

  const cutoff = (await getSetting('dateCutoff', { hour: 3 })).hour;
  const today = todayStr(cutoff);

  // サーキット再開バナー(優先)/ 進行中サーキットがあれば単一種目バナーは出さない
  const circuitState = await getSetting('activeCircuitTimer');
  const circuitActive = circuitState && circuitState.date === today;
  if (circuitActive) {
    const doneM = Math.floor((circuitState.segIndex || 0) / 4);
    const totalM = (circuitState.order || []).length || 10;
    container.append(el('div', { class: 'banner' },
      el('span', { class: 'grow', text: `🔄 サーキット ${doneM}/${totalM} 実施中` }),
      el('button', { class: 'btn btn-primary', text: '再開', onClick: () => navigate('/circuit') }),
    ));
  } else {
    // 進行中セッションの再開バナー
    const active = await getSetting('activeWorkout');
    if (active && active.date === today) {
      const ex = await get('exercises', active.exerciseId);
      if (ex) {
        container.append(el('div', { class: 'banner' },
          el('span', { class: 'grow', text: `「${ex.name}」を記録中です` }),
          el('button', { class: 'btn btn-primary', text: '再開', onClick: () => navigate(`/workout/${active.exerciseId}`) }),
        ));
      }
    }
  }

  // サーキット開始カード(先頭・実施中でなければ)
  if (!circuitActive) {
    container.append(el('div', {
      class: 'card tappable mb-4', role: 'button', tabindex: '0',
      onClick: () => navigate('/circuit'),
      onKeydown: (e) => { if (e.key === 'Enter') navigate('/circuit'); },
    },
      el('div', { class: 'row' },
        icon('timer'),
        el('div', { class: 'grow' },
          el('div', { class: 'li-title', text: '🔄 サーキットトレーニング(30分)' }),
          el('div', { class: 'li-sub', text: 'マシン10台+階段昇降を時間制で一巡' }),
        ),
        icon('chevronRight', 18),
      ),
    ));
  }

  const exercises = (await getAll('exercises')).filter((e) => e.type === 'strength');
  const workouts = await getAll('workouts');

  // 種目ごとの最終記録日(最近使った順タブ用)
  const lastDateByEx = {};
  for (const w of workouts) {
    if (!lastDateByEx[w.exerciseId] || w.date > lastDateByEx[w.exerciseId]) {
      lastDateByEx[w.exerciseId] = w.date;
    }
  }

  const tabRow = el('div', { class: 'chip-row' });
  const listWrap = el('div', { class: 'mt-2' });
  container.append(tabRow, listWrap);

  const tabs = [{ key: 'recent', label: '最近' }, ...MUSCLE_GROUPS.map((g) => ({ key: g.key, label: g.label }))];
  let activeTab = Object.keys(lastDateByEx).length > 0 ? 'recent' : 'chest';

  for (const t of tabs) {
    tabRow.append(el('button', {
      class: 'chip' + (t.key === activeTab ? ' active' : ''),
      text: t.label,
      dataset: { tab: t.key },
      onClick: () => {
        activeTab = t.key;
        tabRow.querySelectorAll('.chip').forEach((c) =>
          c.classList.toggle('active', c.dataset.tab === t.key));
        renderList();
      },
    }));
  }

  function lastSummary(exId) {
    const recs = workouts.filter((w) => w.exerciseId === exId).sort((a, b) => b.date.localeCompare(a.date));
    if (recs.length === 0) return '記録なし';
    const last = recs[0];
    const sets = (last.sets || []).filter((s) => s.done !== false);
    if (sets.length === 0) return '記録なし';
    const w = Math.max(...sets.map((s) => s.weight || 0));
    const reps = sets.map((s) => s.reps).join('/');
    return `前回 ${formatDateJa(last.date)}: ${w}kg × ${reps}`;
  }

  function renderList() {
    clear(listWrap);
    let list;
    if (activeTab === 'recent') {
      list = exercises
        .filter((e) => lastDateByEx[e.id])
        .sort((a, b) => lastDateByEx[b.id].localeCompare(lastDateByEx[a.id]));
      if (list.length === 0) {
        listWrap.append(el('div', { class: 'empty-state' },
          el('div', { class: 'empty-emoji', text: '💪' }),
          el('p', { text: 'まだ記録がありません。部位タブから種目を選んで始めましょう。' }),
        ));
        return;
      }
    } else {
      list = exercises
        .filter((e) => e.muscleGroup === activeTab)
        .sort((a, b) => (b.isCompound ? 1 : 0) - (a.isCompound ? 1 : 0) || a.sortOrder - b.sortOrder);
    }
    for (const ex of list) {
      listWrap.append(el('div', {
        class: 'list-item',
        role: 'button',
        tabindex: '0',
        onClick: () => navigate(`/workout/${ex.id}`),
        onKeydown: (e) => { if (e.key === 'Enter') navigate(`/workout/${ex.id}`); },
      },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title', text: ex.name }),
          el('div', { class: 'li-sub', text: lastSummary(ex.id) }),
        ),
        ex.isCompound ? el('span', { class: 'pill accent', text: '複合' }) : null,
        icon('chevronRight', 18),
      ));
    }
  }
  renderList();
}

/* ============ セット入力画面 (#/workout/:exerciseId, #/workout-rec/:recordId) ============ */

export async function renderSession(container, params) {
  const cutoff = (await getSetting('dateCutoff', { hour: 3 })).hour;
  const today = todayStr(cutoff);

  let record, exercise;
  if (params.recordId) {
    // 履歴からの編集
    record = await get('workouts', params.recordId);
    if (!record) { toast('記録が見つかりません'); navigate('/history'); return; }
    exercise = await get('exercises', record.exerciseId);
  } else {
    exercise = await get('exercises', params.exerciseId);
    if (!exercise) { toast('種目が見つかりません'); navigate('/workout'); return; }
    // 今日の同種目記録があれば続きから
    const todayRecs = (await getAllByIndex('workouts', 'exerciseId_date', IDBKeyRange.only([exercise.id, today])));
    record = todayRecs[0] || null;
  }
  if (!exercise) { toast('種目が見つかりません'); navigate('/history'); return; }

  const isToday = !record || record.date === today;

  // 前回記録(この記録の日付より前で直近)
  const baseDate = record ? record.date : today;
  const pastRecords = (await getAllByIndex('workouts', 'exerciseId', exercise.id))
    .filter((w) => w.date < baseDate && (w.sets || []).some((s) => s.done !== false))
    .sort((a, b) => b.date.localeCompare(a.date));
  const lastRec = pastRecords[0] || null;

  // 新規ドラフト(完了セットが出るまでDBには書かない)
  let saved = !!record;
  if (!record) {
    record = {
      id: uuid(), date: today, exerciseId: exercise.id,
      sets: [], durationMin: null, note: '',
    };
    // 提案からのプリフィル
    let prefill = null;
    try { prefill = JSON.parse(sessionStorage.getItem('prefill') || 'null'); } catch { /* noop */ }
    if (prefill && prefill.exerciseId === exercise.id && Array.isArray(prefill.sets)) {
      record.sets = prefill.sets.map((s) => ({ weight: s.weight ?? null, reps: s.reps ?? 10, done: false }));
      sessionStorage.removeItem('prefill');
    } else if (lastRec) {
      // 前回の1セット目を初期値に
      const first = (lastRec.sets || [])[0];
      record.sets = [{ weight: first?.weight ?? null, reps: first?.reps ?? 10, done: false }];
    } else {
      record.sets = [{ weight: null, reps: 10, done: false }];
    }
  } else {
    record.sets = (record.sets || []).map((s) => ({ done: true, ...s }));
  }

  async function persist() {
    saved = true;
    await put('workouts', record);
  }

  async function markActive() {
    if (!isToday) return;
    await putSetting('activeWorkout', { recordId: record.id, exerciseId: exercise.id, date: record.date });
  }

  async function clearActive() {
    const active = await getSetting('activeWorkout');
    if (active && active.recordId === record.id) await putSetting('activeWorkout', null);
  }

  /* ---- Wake Lock(画面スリープ抑止) ---- */
  let wakeLock = null;
  const restCfg = await getSetting('restTimer', { sec: 90, enabled: true });
  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && restCfg.enabled !== false) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch { /* 非対応・省電力時は無視 */ }
  }
  const onVisible = () => { if (document.visibilityState === 'visible') acquireWakeLock(); };
  document.addEventListener('visibilitychange', onVisible);
  acquireWakeLock();

  onLeave(() => {
    document.removeEventListener('visibilitychange', onVisible);
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    detachRestTimerBar();
  });

  /* ---- ヘッダ ---- */
  container.append(
    el('div', { class: 'view-header' },
      el('button', { class: 'back-btn', 'aria-label': '戻る', onClick: () => navigate(params.recordId ? '/history' : '/workout') }, icon('chevronLeft')),
      el('div', { class: 'grow' },
        el('h1', { text: exercise.name }),
        el('div', { class: 'caption', text: isToday ? formatDateJa(record.date) + '(今日)' : formatDateJa(record.date, true) + ' の記録を編集中' }),
      ),
    ),
  );

  // 前回記録表示+コピー
  if (lastRec) {
    const sets = (lastRec.sets || []).filter((s) => s.done !== false);
    const w = Math.max(...sets.map((s) => s.weight || 0));
    container.append(el('div', { class: 'banner' },
      el('span', { class: 'grow', text: `前回(${formatDateJa(lastRec.date)}): ${w}kg × ${sets.map((s) => s.reps).join('/')}` }),
      el('button', { class: 'btn', text: '⟳ 前回をコピー', onClick: async () => {
        record.sets = sets.map((s) => ({ weight: s.weight, reps: s.reps, done: false }));
        if (saved) await persist();
        renderSets();
      } }),
    ));
  }

  const setsWrap = el('div', { class: 'mt-2' });
  container.append(setsWrap);

  // メモ欄
  const noteInput = el('textarea', { placeholder: 'メモ(任意)', maxlength: '500' });
  noteInput.value = record.note || '';
  noteInput.addEventListener('change', async () => {
    record.note = noteInput.value.slice(0, 500);
    if (saved || record.note) await persist();
  });
  container.append(el('div', { class: 'field mt-4' },
    el('div', { class: 'field-label', text: 'メモ' }), noteInput));

  // 下部CTA
  container.append(el('div', { class: 'cta-bar' },
    el('button', { class: 'btn btn-primary btn-cta', text: 'この種目を終える', onClick: finishExercise }),
  ));

  resumeRestTimerIfActive();

  function renderSets() {
    clear(setsWrap);
    record.sets.forEach((set, i) => setsWrap.append(setRow(set, i)));
    setsWrap.append(el('button', {
      class: 'btn btn-cta mt-2',
      onClick: async () => {
        const last = record.sets[record.sets.length - 1];
        record.sets.push({ weight: last?.weight ?? null, reps: last?.reps ?? 10, done: false });
        if (saved) await persist();
        renderSets();
      },
    }, icon('plus', 18), 'セット追加(前セットの値を複製)'));
  }

  function setRow(set, index) {
    const weightStepper = createStepper({
      value: set.weight,
      step: exercise.increment || 2.5,
      unit: 'kg',
      decimal: true,
      max: 500,
      onChange: async (v) => { set.weight = v; if (saved) await persist(); },
    });
    const repsStepper = createStepper({
      value: set.reps,
      step: 1,
      unit: '回',
      max: 100,
      onChange: async (v) => { set.reps = v; if (saved) await persist(); },
    });

    const doneBtn = el('button', {
      class: 'btn btn-cta mt-2 ' + (set.done ? 'btn-primary' : ''),
      onClick: async () => {
        set.done = !set.done;
        if (set.done) {
          // セット完了 = 即時保存がこのアプリの生命線
          set.weight = weightStepper.get();
          set.reps = repsStepper.get();
          await persist();
          await markActive();
          vibrate(10);
          if (restCfg.enabled !== false) startRestTimer(restCfg.sec || 90);
        } else {
          await persist();
        }
        renderSets();
      },
    }, set.done ? '✓ 完了(保存済み)' : '✓ このセットを完了');

    return el('div', { class: 'set-row' + (set.done ? ' done' : '') },
      el('div', { class: 'set-row-head' },
        el('span', { class: 'set-row-title', text: `SET ${index + 1}` }),
        el('button', { class: 'btn btn-ghost', 'aria-label': 'セットのメニュー', onClick: () => {
          openActionMenu([
            { label: 'このセットを削除', iconName: 'trash', danger: true, onSelect: async () => {
              record.sets.splice(index, 1);
              if (saved) await persist();
              renderSets();
            } },
          ]);
        } }, icon('more', 18)),
      ),
      el('div', { class: 'field' }, el('div', { class: 'field-label', text: '重量' }), weightStepper.root),
      el('div', { class: 'field' }, el('div', { class: 'field-label', text: '回数' }), repsStepper.root),
      doneBtn,
    );
  }

  async function finishExercise() {
    const doneSets = record.sets.filter((s) => s.done);
    if (doneSets.length === 0 && !saved) {
      // 何も確定していなければ保存せず戻る
      stopRestTimer();
      navigate('/workout');
      return;
    }
    record.sets = record.sets.filter((s) => s.done || (s.weight != null && s.reps != null));
    await persist();
    await clearActive();
    stopRestTimer();

    // 成果トースト(ボリューム+カロリー)
    const vol = volume(record);
    const bodies = await getAll('body');
    const profile = await getSetting('profile');
    const weightKg = resolveWeight(record.date, bodies, profile);
    let msg = `💪 記録しました(${fmtNum(vol)}kg)`;
    if (weightKg) {
      const k = workoutKcal(record, exercise, weightKg);
      msg = `💪 記録しました ${fmtNum(vol)}kg / 約${k.kcal}kcal`;
    }
    toast(msg);
    navigate(params.recordId ? '/history' : '/workout');
  }

  renderSets();
}
