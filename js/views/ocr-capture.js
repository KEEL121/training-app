// @ts-check
// ocr-capture.js — 写真からの体重・体脂肪率読み取り
// フロー: 撮影/選択 → 切り抜き(ガイド枠デフォルト+ドラッグ調整) → 前処理 →
//         Tesseract(ssd→eng) → 候補タップで割り当て → 体組成画面へ
// 保存ボタンはこの画面に置かない(確認は体組成画面で必ず通過)

import { el, clear } from '../util.js';
import { preprocess, recognizeDigits, extractNumbers, assignCandidates } from '../logic/ocr.js';
import { toast } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { navigate } from '../router.js';

export async function render(container) {
  container.append(
    el('div', { class: 'view-header' },
      el('button', { class: 'back-btn', 'aria-label': '戻る', onClick: () => navigate('/body') }, icon('chevronLeft')),
      el('h1', { text: '写真から読み取り' }),
    ),
  );

  const stage = el('div', {});
  container.append(stage);
  renderPickStep();

  /* ---- STEP 1: 撮影/選択(iOSでライブラリ選択を潰さないよう2ボタン) ---- */
  function renderPickStep() {
    clear(stage);
    const cameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden' });
    const libraryInput = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden' });
    const onFile = (input) => async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        const img = await loadImage(f);
        renderCropStep(img);
      } catch {
        toast('画像を読み込めませんでした');
      }
    };
    cameraInput.addEventListener('change', onFile(cameraInput));
    libraryInput.addEventListener('change', onFile(libraryInput));

    stage.append(
      el('p', { class: 'text-sub mb-4', text: '体重計の数字の部分を大きく撮影すると読み取り精度が上がります。読み取り結果は次の画面で必ず確認・修正できます。' }),
      el('button', { class: 'btn btn-primary btn-cta mb-2', onClick: () => cameraInput.click() },
        icon('camera', 20), 'カメラで撮影'),
      el('button', { class: 'btn btn-cta', onClick: () => libraryInput.click() },
        icon('image', 20), '写真から選択'),
      el('p', { class: 'caption mt-4', text: '※ 画像は端末内で処理され、外部には送信されません。初回は読み取りエンジンの準備に数秒かかります。' }),
      cameraInput, libraryInput,
    );
  }

  /* ---- STEP 2: 切り抜き(ガイド枠) ---- */
  function renderCropStep(img) {
    clear(stage);
    const canvas = el('canvas', { styles: { width: '100%', borderRadius: '14px', border: '1px solid var(--border)', touchAction: 'none' } });
    const maxW = 1200;
    const scale = Math.min(1, maxW / img.naturalWidth);
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');

    // ガイド枠の初期値: 中央 70%×35%(数字表示部を想定)
    let rect = {
      x: canvas.width * 0.15, y: canvas.height * 0.32,
      w: canvas.width * 0.7, h: canvas.height * 0.36,
    };

    function draw() {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, canvas.width, rect.y);
      ctx.fillRect(0, rect.y + rect.h, canvas.width, canvas.height - rect.y - rect.h);
      ctx.fillRect(0, rect.y, rect.x, rect.h);
      ctx.fillRect(rect.x + rect.w, rect.y, canvas.width - rect.x - rect.w, rect.h);
      ctx.strokeStyle = '#C8FF3D';
      ctx.lineWidth = 3;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
    draw();

    // ドラッグで枠を描き直し(シンプルで確実な操作系)
    let dragStart = null;
    const toCanvasXY = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (canvas.width / r.width),
        y: (e.clientY - r.top) * (canvas.height / r.height),
      };
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      dragStart = toCanvasXY(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragStart) return;
      const cur = toCanvasXY(e);
      rect = {
        x: Math.max(0, Math.min(dragStart.x, cur.x)),
        y: Math.max(0, Math.min(dragStart.y, cur.y)),
        w: Math.abs(cur.x - dragStart.x),
        h: Math.abs(cur.y - dragStart.y),
      };
      draw();
    });
    canvas.addEventListener('pointerup', () => {
      dragStart = null;
      if (rect.w < 20 || rect.h < 20) {
        rect = { x: canvas.width * 0.15, y: canvas.height * 0.32, w: canvas.width * 0.7, h: canvas.height * 0.36 };
        draw();
      }
    });

    stage.append(
      el('p', { class: 'text-sub mb-2', text: '数字の部分だけが枠に入るように、指でなぞって枠を描き直してください。' }),
      canvas,
      el('div', { class: 'row mt-4' },
        el('button', { class: 'btn grow', text: '撮り直す', onClick: renderPickStep }),
        el('button', { class: 'btn btn-primary grow', text: '読み取る', onClick: () => runOcr(canvas, rect) }),
      ),
    );
  }

  /* ---- STEP 3: OCR実行 ---- */
  async function runOcr(sourceCanvas, rect) {
    clear(stage);
    const status = el('p', { class: 'text-sub text-center mt-4', text: '読み取りエンジンを準備中…(初回は数秒かかります)' });
    stage.append(
      el('div', { class: 'empty-state' },
        el('div', { class: 'empty-emoji', text: '🔍' }),
        status,
      ),
    );
    try {
      const pre = preprocess(sourceCanvas, rect);
      const text = await recognizeDigits(pre, (msg) => { status.textContent = msg; });
      const values = extractNumbers(text);
      const candidates = assignCandidates(values);
      renderResultStep(pre, candidates, text);
    } catch (e) {
      clear(stage);
      stage.append(
        el('div', { class: 'empty-state' },
          el('div', { class: 'empty-emoji', text: '😢' }),
          el('p', { text: '読み取りに失敗しました。' }),
          el('div', { class: 'row mt-4' },
            el('button', { class: 'btn grow', text: 'もう一度', onClick: renderPickStep }),
            el('button', { class: 'btn btn-primary grow', text: '手動で入力', onClick: () => navigate('/body') }),
          ),
        ),
      );
    }
  }

  /* ---- STEP 4: 候補の割り当て(タップ1回で修正) ---- */
  function renderResultStep(preCanvas, candidates, rawText) {
    clear(stage);
    let weightVal = candidates.weight[0] ?? null;
    let fatVal = candidates.fat[0] ?? null;

    const thumb = el('div', { class: 'card mb-4' });
    preCanvas.style.width = '100%';
    preCanvas.style.borderRadius = '8px';
    thumb.append(el('div', { class: 'section-title', text: '読み取った画像' }), preCanvas);

    const weightRow = candidateRow('体重(kg)', candidates.weight, weightVal, (v) => { weightVal = v; });
    const fatRow = candidateRow('体脂肪率(%)', candidates.fat, fatVal, (v) => { fatVal = v; });

    const noResult = candidates.weight.length === 0 && candidates.fat.length === 0;

    stage.append(
      thumb,
      noResult
        ? el('div', { class: 'banner banner-warn' },
            el('span', { text: `数値を検出できませんでした(認識結果: ${(rawText || '').trim().slice(0, 40) || 'なし'})。枠を数字だけに絞ると精度が上がります。` }))
        : el('p', { class: 'text-sub mb-2', text: '候補をタップして選んでください(次の画面でも修正できます)。' }),
      weightRow, fatRow,
      el('div', { class: 'row mt-4' },
        el('button', { class: 'btn grow', text: 'やり直す', onClick: renderPickStep }),
        el('button', { class: 'btn btn-primary grow', text: 'この値で入力画面へ', onClick: () => {
          sessionStorage.setItem('ocrResult', JSON.stringify({ weightKg: weightVal, bodyFatPct: fatVal }));
          navigate('/body');
        } }),
      ),
    );

    function candidateRow(label, list, initial, onPick) {
      const chips = el('div', { class: 'chip-row mt-2' });
      const row = el('div', { class: 'card mb-2' },
        el('div', { class: 'section-title', text: label }),
        list.length === 0 ? el('p', { class: 'caption', text: '候補なし(入力画面で手動入力)' }) : chips,
      );
      list.forEach((v, i) => {
        const chip = el('button', {
          class: 'chip' + (i === 0 ? ' active' : ''),
          text: String(v),
          onClick: () => {
            chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
            chip.classList.add('active');
            onPick(v);
          },
        });
        chips.append(chip);
      });
      // 「使わない」選択肢
      if (list.length > 0) {
        const noneChip = el('button', {
          class: 'chip', text: '使わない',
          onClick: () => {
            chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
            noneChip.classList.add('active');
            onPick(null);
          },
        });
        chips.append(noneChip);
      }
      return row;
    }
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}
