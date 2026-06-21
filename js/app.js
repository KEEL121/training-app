// @ts-check
// app.js — エントリポイント(DB初期化 → シード → ルータ起動 → SW登録)

import { defineRoutes, handleRoute, navigate } from './router.js';
import { openDB, getSetting } from './db.js';
import { seedIfNeeded } from './seed.js';
import { hydrateStaticIcons } from './ui/icons.js';
import { openSheet, toast } from './ui/components.js';

import * as home from './views/home.js';
import * as workout from './views/workout.js';
import * as cardio from './views/cardio.js';
import * as body from './views/body.js';
import * as history from './views/history.js';
import * as charts from './views/charts.js';
import * as suggestView from './views/suggest.js';
import * as exercises from './views/exercises.js';
import * as settings from './views/settings.js';
import * as onboarding from './views/onboarding.js';
import * as ocrCapture from './views/ocr-capture.js';
import * as circuit from './views/circuit.js';

async function main() {
  hydrateStaticIcons();
  await openDB();
  await seedIfNeeded();

  const view = document.getElementById('view');
  defineRoutes([
    { pattern: '/', render: home.render, nav: 'home' },
    { pattern: '/workout', render: workout.renderPicker, fullscreen: true },
    { pattern: '/workout/:exerciseId', render: workout.renderSession, fullscreen: true },
    { pattern: '/workout-rec/:recordId', render: workout.renderSession, fullscreen: true },
    { pattern: '/circuit', render: circuit.render, fullscreen: true },
    { pattern: '/cardio', render: cardio.render, fullscreen: true },
    { pattern: '/cardio/:id', render: cardio.render, fullscreen: true },
    { pattern: '/body', render: body.render, fullscreen: true },
    { pattern: '/body/:date', render: body.render, fullscreen: true },
    { pattern: '/ocr', render: ocrCapture.render, fullscreen: true },
    { pattern: '/history', render: history.render, nav: 'history' },
    { pattern: '/charts', render: charts.render, nav: 'charts' },
    { pattern: '/suggest', render: suggestView.render, nav: 'home' },
    { pattern: '/exercises', render: exercises.render, nav: 'settings' },
    { pattern: '/settings', render: settings.render, nav: 'settings' },
    { pattern: '/onboarding', render: onboarding.render, fullscreen: true },
  ], view);

  // FAB: 記録メニュー
  const fab = document.getElementById('fab');
  fab.hidden = false;
  fab.addEventListener('click', () => {
    openSheet('記録する', [
      { label: '筋トレ', sub: '種目×重量×回数×セット', iconName: 'dumbbell', onSelect: () => navigate('/workout') },
      { label: '有酸素運動', sub: '時間・距離', iconName: 'run', onSelect: () => navigate('/cardio') },
      { label: '体組成', sub: '体重・体脂肪率(写真読み取り対応)', iconName: 'scale', onSelect: () => navigate('/body') },
    ]);
  });

  // 初回はオンボーディングへ
  const onboarded = await getSetting('onboarded');
  if (!onboarded && (location.hash === '' || location.hash === '#/')) {
    location.hash = '#/onboarding';
  }

  await handleRoute();
  registerSW();
}

/* ---- Service Worker登録+更新トースト ---- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // 更新検出 → トーストで案内
    function promptUpdate(worker) {
      toast('新しいバージョンがあります', {
        actionLabel: '更新',
        duration: 10000,
        onAction: () => worker.postMessage({ type: 'SKIP_WAITING' }),
      });
    }
    if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          promptUpdate(worker);
        }
      });
    });
    // controllerchangeでのリロードは1回ガード(多重リロードループ防止)
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  }).catch(() => { /* SW登録失敗はアプリ動作に影響しない */ });
}

main();
