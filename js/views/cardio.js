// @ts-check
// cardio.js — 有酸素運動の記録(種目・時間・距離)。保存時に消費カロリー即表示

import { el, clear, uuid, todayStr, formatDateJa } from '../util.js';
import { get, getAll, put, getSetting } from '../db.js';
import { cardioKcal, resolveWeight } from '../logic/calories.js';
import { toast } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { createStepper } from '../ui/stepper.js';
import { navigate } from '../router.js';

/** #/cardio(新規)または #/cardio/:id(編集) */
export async function render(container, params) {
  const cutoff = (await getSetting('dateCutoff', { hour: 3 })).hour;
  const today = todayStr(cutoff);

  let record = null;
  if (params.id) {
    record = await get('cardio', params.id);
    if (!record) { toast('記録が見つかりません'); navigate('/history'); return; }
  }

  const exercises = (await getAll('exercises'))
    .filter((e) => e.type === 'cardio')
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (exercises.length === 0) { toast('有酸素種目がありません。種目管理から追加してください'); navigate('/'); return; }

  const date = record ? record.date : today;

  container.append(
    el('div', { class: 'view-header' },
      el('button', { class: 'back-btn', 'aria-label': '戻る', onClick: () => navigate(params.id ? '/history' : '/') }, icon('chevronLeft')),
      el('div', { class: 'grow' },
        el('h1', { text: '有酸素運動を記録' }),
        el('div', { class: 'caption', text: formatDateJa(date, true) }),
      ),
    ),
  );

  const exSelect = el('select', {},
    ...exercises.map((e) => el('option', { value: e.id, text: e.name })),
  );
  exSelect.value = record?.exerciseId || exercises[0].id;

  const durStepper = createStepper({ value: record?.durationMin ?? 30, step: 5, unit: '分', min: 1, max: 600 });
  const distStepper = createStepper({ value: record?.distanceKm ?? null, step: 0.5, unit: 'km', decimal: true, min: 0, max: 300 });

  const distField = el('div', { class: 'field' },
    el('div', { class: 'field-label', text: '距離(任意)' }), distStepper.root);

  const kcalPreview = el('div', { class: 'caption text-center mt-2' });

  const syncFields = async () => {
    const ex = exercises.find((e) => e.id === exSelect.value);
    distField.hidden = !ex?.hasDistance;
    // カロリープレビュー
    const bodies = await getAll('body');
    const profile = await getSetting('profile');
    const weightKg = resolveWeight(date, bodies, profile);
    const dur = durStepper.get();
    if (ex && weightKg && dur) {
      kcalPreview.textContent = `推定消費カロリー: 約${cardioKcal({ durationMin: dur }, ex, weightKg)}kcal(METs ${ex.mets} × 体重${weightKg}kg)`;
    } else {
      kcalPreview.textContent = weightKg ? '' : '体重を記録するとカロリーが計算できます';
    }
  };
  exSelect.addEventListener('change', syncFields);
  durStepper.root.addEventListener('change', syncFields, true);
  durStepper.root.addEventListener('click', syncFields, true);

  container.append(
    el('div', { class: 'card' },
      el('div', { class: 'field' }, el('div', { class: 'field-label', text: '種目' }), exSelect),
      el('div', { class: 'field' }, el('div', { class: 'field-label', text: '時間' }), durStepper.root),
      distField,
      kcalPreview,
    ),
  );

  container.append(el('div', { class: 'cta-bar' },
    el('button', { class: 'btn btn-primary btn-cta', text: '保存', onClick: async () => {
      const durationMin = durStepper.get();
      if (!durationMin || durationMin <= 0) { toast('時間を入力してください'); return; }
      const ex = exercises.find((e) => e.id === exSelect.value);
      const rec = {
        ...(record || { id: uuid(), date, note: '' }),
        exerciseId: exSelect.value,
        durationMin,
        distanceKm: ex?.hasDistance ? (distStepper.get() || null) : null,
      };
      await put('cardio', rec);

      const bodies = await getAll('body');
      const profile = await getSetting('profile');
      const weightKg = resolveWeight(date, bodies, profile);
      if (ex && weightKg) {
        toast(`🏃 記録しました 約${cardioKcal(rec, ex, weightKg)}kcal消費`);
      } else {
        toast('🏃 記録しました');
      }
      navigate(params.id ? '/history' : '/');
    } }),
  ));

  syncFields();
}
