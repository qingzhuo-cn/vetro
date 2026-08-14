/* Vetro service worker — 离线 + 可安装
   策略：先网络后缓存(网络优先)，本地资源缓存。 */
const CACHE = 'vetro-v1';
const ASSETS = ['/', './index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { await cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))); } catch (err) {}
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // CDN / API 直通，不缓存
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const net = await fetch(e.request);
      if (net && net.ok && e.request.method === 'GET') {
        const cache = await caches.open(CACHE);
        cache.put(e.request, net.clone());
      }
      return net;
    } catch (err) {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      const fallback = await caches.match('./index.html');
      return fallback || Response.error();
    }
  })());
});
