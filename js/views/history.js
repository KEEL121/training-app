// @ts-check
// history.js — 記録履歴(日付降順・編集・論理削除+Undo)

import { el, clear, formatDateJa, fmtNum } from '../util.js';
import { getAll, softDelete, restore, getSetting } from '../db.js';
import { volume } from '../logic/stats.js';
import { workoutKcal, cardioKcal, resolveWeight } from '../logic/calories.js';
import { toast, openActionMenu } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { navigate } from '../router.js';

const PAGE_DAYS = 14;

export async function render(container) {
  container.append(
    el('div', { class: 'view-header' }, el('h1', { text: '履歴' })),
  );

  const [workouts, cardio, bodies, exercises, profile] = await Promise.all([
    getAll('workouts'), getAll('cardio'), getAll('body'), getAll('exercises'), getSetting('profile'),
  ]);
  const exById = Object.fromEntries(exercises.map((e) => [e.id, e]));

  // 日付ごとにまとめる
  /** @type {Map<string, {workouts: any[], cardio: any[], body: any|null}>} */
  const byDate = new Map();
  const bucket = (d) => {
    if (!byDate.has(d)) byDate.set(d, { workouts: [], cardio: [], body: null });
    return byDate.get(d);
  };
  workouts.forEach((w) => bucket(w.date).workouts.push(w));
  cardio.forEach((c) => bucket(c.date).cardio.push(c));
  bodies.forEach((b) => { bucket(b.date).body = b; });

  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

  if (dates.length === 0) {
    container.append(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-emoji', text: '📋' }),
      el('p', { text: 'まだ記録がありません。今日のトレーニングから始めましょう。' }),
      el('button', { class: 'btn btn-primary', text: '記録をつける', onClick: () => navigate('/workout') }),
    ));
    return;
  }

  const listWrap = el('div', {});
  container.append(listWrap);

  let shown = 0;
  const moreBtn = el('button', { class: 'btn btn-cta mt-2', text: 'さらに表示', onClick: showMore });
  container.append(moreBtn);

  function showMore() {
    const slice = dates.slice(shown, shown + PAGE_DAYS);
    shown += slice.length;
    for (const date of slice) listWrap.append(dayBlock(date, byDate.get(date)));
    moreBtn.hidden = shown >= dates.length;
  }

  function dayBlock(date, group) {
    const block = el('div', { class: 'mb-4' },
      el('div', { class: 'section-title', text: formatDateJa(date, true) }),
    );

    // 体組成
    if (group.body) {
      const b = group.body;
      block.append(itemRow(
        'scale',
        '体組成',
        `${b.weightKg}kg${b.bodyFatPct != null ? ` / 体脂肪 ${b.bodyFatPct}%` : ''}${b.source === 'ocr' ? '(写真読取)' : ''}`,
        [
          { label: '編集', iconName: 'edit', onSelect: () => navigate(`/body/${b.date}`) },
          delAction('body', b.date, '体組成記録'),
        ],
        () => navigate(`/body/${b.date}`),
      ));
    }

    // 筋トレ
    for (const w of group.workouts) {
      const ex = exById[w.exerciseId];
      const sets = (w.sets || []).filter((s) => s.done !== false);
      const maxW = sets.length ? Math.max(...sets.map((s) => s.weight || 0)) : 0;
      const weightKg = resolveWeight(w.date, bodies, profile);
      const kcalStr = ex && weightKg ? ` / 約${workoutKcal(w, ex, weightKg).kcal}kcal` : '';
      block.append(itemRow(
        'dumbbell',
        ex ? ex.name : '(削除された種目)',
        `${maxW}kg × ${sets.map((s) => s.reps).join('/')} ・ ${fmtNum(volume(w))}kg${kcalStr}`,
        [
          { label: '編集', iconName: 'edit', onSelect: () => navigate(`/workout-rec/${w.id}`) },
          delAction('workouts', w.id, ex ? ex.name : '記録'),
        ],
        () => navigate(`/workout-rec/${w.id}`),
      ));
    }

    // 有酸素
    for (const c of group.cardio) {
      const ex = exById[c.exerciseId];
      const weightKg = resolveWeight(c.date, bodies, profile);
      const kcalStr = ex && weightKg ? ` / 約${cardioKcal(c, ex, weightKg)}kcal` : '';
      block.append(itemRow(
        'run',
        ex ? ex.name : '(削除された種目)',
        `${c.durationMin}分${c.distanceKm ? ` / ${c.distanceKm}km` : ''}${kcalStr}`,
        [
          { label: '編集', iconName: 'edit', onSelect: () => navigate(`/cardio/${c.id}`) },
          delAction('cardio', c.id, ex ? ex.name : '記録'),
        ],
        () => navigate(`/cardio/${c.id}`),
      ));
    }
    return block;
  }

  function itemRow(iconName, title, sub, actions, onTap) {
    return el('div', { class: 'list-item' },
      icon(iconName),
      el('div', { class: 'li-main', onClick: onTap },
        el('div', { class: 'li-title', text: title }),
        el('div', { class: 'li-sub', text: sub }),
      ),
      el('button', { class: 'btn btn-ghost', 'aria-label': 'メニュー', onClick: (e) => {
        e.stopPropagation();
        openActionMenu(actions);
      } }, icon('more', 18)),
    );
  }

  function delAction(store, key, label) {
    return {
      label: '削除', iconName: 'trash', danger: true,
      onSelect: async () => {
        await softDelete(store, key);
        toast(`「${label}」を削除しました`, {
          actionLabel: '取り消す',
          onAction: async () => { await restore(store, key); navigate('/history'); },
        });
        navigate('/history'); // 再描画
      },
    };
  }

  showMore();
}
