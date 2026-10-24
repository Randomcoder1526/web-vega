/* Vega app-shell worker. Intentionally NEVER caches media, proxy requests,
 * extension modules, user data, streams, subtitles, or third-party resources.
 * A video cannot be made offline by this worker.
 */
const VERSION = 'vega-shell-v2.1.0';
const PRECACHE = ['/', '/manifest.webmanifest', '/favicon.png', '/icon-192.png'];
const isShellAsset = (path) => path.startsWith('/assets/') ||
  path === '/favicon.png' || path === '/icon-192.png' ||
  path === '/icon-512.png' || path === '/manifest.webmanifest';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(PRECACHE);
    // Precache hashed JS/CSS before the initial page has SW control.
    // Exclude media URLs and third-party domains by construction.
    try {
      const response = await fetch('/', { cache: 'no-store' });
      if (response.ok) {
        const html = await response.text();
        const assetUrls = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)]
          .map((match) => match[1]).filter((asset) => /\.(?:js|css)(?:\?|$)/i.test(asset));
        if (assetUrls.length) await cache.addAll([...new Set(assetUrls)]);
      }
    } catch { /* Retain basic app shell when install races a deploy. */ }
  })());
  // Activate only on explicit user approval (SKIP_WAITING message).
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('vega-shell-') && key !== VERSION)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Strict exclusion for media/proxy/extension/download routes and requests.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/dist/') ||
      url.pathname.startsWith('/downloads') ||
      /\.(?:m3u8|mpd|mp4|m4v|webm|mov|mkv|ts|m4s|srt|vtt)(?:$|\.)/i.test(url.pathname) ||
      req.headers.has('range') || req.headers.has('authorization')) return;
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(req); }
      catch {
        const cached = await caches.match('/');
        return cached || Response.error();
      }
    })());
    return;
  }
  if (!isShellAsset(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req);
    if (cached) return cached;
    const response = await fetch(req);
    if (response.ok && response.type === 'basic') await cache.put(req, response.clone());
    return response;
  })());
});
