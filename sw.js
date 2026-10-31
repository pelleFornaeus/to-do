// Lets the app open offline.
// Online: always fetch the latest files (skipping the browser's short-term cache), so
// every file comes from the same version. Offline or very slow: use the saved copy.
const CACHE = 'todo-v8';
const ASSETS = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/model.js',
  'js/dates.js',
  'js/store.js',
  'js/history.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    // Give the network a few seconds before falling back to the saved copy.
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
    } catch { /* offline */ }
    const cached = await cache.match(req, { ignoreSearch: true });
    return cached || network;
  })());
});
