// @ts-check
// charts.js — グラフ4種(Chart.js v4 + date-fnsアダプタ、vendor同梱・遅延ロード)
// 1. 体重・体脂肪率推移(7日移動平均+実測ドット、2軸)
// 2. 種目別 最大重量+推定1RM(自己ベストに★)
// 3. 週次ボリューム(部位別積み上げ)
// 4. 週次消費カロリー(筋トレ/有酸素積み上げ)

import { el, clear, localDateStr, parseLocal, fmtNum } from '../util.js';
import { getAll, getSetting } from '../db.js';
import { movingAvg7, weeklyVolumeByGroup, weeklyKcal, maxWeight, e1RM, personalBests } from '../logic/stats.js';
import { MUSCLE_GROUPS, MUSCLE_LABEL } from '../data/default-exercises.js';
import { onLeave, navigate } from '../router.js';

const PERIODS = [
  { key: '1M', label: '1ヶ月', days: 31 },
  { key: '3M', label: '3ヶ月', days: 93 },
  { key: '1Y', label: '1年', days: 366 },
  { key: 'ALL', label: '全期間', days: null },
];

let chartInstances = [];

/** vendorのChart.jsを遅延ロード(初回のみ) */
function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  const load = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('script load failed: ' + src));
    document.head.append(s);
  });
  return load('./vendor/chart.umd.min.js')
    .then(() => load('./vendor/chartjs-adapter-date-fns.bundle.min.js'));
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export async function render(container) {
  container.append(el('div', { class: 'view-header' }, el('h1', { text: 'グラフ' })));

  const [workouts, cardioRecs, bodies, exercises, profile] = await Promise.all([
    getAll('workouts'), getAll('cardio'), getAll('body'), getAll('exercises'), getSetting('profile'),
  ]);
  const exById = Object.fromEntries(exercises.map((e) => [e.id, e]));

  if (workouts.length + cardioRecs.length + bodies.length === 0) {
    container.append(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-emoji', text: '📈' }),
      el('p', { text: '記録がたまるとここにグラフが表示されます。' }),
      el('button', { class: 'btn btn-primary', text: '今日の記録をつける', onClick: () => navigate('/workout') }),
    ));
    return;
  }

  try {
    await loadChartJs();
  } catch {
    container.append(el('p', { class: 'text-warn', text: 'グラフライブラリの読み込みに失敗しました。通信環境を確認して再読み込みしてください。' }));
    return;
  }

  onLeave(() => {
    chartInstances.forEach((c) => c.destroy());
    chartInstances = [];
  });

  /* ---- 期間セグメント ---- */
  let period = '3M';
  const segment = el('div', { class: 'segment mb-4', role: 'tablist' });
  for (const p of PERIODS) {
    segment.append(el('button', {
      text: p.label,
      class: p.key === period ? 'active' : '',
      dataset: { period: p.key },
      onClick: () => {
        period = p.key;
        segment.querySelectorAll('button').forEach((b) =>
          b.classList.toggle('active', b.dataset.period === period));
        drawAll();
      },
    }));
  }
  container.append(segment);

  const chartsWrap = el('div', {});
  container.append(chartsWrap);

  function cutoffDate() {
    const p = PERIODS.find((x) => x.key === period);
    if (!p.days) return '0000-00-00';
    const d = new Date(Date.now() - p.days * 86400000);
    return localDateStr(d);
  }

  /* ---- 種目セレクタ(グラフ2用): 最近記録した種目 ---- */
  const exercisedIds = [...new Set(
    [...workouts].sort((a, b) => b.date.localeCompare(a.date)).map((w) => w.exerciseId),
  )].filter((id) => exById[id]);
  let selectedExId = exercisedIds[0] || null;

  function drawAll() {
    chartInstances.forEach((c) => c.destroy());
    chartInstances = [];
    clear(chartsWrap);
    const cut = cutoffDate();
    drawBodyChart(cut);
    drawExerciseChart(cut);
    drawVolumeChart(cut);
    drawKcalChart(cut);
  }

  function chartBox(title, summaryText, headerExtra = null) {
    const canvas = el('canvas');
    const box = el('div', { class: 'chart-box' },
      el('div', { class: 'row-between' },
        el('div', { class: 'section-title', text: title }),
        headerExtra,
      ),
      summaryText ? el('p', { class: 'caption', text: summaryText }) : null,
      el('div', { class: 'chart-canvas-wrap' }, canvas),
      summaryText ? el('span', { class: 'visually-hidden', text: summaryText }) : null,
    );
    chartsWrap.append(box);
    return canvas;
  }

  const baseOptions = () => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600, easing: 'easeOutQuart' },
    plugins: {
      legend: { labels: { color: cssVar('--text-sub'), boxWidth: 12, usePointStyle: true } },
    },
    scales: {},
  });

  const timeScale = () => ({
    type: 'time',
    time: { unit: period === '1M' ? 'day' : period === '3M' ? 'week' : 'month', tooltipFormat: 'yyyy-MM-dd' },
    grid: { color: cssVar('--border'), borderDash: [4, 4] },
    ticks: { color: cssVar('--text-sub') },
  });
  const linScale = (title) => ({
    grid: { color: cssVar('--border'), borderDash: [4, 4] },
    ticks: { color: cssVar('--text-sub') },
    title: title ? { display: true, text: title, color: cssVar('--text-sub') } : undefined,
  });

  /* ============ 1. 体重・体脂肪率 ============ */
  function drawBodyChart(cut) {
    const recs = bodies.filter((b) => b.date >= cut).sort((a, b) => a.date.localeCompare(b.date));
    let summary = '';
    if (recs.length >= 2) {
      const diff = Math.round((recs[recs.length - 1].weightKg - recs[0].weightKg) * 10) / 10;
      summary = `期間内で体重 ${diff >= 0 ? '+' : ''}${diff}kg`;
    }
    const canvas = chartBox('体重・体脂肪率の推移', summary);
    if (recs.length === 0) return emptyNote(canvas, '体組成の記録がありません');

    const ma = movingAvg7(recs);
    const fatRecs = recs.filter((r) => r.bodyFatPct != null);

    const datasets = [
      {
        label: '体重(7日平均)',
        data: ma.map((r) => ({ x: parseLocal(r.date), y: r.avg })),
        borderColor: cssVar('--accent'),
        backgroundColor: cssVar('--accent-dim'),
        fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2.5,
        yAxisID: 'y',
      },
      {
        label: '体重(実測)',
        data: recs.map((r) => ({ x: parseLocal(r.date), y: r.weightKg })),
        borderColor: 'transparent',
        backgroundColor: cssVar('--accent') + '66',
        pointRadius: 3, pointStyle: 'circle', showLine: false,
        yAxisID: 'y',
      },
    ];
    if (fatRecs.length > 0) {
      datasets.push({
        label: '体脂肪率',
        data: fatRecs.map((r) => ({ x: parseLocal(r.date), y: r.bodyFatPct })),
        borderColor: cssVar('--chart-2'),
        backgroundColor: cssVar('--chart-2'),
        tension: 0.3, pointRadius: 3, pointStyle: 'triangle', borderWidth: 2,
        yAxisID: 'y2',
      });
    }

    const opts = baseOptions();
    opts.scales = {
      x: timeScale(),
      y: { ...linScale('kg'), position: 'left' },
      ...(fatRecs.length > 0 ? { y2: { ...linScale('%'), position: 'right', grid: { display: false } } } : {}),
    };
    chartInstances.push(new window.Chart(canvas, { type: 'line', data: { datasets }, options: opts }));
  }

  /* ============ 2. 種目別 重量+推定1RM ============ */
  function drawExerciseChart(cut) {
    const select = el('select', { 'aria-label': '種目を選択' });
    for (const id of exercisedIds) {
      select.append(el('option', { value: id, text: exById[id].name }));
    }
    if (selectedExId) select.value = selectedExId;
    select.addEventListener('change', () => { selectedExId = select.value; drawAll(); });
    select.style.maxWidth = '200px';

    const recs = workouts
      .filter((w) => w.exerciseId === selectedExId && w.date >= cut)
      .sort((a, b) => a.date.localeCompare(b.date));

    const allTime = workouts.filter((w) => w.exerciseId === selectedExId);
    const { best, prDates } = personalBests(allTime);
    const summary = best > 0 ? `自己ベスト ${best}kg` : '';

    const canvas = chartBox('種目別の重量推移', summary, exercisedIds.length ? select : null);
    if (!selectedExId || recs.length === 0) return emptyNote(canvas, 'この期間の記録がありません');

    const datasets = [
      {
        label: '最大重量',
        data: recs.map((w) => ({ x: parseLocal(w.date), y: maxWeight(w) })),
        borderColor: cssVar('--accent'),
        backgroundColor: recs.map((w) => prDates.has(w.date) ? cssVar('--warn') : cssVar('--accent')),
        pointStyle: recs.map((w) => (prDates.has(w.date) ? 'star' : 'circle')),
        pointRadius: recs.map((w) => (prDates.has(w.date) ? 8 : 3.5)),
        tension: 0.2, borderWidth: 2.5,
      },
      {
        label: '推定1RM',
        data: recs.map((w) => ({ x: parseLocal(w.date), y: e1RM(w) })),
        borderColor: cssVar('--chart-2'),
        backgroundColor: cssVar('--chart-2'),
        borderDash: [6, 4], tension: 0.2, pointRadius: 2, pointStyle: 'rect', borderWidth: 2,
      },
    ];
    const opts = baseOptions();
    opts.scales = { x: timeScale(), y: linScale('kg') };
    opts.plugins.tooltip = {
      callbacks: {
        afterLabel: (ctx) => {
          const w = recs[ctx.dataIndex];
          return ctx.datasetIndex === 0 && prDates.has(w.date) ? '★ 自己ベスト!' : '';
        },
      },
    };
    chartInstances.push(new window.Chart(canvas, { type: 'line', data: { datasets }, options: opts }));
  }

  /* ============ 3. 週次ボリューム(部位別積み上げ) ============ */
  function drawVolumeChart(cut) {
    const inRange = workouts.filter((w) => w.date >= cut);
    const weekly = weeklyVolumeByGroup(inRange, exById);
    const weeks = [...weekly.keys()].sort();
    const canvas = chartBox('週次トレーニングボリューム(部位別)',
      weeks.length ? `${weeks.length}週分 / 重量×回数の合計` : '');
    if (weeks.length === 0) return emptyNote(canvas, 'この期間の筋トレ記録がありません');

    const groupColors = {
      chest: cssVar('--chart-2'), back: cssVar('--chart-3'), legs: cssVar('--chart-4'),
      shoulders: cssVar('--chart-5'), arms: cssVar('--chart-6'), core: cssVar('--chart-7'),
    };
    const datasets = MUSCLE_GROUPS
      .filter((g) => weeks.some((wk) => (weekly.get(wk)[g.key] || 0) > 0))
      .map((g) => ({
        label: g.label,
        data: weeks.map((wk) => weekly.get(wk)[g.key] || 0),
        backgroundColor: groupColors[g.key],
        stack: 'vol',
      }));

    const opts = baseOptions();
    opts.scales = {
      x: { stacked: true, grid: { display: false }, ticks: { color: cssVar('--text-sub') } },
      y: { ...linScale('kg'), stacked: true },
    };
    chartInstances.push(new window.Chart(canvas, {
      type: 'bar',
      data: { labels: weeks.map((w) => w.slice(5).replace('-', '/') + '週'), datasets },
      options: opts,
    }));
  }

  /* ============ 4. 週次消費カロリー ============ */
  function drawKcalChart(cut) {
    const weekly = weeklyKcal(
      workouts.filter((w) => w.date >= cut),
      cardioRecs.filter((c) => c.date >= cut),
      exById, bodies, profile,
    );
    const weeks = [...weekly.keys()].sort();
    const totalK = weeks.reduce((s, wk) => s + weekly.get(wk).strength + weekly.get(wk).cardio, 0);
    const canvas = chartBox('週次消費カロリー', weeks.length ? `期間合計 約${fmtNum(totalK)}kcal(METs方式の推定)` : '');
    if (weeks.length === 0) {
      return emptyNote(canvas, bodies.length === 0 ? '体重を記録するとカロリーが計算できます' : 'この期間の記録がありません');
    }

    const opts = baseOptions();
    opts.scales = {
      x: { stacked: true, grid: { display: false }, ticks: { color: cssVar('--text-sub') } },
      y: { ...linScale('kcal'), stacked: true },
    };
    chartInstances.push(new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels: weeks.map((w) => w.slice(5).replace('-', '/') + '週'),
        datasets: [
          { label: '筋トレ', data: weeks.map((wk) => weekly.get(wk).strength), backgroundColor: cssVar('--chart-4'), stack: 'k' },
          { label: '有酸素', data: weeks.map((wk) => weekly.get(wk).cardio), backgroundColor: cssVar('--chart-3'), stack: 'k' },
        ],
      },
      options: opts,
    }));
  }

  function emptyNote(canvas, text) {
    const wrap = canvas.parentElement;
    clear(wrap);
    wrap.append(el('div', { class: 'empty-state' }, el('p', { class: 'caption', text })));
  }

  drawAll();
}
