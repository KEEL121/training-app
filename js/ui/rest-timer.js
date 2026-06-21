// @ts-check
// rest-timer.js — セット間レストタイマー
// - セット完了と同時に自動開始(呼び出し側から start())
// - endTime方式: バックグラウンド復帰でも残り時間が正確
// - sessionStorageに保持し、画面再描画でも継続
// - 終了時: バイブ+短いビープ音(WebAudio)

import { el, vibrate } from '../util.js';

const KEY = 'restTimerEnd';
let intervalId = null;
let barEl = null;

/** タイマー開始(秒) */
export function startRestTimer(sec) {
  const end = Date.now() + sec * 1000;
  sessionStorage.setItem(KEY, String(end));
  ensureBar();
  tick();
}

/** 画面描画時に呼ぶ: 進行中タイマーがあればバーを復元 */
export function resumeRestTimerIfActive() {
  const end = Number(sessionStorage.getItem(KEY) || 0);
  if (end > Date.now()) {
    ensureBar();
    tick();
  }
}

/** 画面離脱時に呼ぶ(タイマー自体は継続、バーだけ消す) */
export function detachRestTimerBar() {
  clearInterval(intervalId);
  intervalId = null;
  if (barEl) { barEl.remove(); barEl = null; }
}

export function stopRestTimer() {
  sessionStorage.removeItem(KEY);
  detachRestTimerBar();
}

function adjust(deltaSec) {
  const end = Number(sessionStorage.getItem(KEY) || 0);
  if (!end) return;
  const next = Math.max(Date.now() + 1000, end + deltaSec * 1000);
  sessionStorage.setItem(KEY, String(next));
  tick();
}

function ensureBar() {
  if (barEl) return;
  const timeEl = el('span', { class: 'rt-time num', text: '--:--' });
  barEl = el('div', { class: 'rest-timer-bar', role: 'timer', 'aria-label': 'レストタイマー' },
    el('span', { text: '⏱' }),
    timeEl,
    el('button', { type: 'button', text: '−15s', onClick: () => adjust(-15) }),
    el('button', { type: 'button', text: '+15s', onClick: () => adjust(15) }),
    el('button', { type: 'button', text: '✕', 'aria-label': 'タイマーを止める', onClick: stopRestTimer }),
  );
  barEl._timeEl = timeEl;
  document.body.append(barEl);
  clearInterval(intervalId);
  intervalId = setInterval(tick, 250);
}

function tick() {
  const end = Number(sessionStorage.getItem(KEY) || 0);
  if (!barEl) return;
  const remain = Math.ceil((end - Date.now()) / 1000);
  if (remain <= 0) {
    finish();
    return;
  }
  const m = Math.floor(remain / 60);
  const s = remain % 60;
  barEl._timeEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
}

function finish() {
  stopRestTimer();
  vibrate([150, 80, 150]);
  beep();
}

/**
 * ビープ音(WebAudio、外部ファイル不要でCSP適合)。
 * @param {number[]} [freqs] 鳴らす周波数列(0.35秒間隔)。既定は2音
 */
export function beep(freqs = [880, 1100]) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const play = (t, freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.3);
    };
    freqs.forEach((f, i) => play(i * 0.35, f));
    setTimeout(() => ctx.close(), 400 + freqs.length * 350);
  } catch { /* 音は失敗しても致命的でない */ }
}
