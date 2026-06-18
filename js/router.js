// @ts-check
// router.js — ハッシュルータ(#/path/:param 形式)
// GitHub Pagesのサブパス配信でも404設定不要にするためハッシュ方式を採用

import { clear } from './util.js';

/**
 * @typedef {Object} Route
 * @property {string} pattern 例 '/workout/:id'
 * @property {(container: HTMLElement, params: Object<string,string>) => void|Promise<void>} render
 * @property {boolean} [fullscreen] 記録フロー中はタブバー/FABを隠す
 * @property {string} [nav] アクティブにするナビ(data-nav値)
 */

/** @type {Route[]} */
let routes = [];
let container = null;
let currentCleanup = null;

export function defineRoutes(routeList, viewContainer) {
  routes = routeList;
  container = viewContainer;
  window.addEventListener('hashchange', handleRoute);
}

export function navigate(path) {
  if (location.hash === '#' + path) {
    handleRoute(); // 同一ハッシュへの再遷移でも再描画
  } else {
    location.hash = path;
  }
}

/** 現在のビューが離脱時に呼ぶクリーンアップを登録(タイマー・WakeLock解放用) */
export function onLeave(fn) {
  currentCleanup = fn;
}

function matchRoute(path) {
  for (const route of routes) {
    const pp = route.pattern.split('/').filter(Boolean);
    const cp = path.split('/').filter(Boolean);
    if (pp.length !== cp.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(cp[i]);
      else if (pp[i] !== cp[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

export async function handleRoute() {
  if (!container) return;
  const path = (location.hash.slice(1) || '/');
  const matched = matchRoute(path) || matchRoute('/');
  if (!matched) return;

  if (currentCleanup) {
    try { currentCleanup(); } catch { /* noop */ }
    currentCleanup = null;
  }

  const { route, params } = matched;
  document.body.classList.toggle('fullscreen', !!route.fullscreen);

  // ナビのアクティブ表示
  document.querySelectorAll('#mainnav .nav-links a').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === route.nav);
  });
  const fab = document.getElementById('fab');
  if (fab) fab.hidden = !!route.fullscreen;

  clear(container);
  container.scrollTop = 0;
  window.scrollTo(0, 0);
  await route.render(container, params);
  container.focus({ preventScroll: true });
}
