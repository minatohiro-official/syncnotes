// SyncNotes Service Worker
// 静的アセットのキャッシュのみ担当。メモのデータ同期はFirestoreのオフライン機能に任せる。

const CACHE_NAME = 'syncnotes-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-config.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Firebase等の外部APIはそのまま素通り
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  // 自分のアプリのファイルはネットワーク優先(常に最新版を取りに行き、
  // オフライン時だけキャッシュにフォールバックする)。
  // これにより、アプリを更新しても次回起動時に確実に新しい内容が反映される。
  event.respondWith(
    fetch(event.request).then((response) => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      return response;
    }).catch(() => caches.match(event.request))
  );
});
