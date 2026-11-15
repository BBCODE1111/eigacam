// App shell cache for offline use. Network first, so a new deploy is picked up on the next load.
const CACHE = 'eigastudio-v2';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './src/style.css', './src/app.js', './src/engine.js', './src/library.js', './src/importer.js', './src/xmp.js', './src/cube.js', './src/lr.js', './src/recipe.js', './vendor/fflate.js', '../src/color.js', '../src/looks.js', '../src/masks.js', '../src/files.js', '../src/photo-delivery.js', '../src/develop.js', '../src/engine/renderer.js', '../src/engine/shaders.js', '../icon.svg', '../assets/icon-192.png', '../assets/icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('eigastudio-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
 const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== location.origin) return;
 if (!ASSETS.some(p => new URL(p, self.registration.scope).pathname === u.pathname)) return;
 e.respondWith(fetch(e.request).then(r => {if (r.ok && !r.redirected) {const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));} return r;}).catch(() => caches.match(e.request)));
});
