/* Dawn of Change · Verse Studio — offline cache (v0.2.0)
   - App page: network-first (so updates arrive), falls back to the saved copy when offline.
   - Same-site files + Google Fonts: serve the saved copy instantly, refresh it in the background.
   - GitHub (API and raw files) is NOT handled here: the app keeps its own offline copy of your
     repo's Bible versions and pictures in the browser's database. */
const V = 'doc-verse-studio-v0.2.1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== V && k.startsWith('doc-verse-studio')) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isFont = h => h === 'fonts.googleapis.com' || h === 'fonts.gstatic.com';

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);

  if (r.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(r);
        if (res.ok) { const cp = res.clone(); e.waitUntil(caches.open(V).then(c => c.put(r, cp))); }
        return res;
      } catch (err) {
        return (await caches.match(r, { ignoreSearch: true })) ||
               (await caches.match('index.html')) ||
               (await caches.match('./')) ||
               Response.error();
      }
    })());
    return;
  }

  if (u.origin === location.origin || isFont(u.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(V);
      const hit = await c.match(r);
      const net = fetch(r).then(res => {
        if (res && (res.ok || res.type === 'opaque')) c.put(r, res.clone());
        return res;
      }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || Response.error();
    })());
  }
});
