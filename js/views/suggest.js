// @ts-check
// suggest.js — AIメニュー提案画面(ルールベース)。根拠付き+ワンタップで記録開始

import { el, todayStr } from '../util.js';
import { getAll, getSetting } from '../db.js';
import { suggest } from '../logic/suggestion.js';
import { DEFAULT_SUGGESTION } from '../seed.js';
import { icon } from '../ui/icons.js';
import { navigate } from '../router.js';

export async function render(container) {
  const cutoff = (await getSetting('dateCutoff', { hour: 3 })).hour;
  const today = todayStr(cutoff);
  const [workouts, exercises, params] = await Promise.all([
    getAll('workouts'), getAll('exercises'), getSetting('suggestion', DEFAULT_SUGGESTION),
  ]);

  container.append(
    el('div', { class: 'view-header' },
      el('button', { class: 'back-btn', 'aria-label': '戻る', onClick: () => navigate('/') }, icon('chevronLeft')),
      el('h1', { text: '今日のメニュー提案' }),
    ),
  );

  const result = suggest(workouts, exercises, params, today);

  if (!result.targetGroup || result.items.length === 0) {
    container.append(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-emoji', text: '✨' }),
      el('p', { text: '提案できる種目がありません。種目管理で筋トレ種目を登録してください。' }),
    ));
    return;
  }

  container.append(el('div', { class: 'banner' },
    icon('sparkles'),
    el('div', { class: 'grow' },
      el('div', { text: `今日のおすすめ部位: ${result.targetGroupLabel}` }),
      el('div', { class: 'caption', text: '回復時間(48時間)と前回からの間隔をもとに選んでいます' }),
    ),
  ));

  for (const item of result.items) {
    const setsText = item.sets[0]?.weight != null
      ? item.sets.map((s) => `${s.weight}kg×${s.reps}`).join(' / ')
      : `${item.sets[0]?.reps ?? 10}回 × ${item.sets.length}セット(重量はフォームを確認しながら)`;

    container.append(el('div', { class: 'card mb-2' },
      el('div', { class: 'row-between' },
        el('div', { class: 'li-title', text: item.exerciseName }),
        item.deload ? el('span', { class: 'pill warn', text: 'デロード' }) : null,
      ),
      el('div', { class: 'num mt-2', text: setsText }),
      el('p', { class: 'caption mt-2', text: '💡 ' + item.reason }),
      el('button', {
        class: 'btn btn-primary btn-cta mt-2',
        text: 'このメニューで記録開始',
        onClick: () => {
          sessionStorage.setItem('prefill', JSON.stringify({ exerciseId: item.exerciseId, sets: item.sets }));
          navigate(`/workout/${item.exerciseId}`);
        },
      }),
    ));
  }

  container.append(el('p', { class: 'caption text-center mt-4', text: '提案は初期値です。記録画面で自由に変更できます。' }));
}
