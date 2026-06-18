// @ts-check
// util.js — DOM構築・日付ヘルパ
// 規約: ユーザー由来データはtextContent/valueでのみ差し込む。
//       el()のchildren文字列はテキストノード化されるため安全。

/**
 * DOM要素ビルダー(innerHTML不使用でユーザーデータを安全に扱う)
 * @param {string} tag
 * @param {Object<string, any>} [props] class/dataset/onXxx/attrs
 * @param {...(Node|string|null|undefined|false)} children
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'styles') Object.assign(node.style, v); // CSP対応: style属性でなくCSSOM経由
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'text') node.textContent = String(v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** コンテナを空にする */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** UUID(secure context外フォールバック付き — LAN実機検証でも動作) */
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const nowISO = () => new Date().toISOString();

/**
 * 今日の日付(YYYY-MM-DD、端末ローカル)。
 * cutoffHour時(既定3時)より前は前日扱い — 深夜トレーニングの日付帰属対策。
 */
export function todayStr(cutoffHour = 3) {
  const d = new Date(Date.now() - cutoffHour * 3600 * 1000);
  return localDateStr(d);
}

/** DateオブジェクトをローカルのYYYY-MM-DDに */
export function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "2026-06-13" → "6月13日(土)" */
export function formatDateJa(dateStr, withYear = false) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const wd = ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()];
  return `${withYear ? y + '年' : ''}${m}月${d}日(${wd})`;
}

/** YYYY-MM-DD同士の日数差(a - b) */
export function daysBetween(a, b) {
  return Math.round((parseLocal(a) - parseLocal(b)) / 86400000);
}

/** YYYY-MM-DDをローカルDateに(タイムゾーンずれ防止) */
export function parseLocal(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** その日付が属する週の月曜日(YYYY-MM-DD)— 週次集計は月曜開始 */
export function weekStart(dateStr) {
  const t = new Date(parseLocal(dateStr));
  const dow = (t.getDay() + 6) % 7; // 月=0
  t.setDate(t.getDate() - dow);
  return localDateStr(t);
}

/** 数値を見やすく(1234.5 → "1,234.5") */
export function fmtNum(n, digits = 0) {
  return Number(n).toLocaleString('ja-JP', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/** バイブレーション(対応端末のみ・失敗無視) */
export function vibrate(ms = 10) {
  try { navigator.vibrate && navigator.vibrate(ms); } catch { /* noop */ }
}

/** iOS判定 */
export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** PWA(standalone)起動か */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    // @ts-ignore iOS Safari独自
    window.navigator.standalone === true;
}
