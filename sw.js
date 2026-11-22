/* מחשבון שעות · WAIVES — the offline layer.
 *
 * One rule decides everything here: a tool shown in a client meeting must never
 * open on a stale version, and must never fail to open because the hotel wifi is
 * down. So the page itself is fetched from the network first and only falls back
 * to the copy in the cache, while the things that never change — the icons, the
 * font files — are served from the cache at once.
 *
 * The mapping store is never cached. A saved mapping is shared state; a cached
 * answer would quietly show somebody an old version of their own work.
 */
const CACHE = 'stones-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest',
               './icons/icon-192.png', './icons/icon-512.png',
               './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  /* The mapping store lives on another origin; it is never served from here. */
  if(url.origin !== location.origin && url.hostname.indexOf('workers.dev') !== -1) return;

  /* The page: newest wins, the cache is only the safety net. */
  if(req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')){
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  /* Everything else — icons, the font files: the cache, topped up in the back. */
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if(res && res.status === 200 && (url.origin === location.origin ||
         url.hostname.indexOf('gstatic') !== -1 || url.hostname.indexOf('googleapis') !== -1)){
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => new Response('', {status:504, statusText:'offline'})))
  );
});
