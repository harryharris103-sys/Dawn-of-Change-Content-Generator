/* Dawn of Change · Verse Studio — offline engine (v0.2.2)

   How it works
   - INSTALL   : downloads index.html (required) + manifest/icons + Google Fonts (best effort).
                 If index.html can't be saved, the install FAILS on purpose, so the app never
                 claims "offline-ready" when it isn't.
   - OPENING   : the saved index.html is served instantly (works with no signal AND on a weak,
                 slow signal). Meanwhile it is re-checked in the background; if GitHub Pages has a
                 newer copy it is saved and the app shows "New version ready — reload".
   - FONTS     : Google Fonts CSS + font files are saved in their own cache (kept across updates).
   - GITHUB    : API / raw.githubusercontent.com are NOT handled here — the app keeps its own offline
                 copy of your repo's Bibles and pictures in IndexedDB.
   Updating: just upload the new index.html. Bump VERSION below only if you want a full re-download. */

const VERSION    = '0.2.2';
const APP_CACHE  = 'doc-verse-studio-app-v' + VERSION;
const FONT_CACHE = 'doc-verse-studio-fonts';          // survives version bumps
const SCOPE      = self.registration.scope;           // e.g. https://user.github.io/repo/
const SCOPE_PATH = new URL(SCOPE).pathname;
const SHELL_URL  = new URL('index.html', SCOPE).href;
const OPTIONAL   = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
                    'icons/maskable-192.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png']
                    .map(p => new URL(p, SCOPE).href);

const isFontHost = h => h === 'fonts.googleapis.com' || h === 'fonts.gstatic.com';
const within = (ms, p) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);

const OFFLINE_HTML = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Verse Studio</title><body style="font:16px system-ui;background:#0b0b0c;color:#f2f2f0;padding:32px;line-height:1.5">' +
  '<h2 style="color:#EACA43">Verse Studio isn’t saved on this device yet</h2>' +
  '<p>Open it once while you have internet (over https://) and wait for “offline-ready ✓”. After that it opens with no connection.</p>';

/* ---------- helpers ---------- */

// A redirected response can't be used to answer a page navigation, so rebuild it as a plain one.
async function clean(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: 200, statusText: 'OK', headers: res.headers });
}

async function fetchShell(cacheMode) {
  const res = await fetch(new Request(SHELL_URL, { cache: cacheMode }));
  if (res.status !== 200) throw new Error('index.html → HTTP ' + res.status);
  return clean(res);
}

// Did the server's copy change? (compare ETag, else Last-Modified, else size)
function changed(oldRes, newRes) {
  if (!oldRes) return true;
  for (const h of ['etag', 'last-modified']) {
    const a = oldRes.headers.get(h), b = newRes.headers.get(h);
    if (a || b) return a !== b;
  }
  return oldRes.headers.get('content-length') !== newRes.headers.get('content-length');
}

async function tell(msg) {
  for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage(msg);
}

// First ~16 KB of a response (enough to find the <link> to Google Fonts without reading 4 MB of text).
async function headOf(res, limit = 16384) {
  const reader = res.clone().body.getReader(), dec = new TextDecoder();
  let s = '';
  while (s.length < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    s += dec.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return s;
}

/* ---------- Google Fonts (saved separately, self-healing) ---------- */

async function precacheFonts(shellRes) {
  const html = await headOf(shellRes);
  const cssUrls = [...new Set((html.match(/https:\/\/fonts\.googleapis\.com\/css2?\?[^"'<>\s]+/g) || [])
                    .map(u => u.replace(/&amp;/g, '&')))];
  if (!cssUrls.length) return;
  const cache = await caches.open(FONT_CACHE);
  for (const cssUrl of cssUrls) {
    let cssRes = await cache.match(cssUrl, { ignoreVary: true });
    if (!cssRes) {
      const net = await fetch(cssUrl, { mode: 'cors', credentials: 'omit' });
      if (!net.ok) continue;
      await cache.put(cssUrl, net.clone());
      cssRes = net;
    }
    const css = await cssRes.clone().text();
    const files = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]))];
    const todo = [];
    for (const f of files) if (!(await cache.match(f, { ignoreVary: true }))) todo.push(f);
    for (let i = 0; i < todo.length; i += 4) {          // 4 at a time
      await Promise.all(todo.slice(i, i + 4).map(async f => {
        try {
          const r = await fetch(f, { mode: 'cors', credentials: 'omit' });
          if (r.ok) await cache.put(f, r);
        } catch (e) { /* retried on the next background refresh */ }
      }));
    }
  }
}

async function fontResponse(req) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(req.url, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) cache.put(req.url, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    return Response.error();
  }
}

/* ---------- the app page (index.html) ---------- */

let refreshing = null;
function refreshShell() {
  return refreshing || (refreshing = (async () => {
    try {
      const cache = await caches.open(APP_CACHE);
      const old = await cache.match(SHELL_URL);
      const res = await fetchShell('no-cache');               // cheap conditional request (304) when unchanged
      if (changed(old, res)) {
        await cache.put(SHELL_URL, res.clone());
        await tell({ type: 'UPDATED' });
      }
      await precacheFonts(res).catch(() => {});               // fills in any fonts that failed earlier
    } catch (e) { /* offline or server hiccup — keep using the saved copy */ }
    finally { refreshing = null; }
  })());
}

async function shellResponse(e) {
  const cache = await caches.open(APP_CACHE);
  const hit = await cache.match(SHELL_URL);
  if (hit) { e.waitUntil(refreshShell()); return hit; }       // instant, even on a weak connection
  try {                                                       // nothing saved yet (e.g. cache was cleared)
    const res = await fetchShell('no-cache');
    e.waitUntil(cache.put(SHELL_URL, res.clone()));
    return res;
  } catch (err) {
    return new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

/* ---------- other same-site files (manifest, icons, anything else) ---------- */

async function assetResponse(e) {
  const req = e.request, cache = await caches.open(APP_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req).then(res => {
    if (res.status === 200 && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  try { return await net; } catch (err) { return Response.error(); }
}

/* ---------- lifecycle ---------- */

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    const shell = await fetchShell('reload');                 // REQUIRED: if this fails, install fails
    await cache.put(SHELL_URL, shell.clone());
    await Promise.all(OPTIONAL.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await within(25000, precacheFonts(shell).catch(() => {}));
    // no skipWaiting here: a new version waits until the person taps "reload" (or closes the app)
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys())
      if (k.startsWith('doc-verse-studio') && k !== APP_CACHE && k !== FONT_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);

  if (isFontHost(url.hostname)) { e.respondWith(fontResponse(req)); return; }
  if (url.origin !== location.origin) return;                 // GitHub API / raw files: not ours

  if (req.mode === 'navigate' && (url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH + 'index.html')) {
    e.respondWith(shellResponse(e));
    return;
  }
  e.respondWith(assetResponse(e));
});
