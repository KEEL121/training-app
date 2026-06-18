// @ts-check
// settings.js — 設定(プロフィール/提案/タイマー/データ管理/エクスポート・インポート)

import { el, clear, fmtNum, formatDateJa, isStandalone, isIOS } from '../util.js';
import {
  getAll, getSetting, putSetting, clearAllStores, isPersisted, requestPersist, storageEstimate, uuid,
} from '../db.js';
import { buildExport, exportFileName, parseImport, planMerge, applyMerge } from '../logic/sync.js';
import { seedIfNeeded, DEFAULT_SUGGESTION, DEFAULT_REST_TIMER } from '../seed.js';
import { toast, openModal, confirmDialog } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { navigate } from '../router.js';

export async function render(container) {
  container.append(el('div', { class: 'view-header' }, el('h1', { text: '設定' })));

  const profile = await getSetting('profile', { fallbackWeightKg: null, heightCm: null });
  const sugParams = await getSetting('suggestion', DEFAULT_SUGGESTION);
  const restCfg = await getSetting('restTimer', DEFAULT_REST_TIMER);
  const cutoffCfg = await getSetting('dateCutoff', { hour: 3 });

  /* ---- プロフィール ---- */
  const weightInput = el('input', { type: 'number', step: '0.1', min: '20', max: '300', value: profile.fallbackWeightKg ?? '' });
  const heightInput = el('input', { type: 'number', step: '1', min: '100', max: '250', value: profile.heightCm ?? '' });
  container.append(sectionCard('プロフィール(カロリー計算用)',
    el('div', { class: 'field' }, el('div', { class: 'field-label', text: '基準体重(kg)— 体組成記録がない日の計算に使用' }), weightInput),
    el('div', { class: 'field' }, el('div', { class: 'field-label', text: '身長(cm)' }), heightInput),
    el('button', { class: 'btn', text: '保存', onClick: async () => {
      const w = parseFloat(weightInput.value);
      const h = parseFloat(heightInput.value);
      await putSetting('profile', {
        fallbackWeightKg: Number.isFinite(w) && w >= 20 && w <= 300 ? w : null,
        heightCm: Number.isFinite(h) && h >= 100 && h <= 250 ? h : null,
      });
      toast('保存しました');
    } }),
  ));

  /* ---- トレーニング設定 ---- */
  const restSecInput = el('input', { type: 'number', step: '5', min: '10', max: '600', value: String(restCfg.sec) });
  const restEnabledCheck = el('input', { type: 'checkbox' });
  restEnabledCheck.checked = restCfg.enabled !== false;
  const repsHighInput = el('input', { type: 'number', min: '1', max: '50', value: String(sugParams.targetRepsHigh) });
  const recoveryInput = el('input', { type: 'number', step: '12', min: '0', max: '336', value: String(sugParams.recoveryHours) });
  container.append(sectionCard('トレーニング設定',
    el('label', { class: 'field row' }, restEnabledCheck, 'レストタイマー+画面スリープ防止を使う'),
    el('div', { class: 'field' }, el('div', { class: 'field-label', text: 'レストタイマー(秒)' }), restSecInput),
    el('div', { class: 'field' }, el('div', { class: 'field-label', text: '提案: 目標回数(全セット達成で重量アップ)' }), repsHighInput),
    el('div', { class: 'field' }, el('div', { class: 'field-label', text: '提案: 部位の回復時間(時間)' }), recoveryInput),
    el('button', { class: 'btn', text: '保存', onClick: async () => {
      const sec = parseInt(restSecInput.value, 10);
      await putSetting('restTimer', {
        sec: Number.isFinite(sec) && sec >= 10 ? Math.min(sec, 600) : 90,
        enabled: restEnabledCheck.checked,
      });
      const high = parseInt(repsHighInput.value, 10) || 10;
      const rec = parseInt(recoveryInput.value, 10);
      await putSetting('suggestion', {
        ...sugParams,
        targetRepsHigh: high,
        targetRepsLow: Math.max(1, high - 2),
        recoveryHours: Number.isFinite(rec) ? rec : 48,
      });
      toast('保存しました');
    } }),
  ));

  /* ---- 種目管理リンク ---- */
  container.append(el('div', {
    class: 'list-item',
    role: 'button', tabindex: '0',
    onClick: () => navigate('/exercises'),
  },
    icon('dumbbell'),
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title', text: '種目管理' }),
      el('div', { class: 'li-sub', text: '種目の追加・編集・METs値の調整' }),
    ),
    icon('chevronRight', 18),
  ));

  /* ---- データ管理(エクスポート/インポート) ---- */
  const lastExportAt = await getSetting('lastExportAt');
  const dataSection = sectionCard('データ管理(スマホ⇔PCの同期)',
    el('p', { class: 'caption mb-2', text: 'データはこの端末内にのみ保存されます。別の端末と同期するには、エクスポートしたファイルを相手の端末でインポートしてください。' }),
    el('div', { class: 'caption mb-2', text: lastExportAt
      ? `最終エクスポート: ${formatDateJa(lastExportAt.slice(0, 10), true)}`
      : '最終エクスポート: なし(バックアップ推奨)' }),
    el('div', { class: 'row' },
      el('button', { class: 'btn grow', onClick: doExport }, icon('download', 18), 'エクスポート'),
      el('button', { class: 'btn grow', onClick: doImport }, icon('upload', 18), 'インポート'),
    ),
  );
  container.append(dataSection);

  /* ---- ストレージ状態 ---- */
  const persisted = await isPersisted();
  const estimate = await storageEstimate();
  const usageText = estimate
    ? `使用量: ${fmtNum((estimate.usage || 0) / 1024 / 1024, 1)}MB`
    : '使用量: 不明';
  const storageCard = sectionCard('ストレージ保護',
    el('div', { class: 'row-between mb-2' },
      el('span', { text: '保護されたストレージ' }),
      el('span', { class: persisted ? 'text-accent' : 'text-warn', text: persisted ? '✓ 有効' : '✕ 未許可' }),
    ),
    el('div', { class: 'caption mb-2', text: usageText }),
    el('button', { class: 'btn mb-2', text: 'オフラインOCRを準備(約20MB)', onClick: async () => {
      if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
        toast('オフライン機能が未初期化です。ページを再読み込みしてください');
        return;
      }
      // 取得対象はSW側のホワイトリスト(OCR_FILES)で固定。ここではトリガーのみ送る。
      navigator.serviceWorker.controller.postMessage({ type: 'CACHE_OCR' });
      toast('バックグラウンドで取得を開始しました(Wi-Fi推奨)');
    } }),
    !persisted ? el('button', { class: 'btn', text: '保護を再リクエスト', onClick: async () => {
      const ok = await requestPersist();
      toast(ok ? '保護が有効になりました' : 'ブラウザに拒否されました(ホーム画面に追加すると有効になりやすくなります)');
      navigate('/settings');
    } }) : null,
    !isStandalone() ? el('p', { class: 'caption text-warn mt-2', text: isIOS()
      ? '⚠ iPhoneのブラウザのままだと、7日間使わないとデータが消えることがあります。Safariの共有 → 「ホーム画面に追加」を強く推奨します。'
      : 'ホーム画面に追加(インストール)するとデータがより安全に保護されます。' }) : null,
    el('p', { class: 'caption mt-2', text: '※ ブラウザの「閲覧データを削除」やアプリアイコンの削除でデータは消えます。定期的なエクスポートをおすすめします。' }),
  );
  container.append(storageCard);

  /* ---- 危険な操作 ---- */
  container.append(sectionCard('データの初期化',
    el('button', { class: 'btn btn-danger', text: '全データを削除', onClick: async () => {
      const sure = await confirmDialog(
        '全データを削除',
        'すべての記録・種目・設定を完全に削除します。元に戻せません。先にエクスポートすることを強くおすすめします。続行するには「削除」と入力してください。',
        { okLabel: '完全に削除', danger: true, requireText: '削除' },
      );
      if (!sure) return;
      await clearAllStores();
      await putSetting('deviceId', uuid()); // 初期化=deviceId再発行
      await seedIfNeeded();
      toast('初期化しました');
      navigate('/');
    } }),
  ));

  container.append(el('p', { class: 'caption text-center mt-4', text: 'トレ管 v1.0 — データは端末内にのみ保存されます' }));

  /* ============ エクスポート処理 ============ */
  async function doExport() {
    const payload = await buildExport();
    const json = JSON.stringify(payload);
    const fileName = exportFileName();
    const file = new File([json], fileName, { type: 'application/json' });

    // スマホ: Web Share API(ユーザージェスチャ内で同期的にファイル生成済み)
    let shared = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'トレーニング記録のバックアップ' });
        shared = true;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // ユーザーキャンセル
      }
    }
    if (!shared) {
      // フォールバック: ダウンロード
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: fileName });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    await putSetting('lastExportAt', new Date().toISOString());
    toast('エクスポートしました(ファイルは他人に渡らないよう注意)');
    navigate('/settings');
  }

  /* ============ インポート処理 ============ */
  function doImport() {
    const fileInput = el('input', { type: 'file', accept: '.json,application/json' });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (f.size > 50 * 1024 * 1024) { toast('ファイルが大きすぎます(50MB上限)'); return; }
      const text = await f.text();
      const parsed = parseImport(text);
      if (!parsed.ok) { toast('インポート失敗: ' + parsed.error); return; }

      // 適用前に現状データの自動バックアップを生成(失敗時のundo)
      const backup = JSON.stringify(await buildExport());
      try {
        sessionStorage.setItem('importUndo', backup);
      } catch { /* 容量超過時は諦める(続行はする) */ }

      const baseline = await getSetting('lastSyncAt'); // 前回同期時刻(競合判定用)
      const plan = await planMerge(parsed.data, baseline);
      showMergeSummary(plan, parsed.skipped);
    });
    fileInput.click();
  }

  function showMergeSummary(plan, skipped) {
    const total = plan.adds + plan.updates + plan.deletes;
    const conflictWrap = el('div', {});
    /** @type {{store: string, record: any}[]} */
    const resolved = [];

    // 競合: 1件ずつ「どちらを残すか」選択
    for (const c of plan.conflicts) {
      const choice = el('div', { class: 'card mb-2' },
        el('div', { class: 'li-title mb-2', text: `競合: ${describeRecord(c)}` }),
        el('div', { class: 'row' },
          el('button', { class: 'btn grow', text: `この端末の値`, onClick: (e) => pick(e, c, c.local) }),
          el('button', { class: 'btn grow', text: `ファイルの値`, onClick: (e) => pick(e, c, c.incoming) }),
        ),
        el('div', { class: 'caption mt-2', text: `端末: ${c.local.updatedAt} / ファイル: ${c.incoming.updatedAt}` }),
      );
      conflictWrap.append(choice);
    }

    function pick(e, conflict, record) {
      const idx = resolved.findIndex((r) => r.record === conflict.local || r.record === conflict.incoming);
      if (idx >= 0) resolved.splice(idx, 1);
      if (record !== conflict.local) resolved.push({ store: conflict.store, record });
      const card = e.target.closest('.card');
      card.querySelectorAll('.btn').forEach((b) => b.classList.remove('btn-primary'));
      e.target.classList.add('btn-primary');
      card.dataset.resolved = '1';
      updateApplyState();
    }

    const applyBtn = el('button', { class: 'btn btn-primary btn-cta mt-2', text: '適用する', onClick: async () => {
      await applyMerge(plan, resolved);
      await putSetting('lastSyncAt', new Date().toISOString());
      close();
      toast(`取り込みました(追加${plan.adds} / 更新${plan.updates} / 削除${plan.deletes})。読み込んだファイルは削除を推奨します`);
      navigate('/settings');
    } });

    function updateApplyState() {
      const unresolvedLeft = plan.conflicts.length -
        conflictWrap.querySelectorAll('.card[data-resolved]').length;
      if (unresolvedLeft > 0) applyBtn.setAttribute('disabled', '');
      else applyBtn.removeAttribute('disabled');
    }

    const close = openModal(el('div', {},
      el('h2', { text: 'インポート内容の確認' }),
      el('div', { class: 'card mb-2' },
        el('div', { class: 'row-between' }, el('span', { text: '追加' }), el('span', { class: 'num', text: String(plan.adds) })),
        el('div', { class: 'row-between' }, el('span', { text: '更新' }), el('span', { class: 'num', text: String(plan.updates) })),
        el('div', { class: 'row-between' }, el('span', { text: '削除の反映' }), el('span', { class: 'num', text: String(plan.deletes) })),
        plan.conflicts.length > 0
          ? el('div', { class: 'row-between text-warn' }, el('span', { text: '競合(要選択)' }), el('span', { class: 'num', text: String(plan.conflicts.length) }))
          : null,
        skipped > 0
          ? el('div', { class: 'row-between text-sub' }, el('span', { text: '不正データのスキップ' }), el('span', { class: 'num', text: String(skipped) }))
          : null,
      ),
      total === 0 && plan.conflicts.length === 0
        ? el('p', { class: 'caption', text: '取り込む差分はありません(すでに同期済みです)。' })
        : null,
      conflictWrap,
      applyBtn,
    ));
    updateApplyState();
  }

  function describeRecord(c) {
    const r = c.incoming;
    if (c.store === 'body') return `${r.date} の体組成`;
    if (c.store === 'workouts') return `${r.date} の筋トレ記録`;
    if (c.store === 'cardio') return `${r.date} の有酸素記録`;
    if (c.store === 'exercises') return `種目「${r.name}」`;
    if (c.store === 'settings') return `設定「${r.key}」`;
    return c.store;
  }
}

function sectionCard(title, ...children) {
  return el('div', { class: 'card mb-4' },
    el('div', { class: 'section-title', text: title }),
    ...children.filter(Boolean),
  );
}
