// 讓 App 可以加到手機主畫面，網路不穩時也能打開
// App 檔案用「先抓網路、失敗再用快取」，所以更新後重新打開就會是新版
const CACHE = 'notes-app-v1';
const SHELL = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'notes.js',
  'github.js',
  'manifest.webmanifest',
  'vendor/js-yaml.min.js',
  'vendor/marked.umd.js',
  'vendor/purify.min.js',
  'icons/icon.svg',
  'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 只處理 App 自己的檔案；GitHub、YouTube 等外部請求直接放行
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
