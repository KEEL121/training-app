// @ts-check
// circuit.js — サーキットトレーニング(時間制インターバルタイマー)
// 専用画面 #/circuit。既存の記録フロー(workout.js renderSession)には手を入れない。
//
// 1サイクル: マシン → レスト → 階段昇降 → レスト。これをマシン台数ぶん(既定60/30/60/30秒×10台=30分)。
// - 秒数は settings.circuitTiming(設定画面で変更可)。1サイクル4セグメントの構成自体は固定
// - 重量は準備画面で各マシンに設定(前回値プリフィル)。タイマー中は変更しない
// - endTime方式のカウントダウン + 遷移ごとに beep+vibrate + Screen Wake Lock
// - 進行状態は settings.activeCircuitTimer に保持(当日のみ再開可)。開始時の秒数を同梱するため、
//   実行中に設定を変えても走行中のセッションは影響を受けない
// - 完了/終了時: 各マシン→workouts、階段昇降→cardio を生成(カロリーは既存ロジックで自動算出)

import { el, clear, uuid, todayStr, fmtNum, vibrate, formatDateJa } from '../util.js';
import { getAll, getAllByIndex, put, getSetting, putSetting } from '../db.js';
import {
  DEFAULT_CIRCUIT, buildSegments, totalSeconds, formatTotal, normalizeOrder, normalizeTiming,
} from '../data/circuits.js';
import { cardioKcal, resolveWeight } from '../logic/calories.js';
import { maxWeight } from '../logic/stats.js';
import { beep } from '../ui/rest-timer.js';
import { openModal } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { createStepper } from '../ui/stepper.js';
import { navigate, onLeave } from '../router.js';

export async function render(container) {
  const cutoff = (await getSetting('dateCutoff', { hour: 3 })).hour;
  const today = todayStr(cutoff);

  // 進行中タイマーが当日のものなら再開、それ以外は破棄
  let state = await getSetting('activeCircuitTimer');
  if (state && state.date !== today) {
    state = null;
    await putSetting('activeCircuitTimer', null);
  }

  if (state) {
    // 走行中セッションは開始時の秒数で継続(未設定の旧stateは既定値)
    await renderTimer(container, state, today, normalizeTiming(state.timing || DEFAULT_CIRCUIT.timing));
  } else {
    await renderPrep(container, today, normalizeTiming(await getSetting('circuitTiming')));
  }
}

/* ============ 準備画面 ============ */

async function renderPrep(container, today, timing) {
  const exercises = await getAll('exercises');
  const exById = Object.fromEntries(exercises.map((e) => [e.id, e]));
  const validIds = new Set(exercises.map((e) => e.id));

  let order = normalizeOrder(await getSetting('circuitOrder'), validIds);
  await putSetting('circuitOrder', order); // 正規化結果を保存

  // 各マシンの前回重量をプリフィル
  const lastWeights = {};
  for (const id of order) {
    const recs = await getAllByIndex('workouts', 'exerciseId', id);
    const latest = recs.filter((w) => (w.sets || []).length).sort((a, b) => b.date.localeCompare(a.date))[0];
    lastWeights[id] = latest ? maxWeight(latest) || null : null;
  }

  container.append(
    el('div', { class: 'view-header' },
      el('button', { class: 'back-btn', 'aria-label': '戻る', onClick: () => navigate('/') }, icon('chevronLeft')),
      el('div', { class: 'grow' },
        el('h1', { text: `サーキット(${formatTotal(order, timing)})` }),
        el('div', { class: 'caption', text: `${order.length}台 ・ ${describeTiming(timing)}` }),
      ),
      el('button', {
        class: 'btn', text: '秒数を変更',
        onClick: () => navigate('/settings'),
      }),
    ),
  );

  // 初回のみ安全注意
  if (!(await getSetting('circuitSafetyShown'))) {
    container.append(el('div', { class: 'banner banner-warn' },
      el('div', {},
        el('div', { text: '⚠ サーキットは休憩短め・全身を連続で動かします' }),
        el('div', { class: 'caption mt-2', text: '最初は軽い重量でフォーム重視。強い動悸・めまいを感じたら中止してください。' }),
      ),
    ));
    await putSetting('circuitSafetyShown', true);
  }

  const listWrap = el('div', {});
  container.append(listWrap);

  // 重量ステッパーの参照を保持(開始時に読む)
  const steppers = {};

  function renderList() {
    clear(listWrap);
    order.forEach((id, i) => {
      const ex = exById[id];
      if (!ex) return;
      const stepper = createStepper({
        value: lastWeights[id], step: ex.increment || 2.5, unit: 'kg', decimal: true, min: 0, max: 500,
      });
      steppers[id] = stepper;
      listWrap.append(el('div', { class: 'card mb-2' },
        el('div', { class: 'row-between mb-2' },
          el('div', { class: 'row' },
            el('span', { class: 'pill', text: String(i + 1) }),
            el('span', { class: 'li-title', text: ex.name }),
          ),
          el('div', { class: 'row' },
            el('button', {
              class: 'btn', 'aria-label': '上へ', disabled: i === 0 || undefined,
              onClick: () => moveItem(i, -1),
            }, '▲'),
            el('button', {
              class: 'btn', 'aria-label': '下へ', disabled: i === order.length - 1 || undefined,
              onClick: () => moveItem(i, 1),
            }, '▼'),
          ),
        ),
        stepper.root,
      ));
    });
  }

  async function moveItem(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    // 入力中の重量を保持してから並べ替え
    const cur = {};
    for (const id of order) cur[id] = steppers[id] ? steppers[id].get() : lastWeights[id];
    Object.assign(lastWeights, cur);
    [order[i], order[j]] = [order[j], order[i]];
    await putSetting('circuitOrder', order.slice());
    renderList();
  }

  renderList();

  container.append(el('div', { class: 'cta-bar' },
    el('button', { class: 'btn btn-primary btn-cta', text: `開始(${formatTotal(order, timing)})`, onClick: start }),
  ));

  async function start() {
    const weights = {};
    for (const id of order) weights[id] = steppers[id] ? steppers[id].get() : null;
    const segs = buildSegments(order, timing, DEFAULT_CIRCUIT.aerobicId);
    const newState = {
      order: order.slice(),
      timing: { ...timing }, // 開始時の秒数を固定(途中で設定変更されてもズレない)
      segIndex: 0,
      segEndAt: Date.now() + segs[0].sec * 1000,
      paused: false,
      remainingMs: segs[0].sec * 1000,
      weights,
      date: today,
    };
    await putSetting('activeCircuitTimer', newState);
    clear(container);
    await renderTimer(container, newState, today, timing);
  }
}

