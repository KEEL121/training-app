// @ts-check
// ocr.js — 画像前処理 + Tesseract呼び出し + 数値パース
// 方針: 「OCRは下書き、確定は人間」。
// - 7セグ特化traineddata(ssd)を優先し、ダメなら eng にフォールバック
// - whitelistはLSTMで効かないことがあるため信用せず、正規表現後処理を必須とする
// - 実行後は worker.terminate() でメモリ解放(iOS WebKitのメモリキル対策)

// blobワーカー内のimportScriptsは相対URLを解決できないため絶対URLにする
// (GitHub Pagesのサブパス配信でも document.baseURI 基準で正しく解決される)
const VENDOR = new URL('vendor/tesseract', document.baseURI).href;

let tesseractLoaded = null;

/** vendorのtesseract.min.jsを遅延ロード */
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (tesseractLoaded) return tesseractLoaded;
  tesseractLoaded = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${VENDOR}/tesseract.min.js`;
    s.onload = () => resolve(undefined);
    s.onerror = () => reject(new Error('tesseract load failed'));
    document.head.append(s);
  });
  return tesseractLoaded;
}

/** WebAssembly SIMD対応判定(対応コアを選ぶ) */
async function hasSIMD() {
  try {
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3,
      2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]));
  } catch { return false; }
}

/**
 * 前処理: リサイズ(長辺800px)→グレースケール→暗背景なら反転→二値化
 * 7セグ液晶(暗地に明るい数字)を白地黒文字に正規化する
 * @param {HTMLCanvasElement|HTMLImageElement} source
 * @param {{x:number,y:number,w:number,h:number}|null} crop ソース座標系の切り抜き範囲
 * @returns {HTMLCanvasElement}
 */
export function preprocess(source, crop) {
  const sw = crop ? crop.w : (source.width || source.naturalWidth);
  const sh = crop ? crop.h : (source.height || source.naturalHeight);
  const scale = Math.min(1, 800 / Math.max(sw, sh)) * (Math.max(sw, sh) < 400 ? 2 : 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, crop ? crop.x : 0, crop ? crop.y : 0, sw, sh, 0, 0, canvas.width, canvas.height);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const n = d.length / 4;

  // グレースケール+平均輝度
  let sum = 0;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const g = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
    gray[i] = g;
    sum += g;
  }
  const mean = sum / n;
  const invert = mean < 110; // 暗背景(液晶)なら反転して白地黒文字へ

  // 大津法による二値化しきい値
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[invert ? 255 - gray[i] : gray[i]]++;
  const threshold = otsu(hist, n);

  for (let i = 0; i < n; i++) {
    const g = invert ? 255 - gray[i] : gray[i];
    const v = g > threshold ? 255 : 0;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function otsu(hist, total) {
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0, wB = 0, maxVar = 0, best = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; best = t; }
  }
  return best;
}

/**
 * OCR実行。lang='ssd'(7セグ特化)→失敗/空なら'eng'に自動フォールバック
 * @param {HTMLCanvasElement} canvas 前処理済み画像
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<string>} 認識テキスト
 */
export async function recognizeDigits(canvas, onProgress = () => {}) {
  await loadTesseract();
  const simd = await hasSIMD();
  const corePath = `${VENDOR}/tesseract-core-${simd ? 'simd-' : ''}lstm.wasm.js`;

  async function run(lang) {
    onProgress(lang === 'ssd' ? '7セグ用データで読み取り中…' : '汎用データで読み取り中…');
    const worker = await window.Tesseract.createWorker(lang, 1, {
      workerPath: `${VENDOR}/worker.min.js`,
      corePath,
      langPath: VENDOR,
      gzip: true,
    });
    try {
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789.', // 効けば儲けもの(LSTMでは不安定)
        tessedit_pageseg_mode: '7',             // 1行テキスト
      });
      const { data } = await worker.recognize(canvas);
      return data.text || '';
    } finally {
      await worker.terminate(); // メモリ解放必須
    }
  }

  let text = '';
  try {
    text = await run('ssd');
  } catch { text = ''; }
  if (!extractNumbers(text).length) {
    try {
      text = await run('eng');
    } catch (e) {
      if (!text) throw e;
    }
  }
  return text;
}

/** テキストから数値候補を抽出(whitelist非依存の後処理) */
export function extractNumbers(text) {
  const cleaned = (text || '')
    .replace(/[oOQ]/g, '0').replace(/[lI|]/g, '1').replace(/[B]/g, '8')
    .replace(/[Ss]/g, '5').replace(/[zZ]/g, '2').replace(/[,]/g, '.');
  const matches = cleaned.match(/\d+\.?\d*/g) || [];
  return matches.map(parseFloat).filter((v) => Number.isFinite(v) && v > 0);
}

/**
 * 数値候補を体重/体脂肪率に割り当てる。
 * 小数点欠落(例 "684" → 68.4)の補正候補も生成する。
 * @returns {{weight: number[], fat: number[]}} それぞれ確度順の候補
 */
export function assignCandidates(values) {
  const weight = [];
  const fat = [];
  const push = (arr, v) => {
    const r = Math.round(v * 10) / 10;
    if (!arr.includes(r)) arr.push(r);
  };
  for (const v of values) {
    if (v >= 20 && v <= 200 && !Number.isInteger(v)) push(weight, v); // 小数付きは最有力
  }
  for (const v of values) {
    if (v >= 20 && v <= 200 && Number.isInteger(v)) push(weight, v);
    // 小数点欠落の補正: 3〜4桁の整数は1/10した値を体重候補に
    if (Number.isInteger(v) && v >= 200 && v <= 3000 && v / 10 >= 20 && v / 10 <= 200) {
      push(weight, v / 10);
    }
  }
  for (const v of values) {
    if (v >= 3 && v <= 60 && !weight.includes(Math.round(v * 10) / 10)) push(fat, v);
    if (Number.isInteger(v) && v >= 60 && v <= 600 && v / 10 >= 3 && v / 10 <= 60) push(fat, v / 10);
  }
  return { weight: weight.slice(0, 4), fat: fat.slice(0, 4) };
}
