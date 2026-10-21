/* Sickboiss Shoe Log — service worker
   Caches the app shell so the app opens offline and NFC taps work with no signal.
   Bump VERSION whenever you upload changed files, so phones pick up the update. */
const VERSION = 'shoelog-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'db.js', 'stats.js', 'exports.js', 'demo.js', 'app.js',
  'jspdf.umd.min.js', 'anton.woff2', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Page loads (including NFC links like ./?tag=SB-00421) always get the cached shell.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  // Everything else: cache first, then network (and store the result).
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(req, copy));
    return res;
  })));
});
