// @ts-check
// home.js — ホーム/ダッシュボード
// 今日のサマリ・進行中セッション再開・今日の提案・体重ミニ表示・バックアップ催促

import { el, todayStr, formatDateJa, fmtNum, weekStart, daysBetween } from '../util.js';
import { get, getAll, getSetting } from '../db.js';
import { volume } from '../logic/stats.js';
import { workoutKcal, cardioKcal, resolveWeight } from '../logic/calories.js';
import { suggest } from '../logic/suggestion.js';
import { DEFAULT_SUGGESTION } from '../seed.js';
import { icon } from '../ui/icons.js';
import { navigate } from '../router.js';

const BACKUP_PROMPT_DAYS = 30;

export async function render(container) {
  const cutoff = (await getSetting('dateCutoff', { hour: 3 })).hour;
  const today = todayStr(cutoff);

  const [workouts, cardio, bodies, exercises, profile, params] = await Promise.all([
    getAll('workouts'), getAll('cardio'), getAll('body'), getAll('exercises'),
    getSetting('profile'), getSetting('suggestion', DEFAULT_SUGGESTION),
  ]);
  const exById = Object.fromEntries(exercises.map((e) => [e.id, e]));

  container.append(
    el('div', { class: 'view-header' },
      el('h1', { text: formatDateJa(today) }),
    ),
  );

  /* ---- 進行中セッションの再開バナー(サーキット優先・二重表示しない) ---- */
  const circuitState = await getSetting('activeCircuitTimer');
  if (circuitState && circuitState.date === today) {
    const doneM = Math.floor((circuitState.segIndex || 0) / 4);
    const totalM = (circuitState.order || []).length || 10;
    container.append(el('div', { class: 'banner' },
      el('span', { class: 'grow', text: `🔄 サーキット ${doneM}/${totalM} 実施中` }),
      el('button', { class: 'btn btn-primary', text: '再開', onClick: () => navigate('/circuit') }),
    ));
  } else {
    const active = await getSetting('activeWorkout');
    if (active && active.date === today) {
      const ex = exById[active.exerciseId];
      const rec = await get('workouts', active.recordId);
      if (ex && rec && !rec.deletedAt) {
        const doneCount = (rec.sets || []).filter((s) => s.done).length;
        container.append(el('div', { class: 'banner' },
          el('span', { class: 'grow', text: `「${ex.name}」${doneCount}セットまで記録中` }),
          el('button', { class: 'btn btn-primary', text: '再開', onClick: () => navigate(`/workout/${ex.id}`) }),
        ));
      }
    }
  }

  /* ---- バックアップ催促バナー(30日超+記録あり) ---- */
  const lastExportAt = await getSetting('lastExportAt');
  const hasRecords = workouts.length + cardio.length + bodies.length > 0;
  if (hasRecords) {
    const daysSince = lastExportAt
      ? Math.floor((Date.now() - new Date(lastExportAt).getTime()) / 86400000)
      : Infinity;
    if (daysSince >= BACKUP_PROMPT_DAYS) {
      container.append(el('div', { class: 'banner banner-warn' },
        el('span', { class: 'grow', text: lastExportAt
          ? `最後のバックアップから${daysSince}日経過しています`
          : 'データのバックアップがまだありません' }),
        el('button', { class: 'btn', text: 'バックアップ', onClick: () => navigate('/settings') }),
      ));
    }
  }

  const grid = el('div', { class: 'home-grid' });
  container.append(grid);

  /* ---- 今週のボリューム + 今日のカロリー ---- */
  const thisWeek = weekStart(today);
  const weekVol = workouts.filter((w) => weekStart(w.date) === thisWeek).reduce((s, w) => s + volume(w), 0);
  const prevWeekStart = weekStart(addDays(thisWeek, -7));
  const prevVol = workouts.filter((w) => weekStart(w.date) === prevWeekStart).reduce((s, w) => s + volume(w), 0);
  const diffPct = prevVol > 0 ? Math.round(((weekVol - prevVol) / prevVol) * 100) : null;

  let todayKcal = 0;
  const weightToday = resolveWeight(today, bodies, profile);
  if (weightToday) {
    for (const w of workouts.filter((x) => x.date === today)) {
      const ex = exById[w.exerciseId];
      if (ex) todayKcal += workoutKcal(w, ex, weightToday).kcal;
    }
    for (const c of cardio.filter((x) => x.date === today)) {
      const ex = exById[c.exerciseId];
      if (ex) todayKcal += cardioKcal(c, ex, weightToday);
    }
  }

  const latestBody = bodies.filter((b) => b.weightKg > 0).sort((a, b) => b.date.localeCompare(a.date))[0];

  grid.append(
    el('div', { class: 'card' },
      el('div', { class: 'section-title', text: '今週のボリューム' }),
      el('div', { class: 'hero-num', text: fmtNum(weekVol) + ' kg' }),
      diffPct != null
        ? el('div', { class: 'caption ' + (diffPct >= 0 ? 'text-accent' : ''), text: `先週比 ${diffPct >= 0 ? '+' : ''}${diffPct}%` })
        : el('div', { class: 'caption', text: '今週も積み上げよう' }),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'section-title', text: '今日の消費カロリー' }),
      el('div', { class: 'hero-num', text: fmtNum(todayKcal) + ' kcal' }),
      el('div', { class: 'caption', text: weightToday ? 'METs方式の推定値' : '体重を記録すると計算できます' }),
    ),
  );

  /* ---- 体重カード ---- */
  grid.append(el('div', {
    class: 'card tappable',
    role: 'button', tabindex: '0',
    onClick: () => navigate('/charts'),
  },
    el('div', { class: 'section-title', text: '体重' }),
    latestBody
      ? el('div', {},
          el('div', { class: 'hero-num', text: `${latestBody.weightKg} kg` }),
          el('div', { class: 'caption', text: `${formatDateJa(latestBody.date)} 記録${latestBody.bodyFatPct != null ? ` / 体脂肪 ${latestBody.bodyFatPct}%` : ''}` }),
        )
      : el('div', { class: 'caption', text: '未記録 — タップでグラフ、下のボタンで記録' }),
  ));

  /* ---- 今日の提案カード ---- */
  const suggestion = suggest(workouts, exercises, params, today);
  const suggestCard = el('div', { class: 'card' },
    el('div', { class: 'row-between' },
      el('div', { class: 'section-title', text: `今日の提案 ▸ ${suggestion.targetGroupLabel}` }),
      el('button', { class: 'btn btn-ghost', text: 'すべて見る', onClick: () => navigate('/suggest') }),
    ),
  );
  if (suggestion.items.length > 0) {
    for (const item of suggestion.items.slice(0, 3)) {
      const setsLabel = item.sets[0]?.weight != null
        ? `${item.sets[0].weight}kg × ${item.sets[0].reps}回 × ${item.sets.length}セット`
        : `${item.sets[0]?.reps ?? 10}回 × ${item.sets.length}セット(重量は調整)`;
      suggestCard.append(el('div', {
        class: 'list-item',
        role: 'button', tabindex: '0',
        onClick: () => {
          sessionStorage.setItem('prefill', JSON.stringify({ exerciseId: item.exerciseId, sets: item.sets }));
          navigate(`/workout/${item.exerciseId}`);
        },
      },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title', text: item.exerciseName }),
          el('div', { class: 'li-sub', text: setsLabel }),
        ),
        item.deload ? el('span', { class: 'pill warn', text: 'デロード' }) : icon('chevronRight', 18),
      ));
    }
  } else {
    suggestCard.append(el('p', { class: 'caption', text: '記録が増えると、前回の内容に基づいた提案が表示されます。' }));
  }
  if (grid.classList) suggestCard.classList.add('span-2');
  grid.append(suggestCard);

  /* ---- クイック記録ボタン ---- */
  grid.append(el('div', { class: 'card span-2' },
    el('div', { class: 'section-title', text: '記録する' }),
    el('div', { class: 'row' },
      el('button', { class: 'btn grow', onClick: () => navigate('/workout') }, icon('dumbbell', 18), '筋トレ'),
      el('button', { class: 'btn grow', onClick: () => navigate('/cardio') }, icon('run', 18), '有酸素'),
      el('button', { class: 'btn grow', onClick: () => navigate('/body') }, icon('scale', 18), '体組成'),
    ),
    el('button', { class: 'btn btn-cta mt-2', onClick: () => navigate('/circuit') },
      icon('timer', 18), 'サーキット(30分)'),
  ));

  /* ---- 今日の記録サマリ ---- */
  const todayWorkouts = workouts.filter((w) => w.date === today);
  const todayCardio = cardio.filter((c) => c.date === today);
  if (todayWorkouts.length + todayCardio.length > 0) {
    const summary = el('div', { class: 'card span-2' },
      el('div', { class: 'section-title', text: '今日の記録' }),
    );
    for (const w of todayWorkouts) {
      const ex = exById[w.exerciseId];
      const sets = (w.sets || []).filter((s) => s.done !== false);
      summary.append(el('div', { class: 'row-between mt-2' },
        el('span', { text: ex ? ex.name : '?' }),
        el('span', { class: 'text-sub num', text: `${sets.length}セット ${fmtNum(volume(w))}kg` }),
      ));
    }
    for (const c of todayCardio) {
      const ex = exById[c.exerciseId];
      summary.append(el('div', { class: 'row-between mt-2' },
        el('span', { text: ex ? ex.name : '?' }),
        el('span', { class: 'text-sub num', text: `${c.durationMin}分${c.distanceKm ? ` ${c.distanceKm}km` : ''}` }),
      ));
    }
    grid.append(summary);
  }
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}
