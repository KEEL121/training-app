// @ts-check
// components.js — トースト・モーダル・確認ダイアログ・選択シート

import { el, clear } from '../util.js';
import { icon } from './icons.js';

/**
 * トースト表示
 * @param {string} msg
 * @param {{actionLabel?: string, onAction?: () => void, duration?: number}} [opts]
 */
export function toast(msg, opts = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const duration = opts.duration ?? (opts.actionLabel ? 5000 : 2500);
  const node = el('div', { class: 'toast', role: 'status' },
    el('span', { class: 'toast-msg', text: msg }),
    opts.actionLabel
      ? el('button', {
          class: 'toast-action',
          text: opts.actionLabel,
          onClick: () => { node.remove(); opts.onAction && opts.onAction(); },
        })
      : null,
  );
  root.append(node);
  setTimeout(() => node.remove(), duration);
}

/**
 * モーダル/シートを開く。閉じる関数を返す。
 * @param {HTMLElement} content
 * @param {{center?: boolean, onClose?: () => void}} [opts]
 */
export function openModal(content, opts = {}) {
  const root = document.getElementById('modal-root');
  if (!root) return () => {};
  clear(root);
  const backdrop = el('div', { class: 'modal-backdrop' + (opts.center ? ' center' : '') });
  const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content);
  backdrop.append(modal);
  root.append(backdrop);

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    opts.onClose && opts.onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  // 簡易フォーカストラップ: 最初のフォーカス可能要素へ
  const focusable = modal.querySelector('button, input, select, textarea, a[href]');
  if (focusable instanceof HTMLElement) focusable.focus();
  return close;
}

/**
 * 確認ダイアログ(Promise<boolean>)
 * @param {string} title
 * @param {string} message
 * @param {{okLabel?: string, danger?: boolean, requireText?: string}} [opts]
 *   requireText: この文字列の入力を必須にする(全データ削除などの二段階確認)
 */
export function confirmDialog(title, message, opts = {}) {
  return new Promise((resolve) => {
    let inputEl = null;
    const okBtn = el('button', {
      class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'),
      text: opts.okLabel || 'OK',
      onClick: () => { close(); resolve(true); },
    });
    if (opts.requireText) {
      okBtn.setAttribute('disabled', '');
      inputEl = el('input', {
        type: 'text',
        placeholder: `「${opts.requireText}」と入力`,
        autocomplete: 'off',
        onInput: () => {
          if (inputEl.value === opts.requireText) okBtn.removeAttribute('disabled');
          else okBtn.setAttribute('disabled', '');
        },
      });
    }
    const content = el('div', {},
      el('h2', { text: title }),
      el('p', { class: 'text-sub mb-4', text: message }),
      inputEl ? el('div', { class: 'field' }, inputEl) : null,
      el('div', { class: 'row', styles: { justifyContent: 'flex-end' } },
        el('button', { class: 'btn btn-ghost', text: 'キャンセル', onClick: () => { close(); resolve(false); } }),
        okBtn,
      ),
    );
    const close = openModal(content, { center: true, onClose: () => resolve(false) });
  });
}

/**
 * 選択シート(FABの記録メニューなど)
 * @param {string} title
 * @param {{label: string, sub?: string, iconName?: string, onSelect: () => void}[]} items
 */
export function openSheet(title, items) {
  const list = items.map((item) =>
    el('div', {
      class: 'list-item',
      role: 'button',
      tabindex: '0',
      onClick: () => { close(); item.onSelect(); },
      onKeydown: (e) => { if (e.key === 'Enter') { close(); item.onSelect(); } },
    },
      item.iconName ? icon(item.iconName) : null,
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title', text: item.label }),
        item.sub ? el('div', { class: 'li-sub', text: item.sub }) : null,
      ),
      icon('chevronRight', 18),
    ),
  );
  const close = openModal(el('div', {},
    el('h2', { text: title }),
    ...list,
  ));
  return close;
}

/** 「…」メニュー(編集/削除など小アクション) */
export function openActionMenu(actions) {
  const list = actions.map((a) =>
    el('div', {
      class: 'list-item',
      role: 'button',
      tabindex: '0',
      onClick: () => { close(); a.onSelect(); },
    },
      a.iconName ? icon(a.iconName) : null,
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' + (a.danger ? ' text-danger' : ''), text: a.label }),
      ),
    ),
  );
  const close = openModal(el('div', {}, ...list));
  return close;
}
