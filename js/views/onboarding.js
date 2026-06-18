// @ts-check
// onboarding.js — 初回起動時の1画面セットアップ
// 体重・身長(カロリー計算用)+「ホーム画面に追加」案内+データ保存先の説明

import { el, isIOS, isStandalone } from '../util.js';
import { putSetting } from '../db.js';
import { createStepper } from '../ui/stepper.js';
import { navigate } from '../router.js';

export async function render(container) {
  const weightStepper = createStepper({ value: 60, step: 0.5, unit: 'kg', decimal: true, min: 20, max: 300 });
  const heightStepper = createStepper({ value: 165, step: 1, unit: 'cm', min: 100, max: 250 });

  const installNote = !isStandalone()
    ? el('div', { class: 'banner banner-warn' },
        el('div', {},
          el('div', { text: '📲 ホーム画面に追加してください(重要)' }),
          el('div', { class: 'caption mt-2', text: isIOS()
            ? 'iPhoneでは、Safariの共有ボタン → 「ホーム画面に追加」。ブラウザのままだと7日間使わないとデータが消えることがあります。'
            : 'Chromeのメニュー → 「ホーム画面に追加」または「アプリをインストール」でアプリとして使えます。' }),
        ))
    : null;

  container.append(
    el('div', { class: 'view-header' }, el('h1', { text: 'はじめに' })),
    el('p', { class: 'text-sub mb-4', text: 'トレ管へようこそ。消費カロリーの計算に使うため、体重と身長を教えてください(あとから設定で変更できます)。' }),
    el('div', { class: 'card mb-4' },
      el('div', { class: 'field' }, el('div', { class: 'field-label', text: '体重' }), weightStepper.root),
      el('div', { class: 'field' }, el('div', { class: 'field-label', text: '身長' }), heightStepper.root),
    ),
    installNote,
    el('div', { class: 'card mb-4' },
      el('div', { class: 'caption', text: '🔒 データの保存先について: 記録はすべてこの端末のブラウザ内にのみ保存されます。外部のサーバーには一切送信されません。スマホとPCの間でデータを移すときは、設定画面の「エクスポート/インポート」を使います。' }),
    ),
    el('div', { class: 'cta-bar' },
      el('button', { class: 'btn btn-ghost', text: 'スキップ', onClick: finish(null) }),
      el('button', { class: 'btn btn-primary btn-cta', text: 'はじめる', onClick: finish(() => ({
        fallbackWeightKg: weightStepper.get() || null,
        heightCm: heightStepper.get() || null,
      })) }),
    ),
  );

  function finish(getProfile) {
    return async () => {
      if (getProfile) {
        const p = getProfile();
        if (p.fallbackWeightKg) await putSetting('profile', p);
      }
      await putSetting('onboarded', true);
      navigate('/');
    };
  }
}