/** 「マシン60秒→レスト30秒→階段昇降60秒→レスト30秒」形式の説明文 */
function describeTiming(t) {
  return `マシン${t.machineSec}秒→レスト${t.restSec}秒→階段昇降${t.aerobicSec}秒→レスト${t.rest2Sec}秒`;
}

/* ============ タイマー画面 ============ */

async function renderTimer(container, state, today, timing) {
  const exercises = await getAll('exercises', { includeDeleted: true });
  const exById = Object.fromEntries(exercises.map((e) => [e.id, e]));
  const order = state.order || normalizeOrder(await getSetting('circuitOrder'), null);
  const segs = buildSegments(order, timing, DEFAULT_CIRCUIT.aerobicId);
  const totalSec = totalSeconds(order, timing);

  let tickId = null;
  let wakeLock = null;

  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* 非対応・省電力時は無視 */ }
  }
  const onVisible = () => { if (document.visibilityState === 'visible' && !state.paused) acquireWakeLock(); };
  document.addEventListener('visibilitychange', onVisible);

  // 離脱時: 走行中なら自動一時停止(復帰時に大量スキップを防ぐ)
  onLeave(async () => {
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(tickId);
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    if (!state.paused && !state._finished) {
      state.paused = true;
      state.remainingMs = Math.max(0, state.segEndAt - Date.now());
      await putSetting('activeCircuitTimer', state);
    }
  });

  /* ---- DOM 構築(1回) ---- */
  const segLabel = el('div', { class: 'section-title', styles: { fontSize: '1rem' } });
  const segMain = el('div', { class: 'hero-num num', styles: { textAlign: 'center', fontSize: 'clamp(48px, 18vw, 96px)' } });
  const segName = el('div', { styles: { textAlign: 'center', fontSize: '1.5rem', fontWeight: '800', minHeight: '2rem' } });
  const nextPreview = el('div', { class: 'caption text-center mt-2' });
  const progressText = el('div', { class: 'caption text-center' });
  const progressBar = el('div', { styles: { display: 'flex', gap: '3px', marginTop: '8px' } });

  const card = el('div', { class: 'card', styles: { textAlign: 'center', paddingTop: '32px', paddingBottom: '32px' } },
    segLabel, segName, segMain, nextPreview);

  container.append(
    el('div', { class: 'view-header' },
      el('button', { class: 'back-btn', 'aria-label': '戻る(中断して再開可)', onClick: () => navigate('/') }, icon('chevronLeft')),
      el('div', { class: 'grow' }, el('h1', { text: 'サーキット' }), progressText),
    ),
    progressBar,
    card,
  );

  // 進捗ドット(マシンごと)
  const dots = order.map(() => el('span', {
    styles: { flex: '1', height: '6px', borderRadius: '3px', background: 'var(--border)' },
  }));
  dots.forEach((d) => progressBar.append(d));

  // 操作ボタン
  const pauseBtn = el('button', { class: 'btn grow', onClick: togglePause });
  const skipBtn = el('button', { class: 'btn grow', text: 'マシンをスキップ', onClick: skipMachine });
  container.append(el('div', { class: 'cta-bar' },
    pauseBtn, skipBtn,
    el('button', { class: 'btn btn-danger', text: '終了', onClick: () => finish(false) }),
  ));

  if (!state.paused) acquireWakeLock();
  tickId = setInterval(tick, 200);
  renderSeg();
  tick();

  function curSeg() { return segs[state.segIndex]; }
  function machineNumber() {
    // 現在(または直近)のマシン番号
    const seg = curSeg();
    if (seg && seg.machineIndex != null) return seg.machineIndex + 1;
    return Math.min(Math.floor(state.segIndex / 4) + 1, order.length);
  }

  function renderSeg() {
    const seg = curSeg();
    if (!seg) return;
    const labelMap = { machine: 'マシン', rest: 'レスト', aerobic: '有酸素' };
    segLabel.textContent = `マシン ${machineNumber()}/${order.length} ・ ${labelMap[seg.kind]}`;
    if (seg.kind === 'machine') {
      const ex = exById[seg.exerciseId];
      const w = state.weights && state.weights[seg.exerciseId];
      segName.textContent = ex ? ex.name : 'マシン';
      segName.style.color = 'var(--accent)';
      nextPreview.textContent = w ? `設定重量 ${w}kg` : '';
    } else if (seg.kind === 'aerobic') {
      segName.textContent = '階段昇降';
      segName.style.color = 'var(--chart-3)';
      nextPreview.textContent = '';
    } else {
      segName.textContent = '休憩';
      segName.style.color = 'var(--text-sub)';
      const nx = segs[state.segIndex + 1];
      nextPreview.textContent = nx
        ? `次 ▸ ${nx.kind === 'aerobic' ? '階段昇降' : (exById[nx.exerciseId]?.name || '')}`
        : 'まもなく完了';
    }
    // 進捗ドット更新
    const doneMachines = Math.floor(state.segIndex / 4);
    dots.forEach((d, i) => {
      d.style.background = i < doneMachines ? 'var(--accent)'
        : (i === doneMachines ? 'var(--accent-dim)' : 'var(--border)');
    });
    pauseBtn.textContent = state.paused ? '▶ 再開' : '⏸ 一時停止';
  }

  function remainingMs() {
    return state.paused ? (state.remainingMs || 0) : Math.max(0, state.segEndAt - Date.now());
  }

  function tick() {
    const rem = remainingMs();
    const sec = Math.ceil(rem / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    segMain.textContent = `${m}:${String(s).padStart(2, '0')}`;

    // 全体経過/残り
    const elapsedBefore = segs.slice(0, state.segIndex).reduce((a, x) => a + x.sec, 0);
    const elapsed = elapsedBefore + (curSeg() ? curSeg().sec - sec : 0);
    const totRemain = Math.max(0, totalSec - elapsed);
    progressText.textContent = `経過 ${mmss(elapsed)} / 残り ${mmss(totRemain)}`;

    if (!state.paused && rem <= 0) advance();
  }

  function mmss(sec) {
    const m = Math.floor(sec / 60);
    return `${m}:${String(Math.max(0, sec % 60)).padStart(2, '0')}`;
  }

  async function advance() {
    state.segIndex++;
    if (state.segIndex >= segs.length) {
      await finish(true);
      return;
    }
    const seg = segs[state.segIndex];
    state.segEndAt = Date.now() + seg.sec * 1000;
    state.remainingMs = seg.sec * 1000;
    await putSetting('activeCircuitTimer', state);
    // 合図: マシン/有酸素開始は高め2音、レストは1音
    beep(seg.kind === 'rest' ? [660] : [880, 1180]);
    vibrate(seg.kind === 'rest' ? 80 : [120, 60, 120]);
    renderSeg();
    tick();
  }

  async function togglePause() {
    if (state.paused) {
      state.paused = false;
      state.segEndAt = Date.now() + (state.remainingMs || 0);
      acquireWakeLock();
    } else {
      state.paused = true;
      state.remainingMs = remainingMs();
      if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    }
    await putSetting('activeCircuitTimer', state);
    renderSeg();
    tick();
  }

  async function skipMachine() {
    // 次のマシンセグメントまで進める(現在マシンの残りサイクルを飛ばす)
    let i = state.segIndex + 1;
    while (i < segs.length && segs[i].kind !== 'machine') i++;
    state.segIndex = Math.min(i, segs.length);
    if (state.segIndex >= segs.length) { await finish(true); return; }
    const seg = segs[state.segIndex];
    state.segEndAt = Date.now() + seg.sec * 1000;
    state.remainingMs = seg.sec * 1000;
    state.paused = false;
    await putSetting('activeCircuitTimer', state);
    beep([880, 1180]);
    renderSeg();
    tick();
  }

  async function finish(completed) {
    state._finished = true;
    clearInterval(tickId);
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    document.removeEventListener('visibilitychange', onVisible);

    // 完了したマシン/有酸素を集計(segmentを通過したか)
    const doneMachineIdx = [];
    order.forEach((id, i) => { if (state.segIndex > i * 4) doneMachineIdx.push(i); });
    let aerobicSegDone = 0;
    order.forEach((_id, i) => { if (state.segIndex > i * 4 + 2) aerobicSegDone++; });

    const now = today;
    // 各マシン → workouts。重量の履歴を残すのが目的で、durationMin は明示的に0にする。
    // カロリーはセッション全体を1件の有酸素記録で計上するため、ここで足すと二重計上になる
    for (const i of doneMachineIdx) {
      const id = order[i];
      const w = state.weights && state.weights[id];
      await put('workouts', {
        id: uuid(), date: now, exerciseId: id,
        sets: [{ weight: w ?? null, reps: null, done: true }],
        durationMin: 0,
        note: 'サーキット', deletedAt: null,
      });
    }

    // セッション全体 → cardio 1件(8.0 METs)。通過したセグメントの秒数を合計する。
    // マシン実働+階段だけを足すとレスト時間が丸ごと落ち、3〜4割の過小評価になる
    const stairMin = Math.round((aerobicSegDone * timing.aerobicSec) / 60);
    const sessionMin = Math.max(1, Math.round(
      segs.slice(0, state.segIndex).reduce((a, x) => a + x.sec, 0) / 60,
    ));
    if (doneMachineIdx.length > 0) {
      await put('cardio', {
        id: uuid(), date: now, exerciseId: DEFAULT_CIRCUIT.sessionId,
        durationMin: sessionMin, distanceKm: null,
        note: `サーキット(マシン${doneMachineIdx.length}台${stairMin > 0 ? `・階段昇降約${stairMin}分` : ''})`,
        deletedAt: null,
      });
    }

    await putSetting('activeCircuitTimer', null);
    await showSummary(doneMachineIdx, sessionMin, stairMin, order, exById, now, completed);
  }
}

