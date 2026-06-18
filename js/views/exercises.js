// @ts-check
// exercises.js — 種目マスタ管理画面(追加/編集/無効化)

import { el, clear, uuid } from '../util.js';
import { getAll, put, softDelete, restore } from '../db.js';
import { MUSCLE_GROUPS, MUSCLE_LABEL } from '../data/default-exercises.js';
import { toast, openModal, openActionMenu } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { navigate } from '../router.js';

export async function render(container) {
  container.append(
    el('div', { class: 'view-header' },
      el('button', { class: 'back-btn', 'aria-label': '戻る', onClick: () => navigate('/settings') }, icon('chevronLeft')),
      el('h1', { text: '種目管理' }),
      el('button', { class: 'btn', onClick: () => editExercise(null, refresh) }, icon('plus', 18), '追加'),
    ),
  );

  const tabRow = el('div', { class: 'chip-row' });
  const listWrap = el('div', {});
  container.append(tabRow, listWrap);

  let activeTab = 'strength';
  const tabs = [
    { key: 'strength', label: '筋トレ' },
    { key: 'cardio', label: '有酸素' },
  ];
  for (const t of tabs) {
    tabRow.append(el('button', {
      class: 'chip' + (t.key === activeTab ? ' active' : ''),
      text: t.label,
      dataset: { tab: t.key },
      onClick: () => {
        activeTab = t.key;
        tabRow.querySelectorAll('.chip').forEach((c) =>
          c.classList.toggle('active', c.dataset.tab === t.key));
        refresh();
      },
    }));
  }

  async function refresh() {
    clear(listWrap);
    const all = (await getAll('exercises'))
      .filter((e) => e.type === activeTab)
      .sort((a, b) =>
        (a.muscleGroup || '').localeCompare(b.muscleGroup || '') || a.sortOrder - b.sortOrder);

    let lastGroup = null;
    for (const ex of all) {
      if (activeTab === 'strength' && ex.muscleGroup !== lastGroup) {
        lastGroup = ex.muscleGroup;
        listWrap.append(el('div', { class: 'section-title mt-4', text: MUSCLE_LABEL[lastGroup] || lastGroup }));
      }
      listWrap.append(el('div', { class: 'list-item' },
        el('div', { class: 'li-main', onClick: () => editExercise(ex, refresh) },
          el('div', { class: 'li-title', text: ex.name }),
          el('div', {
            class: 'li-sub',
            text: ex.type === 'strength'
              ? `METs ${ex.mets} / 重量刻み ${ex.increment}kg${ex.isCompound ? ' / 複合種目' : ''}`
              : `METs ${ex.mets}${ex.hasDistance ? ' / 距離入力あり' : ''}`,
          }),
        ),
        el('button', { class: 'btn btn-ghost', 'aria-label': 'メニュー', onClick: (e) => {
          e.stopPropagation();
          openActionMenu([
            { label: '編集', iconName: 'edit', onSelect: () => editExercise(ex, refresh) },
            { label: '削除(記録は残ります)', iconName: 'trash', danger: true, onSelect: async () => {
              await softDelete('exercises', ex.id);
              toast(`「${ex.name}」を削除しました`, {
                actionLabel: '取り消す',
                onAction: async () => { await restore('exercises', ex.id); refresh(); },
              });
              refresh();
            } },
          ]);
        } }, icon('more', 18)),
      ));
    }
    if (all.length === 0) {
      listWrap.append(el('div', { class: 'empty-state' },
        el('div', { class: 'empty-emoji', text: '🏋️' }),
        el('p', { text: '種目がありません。右上の「追加」から登録できます。' }),
      ));
    }
  }
  await refresh();
}

/** 種目の追加/編集モーダル */
function editExercise(exercise, onSaved) {
  const isNew = !exercise;
  const ex = exercise || {
    id: uuid(), name: '', type: 'strength', muscleGroup: 'chest',
    mets: 5.0, increment: 2.5, isCompound: false, hasDistance: false, sortOrder: 500,
  };

  const nameInput = el('input', { type: 'text', value: ex.name, maxlength: '100', placeholder: '例: ベンチプレス' });
  const typeSelect = el('select', {},
    el('option', { value: 'strength', text: '筋トレ' }),
    el('option', { value: 'cardio', text: '有酸素' }),
  );
  typeSelect.value = ex.type;
  const groupSelect = el('select', {},
    ...MUSCLE_GROUPS.map((g) => el('option', { value: g.key, text: g.label })),
  );
  groupSelect.value = ex.muscleGroup || 'chest';
  const metsInput = el('input', { type: 'number', step: '0.1', min: '1', max: '20', value: String(ex.mets) });
  const incInput = el('input', { type: 'number', step: '0.5', min: '0', max: '50', value: String(ex.increment) });
  const compoundCheck = el('input', { type: 'checkbox' });
  compoundCheck.checked = !!ex.isCompound;
  const distanceCheck = el('input', { type: 'checkbox' });
  distanceCheck.checked = !!ex.hasDistance;

  const strengthFields = el('div', {},
    el('div', { class: 'field' }, el('div', { class: 'field-label', text: '部位' }), groupSelect),
    el('div', { class: 'field' }, el('div', { class: 'field-label', text: '重量の刻み幅(kg)— 提案時の増加単位' }), incInput),
    el('label', { class: 'field row' }, compoundCheck, '複合種目(BIG3など。提案で優先される)'),
  );
  const cardioFields = el('div', {},
    el('label', { class: 'field row' }, distanceCheck, '距離も記録する(ランニングなど)'),
  );
  const syncTypeFields = () => {
    strengthFields.hidden = typeSelect.value !== 'strength';
    cardioFields.hidden = typeSelect.value !== 'cardio';
  };
  typeSelect.addEventListener('change', syncTypeFields);
  syncTypeFields();

  const close = openModal(el('div', {},
    el('h2', { text: isNew ? '種目を追加' : '種目を編集' }),
    el('div', { class: 'field' }, el('div', { class: 'field-label', text: '種目名' }), nameInput),
    el('div', { class: 'field' }, el('div', { class: 'field-label', text: '種類' }), typeSelect),
    strengthFields,
    cardioFields,
    el('div', { class: 'field' },
      el('div', { class: 'field-label', text: 'METs(消費カロリー計算用。筋トレ一般=5.0)' }), metsInput),
    el('button', { class: 'btn btn-primary btn-cta mt-2', text: '保存', onClick: async () => {
      const name = nameInput.value.trim();
      if (!name) { toast('種目名を入力してください'); return; }
      const mets = parseFloat(metsInput.value);
      const increment = parseFloat(incInput.value);
      await put('exercises', {
        ...ex,
        name: name.slice(0, 100),
        type: typeSelect.value,
        muscleGroup: typeSelect.value === 'strength' ? groupSelect.value : null,
        mets: Number.isFinite(mets) && mets > 0 ? mets : 5.0,
        increment: Number.isFinite(increment) && increment >= 0 ? increment : 2.5,
        isCompound: compoundCheck.checked,
        hasDistance: typeSelect.value === 'cardio' ? distanceCheck.checked : false,
      });
      close();
      toast(isNew ? '種目を追加しました' : '保存しました');
      onSaved && onSaved();
    } }),
  ));
}
