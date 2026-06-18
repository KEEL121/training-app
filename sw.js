// sw.js — Service Worker
// キャッシュ2分割:
//   APP_SHELL (リリースごとにバージョン更新 → 数百KBの再取得で済む)
//   OCR_CACHE (Tesseract資材 約20MB。installでは取得せず、初回利用時にオンデマンドでキャッシュ)
// fetch: 既知URLのみcache-first。動的キャッシュはOCR資材のプレフィックスに限定。
//
// ★リリース手順: ファイルを変更したら必ず SHELL_VERSION を上げること(README参照)

const SHELL_VERSION = 'v2';
const SHELL_CACHE = `app-shell-${SHELL_VERSION}`;
const OCR_CACHE = 'ocr-v1';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/layout.css',
  './js/app.js',
  './js/router.js',
  './js/db.js',
  './js/seed.js',
  './js/util.js',
  './js/data/default-exercises.js',
  './js/logic/calories.js',
  './js/logic/stats.js',
  './js/logic/suggestion.js',
  './js/logic/sync.js',
  './js/logic/ocr.js',
  './js/ui/components.js',
  './js/ui/icons.js',
  './js/ui/stepper.js',
  './js/ui/rest-timer.js',
  './js/views/home.js',
  './js/views/workout.js',
  './js/views/cardio.js',
  './js/views/body.js',
  './js/views/ocr-capture.js',
  './js/views/history.js',
  './js/views/charts.js',
  './js/views/suggest.js',
  './js/views/exercises.js',
  './js/views/settings.js',
  './js/views/onboarding.js',
  './vendor/chart.umd.min.js',
  './vendor/chartjs-adapter-date-fns.bundle.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// OCR資材(オンデマンドキャッシュの対象プレフィックス)
const OCR_PREFIX = '/vendor/tesseract/';

// CACHE_OCRで取得を許可するファイルの厳密なホワイトリスト
// (任意URLをキャッシュさせない=キャッシュ汚染対策)
const OCR_FILES = [
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/tesseract-core-lstm.wasm.js',
  './vendor/tesseract/ssd.traineddata.gz',
  './vendor/tesseract/eng.traineddata.gz',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k !== SHELL_CACHE && k !== OCR_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  // 送信元を同一オリジンのクライアントに限定(他オリジン文脈からの指示を拒否)
  if (event.source && event.source.url) {
    try {
      if (new URL(event.source.url).origin !== self.location.origin) return;
    } catch { return; }
  }
  const data = event.data;
  if (data && data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data && data.type === 'CACHE_OCR') {
    // 設定画面「オフラインOCRを準備」からの明示取得。
    // メッセージのfilesは信用せず、ホワイトリスト(OCR_FILES)のみキャッシュする。
    event.waitUntil((async () => {
      const cache = await caches.open(OCR_CACHE);
      await cache.addAll(OCR_FILES);
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || event.request.method !== 'GET') return;

  // OCR資材: cache-first + 取得時にOCR_CACHEへ保存(オンデマンド)
  // includesではなくscope基準の前方一致で判定(部分一致による誤マッチ回避)
  const ocrBase = new URL('.' + OCR_PREFIX, self.registration.scope).pathname;
  if (url.pathname.startsWith(ocrBase)) {
    event.respondWith((async () => {
      const cache = await caches.open(OCR_CACHE);
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    })());
    return;
  }

  // アプリシェル: cache-first。navigateはindex.htmlへフォールバック
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(event.request);
    if (hit) return hit;
    if (event.request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return fetch(event.request);
  })());
});