/* ============ 完了サマリ ============ */

async function showSummary(doneMachineIdx, sessionMin, stairMin, order, exById, date, completed) {
  const bodies = await getAll('body');
  const profile = await getSetting('profile');
  const weightKg = resolveWeight(date, bodies, profile);

  // 記録側と同じ計算(セッション全体を8.0 METsで1件)。種目が削除済みでも既定値で出す
  const sessionEx = exById[DEFAULT_CIRCUIT.sessionId] || { mets: 8.0 };
  const kcal = weightKg ? cardioKcal({ durationMin: sessionMin }, sessionEx, weightKg) : 0;
  const totalMin = sessionMin;
  vibrate([150, 80, 150, 80, 200]);

  const content = el('div', { class: 'text-center' },
    el('div', { styles: { fontSize: '3rem' }, text: completed ? '🎉' : '✅' }),
    el('h2', { text: completed ? 'サーキット完了!' : 'サーキットを終了しました' }),
    el('div', { class: 'hero-num text-accent mt-2', text: `${doneMachineIdx.length}/${order.length} マシン` }),
    el('p', { class: 'caption mt-2', text: `${formatDateJa(date)} ・ 所要 約${totalMin}分${stairMin > 0 ? `(階段昇降 約${stairMin}分)` : ''}${kcal ? ` ・ 約${fmtNum(kcal)}kcal` : ''}` }),
    !weightKg ? el('p', { class: 'caption text-warn mt-2', text: '体重を記録するとカロリーが出ます' }) : null,
    el('button', { class: 'btn btn-primary btn-cta mt-4', text: 'ホームへ', onClick: () => { close(); navigate('/'); } }),
    el('button', { class: 'btn btn-cta mt-2', text: '履歴を見る', onClick: () => { close(); navigate('/history'); } }),
  );
  const close = openModal(content, { center: true, onClose: () => navigate('/') });
}
