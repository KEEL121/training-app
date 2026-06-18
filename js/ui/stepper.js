// @ts-check
// stepper.js — 重量/回数のタッチ最優先入力部品
// 56pxの+/−ボタン、長押し連続加算、数値直接入力(inputmode)、矢印キー対応

import { el, vibrate } from '../util.js';

/**
 * @param {Object} opts
 * @param {number|null} opts.value 初期値
 * @param {number} opts.step 増減幅(重量=種目increment、回数=1)
 * @param {string} opts.unit 'kg' | '回' | '分' | 'km'
 * @param {number} [opts.min]
 * @param {number} [opts.max]
 * @param {boolean} [opts.decimal] 小数入力可か
 * @param {(v: number|null) => void} [opts.onChange]
 * @returns {{root: HTMLElement, get: () => number|null, set: (v: number|null) => void}}
 */
export function createStepper(opts) {
  const min = opts.min ?? 0;
  const max = opts.max ?? 9999;
  const decimal = opts.decimal ?? false;

  const input = el('input', {
    type: 'text',
    inputmode: decimal ? 'decimal' : 'numeric',
    autocomplete: 'off',
    'aria-label': `数値入力(${opts.unit})`,
  });
  setVal(opts.value);

  function getVal() {
    const v = parseFloat(input.value.replace(/[^\d.]/g, ''));
    return Number.isFinite(v) ? v : null;
  }
  function setVal(v) {
    input.value = v == null ? '' : String(roundNice(v));
  }
  function roundNice(v) {
    return Math.round(v * 100) / 100;
  }
  function nudge(dir) {
    const cur = getVal() ?? 0;
    let next = cur + dir * opts.step;
    next = Math.min(Math.max(next, min), max);
    setVal(next);
    vibrate(5);
    pop(input);
    opts.onChange && opts.onChange(getVal());
  }
  function pop(node) {
    node.style.transform = 'scale(1.08)';
    setTimeout(() => { node.style.transform = ''; }, 80);
  }

  /** 長押し連続加算ボタン */
  function holdButton(label, dir) {
    let timer = null, repeat = null;
    const start = (e) => {
      e.preventDefault();
      nudge(dir);
      timer = setTimeout(() => {
        repeat = setInterval(() => nudge(dir), 120);
      }, 450);
    };
    const stop = () => {
      clearTimeout(timer);
      clearInterval(repeat);
      timer = repeat = null;
    };
    const btn = el('button', {
      type: 'button',
      text: label,
      'aria-label': (dir > 0 ? '増やす' : '減らす'),
      onContextmenu: (e) => e.preventDefault(), // 長押しメニュー抑止
    });
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
    return btn;
  }

  input.addEventListener('change', () => {
    const v = getVal();
    if (v != null) setVal(Math.min(Math.max(v, min), max));
    opts.onChange && opts.onChange(getVal());
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); nudge(1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1); }
  });
  input.addEventListener('focus', () => input.select());

  const root = el('div', { class: 'stepper' },
    holdButton('−', -1),
    input,
    holdButton('+', 1),
    el('span', { class: 'stepper-unit', text: opts.unit }),
  );

  return { root, get: getVal, set: setVal };
}
