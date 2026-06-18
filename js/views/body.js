// @ts-check
// body.js — 体組成入力(体重・体脂肪率)。手動入力+写真読み取り(OCR)起点

import { el, todayStr, formatDateJa } from '../util.js';
import { get, put, getSetting } from '../db.js';
import { toast, confirmDialog } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { createStepper } from '../ui/stepper.js';
import { navigate } from '../router.js';

/**
 * #/body(今日)または #/body/:date(編集)
 * OCR確認画面からは sessionStorage 'ocrResult' = {weightKg, bodyFatPct} 経由でプリフィル
 */
export async function render(container, params) {
  const cutoff = (await getSetting('dateCutoff', { hour: 3 })).hour;
  const date = params.date || todayStr(cutoff);
  const existing = await get('body', date);
  const isEdit = !!(existing && !existing.deletedAt);

  let ocrPrefill = null;
  try { ocrPrefill = JSON.parse(sessionStorage.getItem('ocrResult') || 'null'); } catch { /* noop */ }
  sessionStorage.removeItem('ocrResult');

  const init = {
    weightKg: ocrPrefill?.weightKg ?? existing?.weightKg ?? null,
    bodyFatPct: ocrPrefill?.bodyFatPct ?? existing?.bodyFatPct ?? null,
  };

  container.append(
    el('div', { class: 'view-header' },
      el('button', { class: 'back-btn', 'aria-label': '戻る', onClick: () => navigate(params.date ? '/history' : '/') }, icon('chevronLeft')),
      el('div', { class: 'grow' },
        el('h1', { text: '体組成を記録' }),
        el('div', { class: 'caption', text: formatDateJa(date, true) }),
      ),
    ),
  );

  if (ocrPrefill) {
    container.append(el('div', { class: 'banner' },
      el('span', { text: '📷 写真から読み取った値が入っています。確認・修正して保存してください。' }),
    ));
  }

  const weightStepper = createStepper({ value: init.weightKg, step: 0.1, unit: 'kg', decimal: true, min: 20, max: 300 });
  const fatStepper = createStepper({ value: init.bodyFatPct, step: 0.1, unit: '%', decimal: true, min: 1, max: 60 });

  container.append(
    el('div', { class: 'card mb-4' },
      el('div', { class: 'field' }, el('div', { class: 'field-label', text: '体重' }), weightStepper.root),
      el('div', { class: 'field' }, el('div', { class: 'field-label', text: '体脂肪率(任意)' }), fatStepper.root),
    ),
    el('button', { class: 'btn btn-cta mb-2', onClick: () => navigate('/ocr') },
      icon('camera', 20), '写真から読み取り(体重計の表示を撮影)'),
  );

  container.append(el('div', { class: 'cta-bar' },
    el('button', { class: 'btn btn-primary btn-cta', text: '保存', onClick: async () => {
      const weightKg = weightStepper.get();
      const bodyFatPct = fatStepper.get();
      if (!weightKg || weightKg < 20 || weightKg > 300) {
        toast('体重を入力してください(20〜300kg)');
        return;
      }
      if (isEdit && !params.date) {
        const ok = await confirmDialog('上書き確認',
          `${formatDateJa(date)}の記録(${existing.weightKg}kg)を上書きしますか?`,
          { okLabel: '上書き' });
        if (!ok) return;
      }
      await put('body', {
        ...(existing || {}),
        date, weightKg,
        bodyFatPct: bodyFatPct && bodyFatPct >= 1 && bodyFatPct <= 60 ? bodyFatPct : null,
        muscleKg: existing?.muscleKg ?? null,
        source: ocrPrefill ? 'ocr' : 'manual',
        note: existing?.note || '',
        deletedAt: null,
      });
      toast(`💪 体重 ${weightKg}kg を記録しました`);
      navigate(params.date ? '/history' : '/');
    } }),
  ));
}
