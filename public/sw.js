// Offline λειτουργία: το app ανοίγει χωρίς ίντερνετ με τα τελευταία δεδομένα.
const CACHE = 'draw-signals-v3';
const SHELL = ['./', 'index.html', 'app.css', 'theme.css', 'app.js', 'logic.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network-first για όλα, ώστε οι ενημερώσεις να φτάνουν αμέσως· cache όταν δεν υπάρχει δίκτυο.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(url.pathname.endsWith('data.json') ? 'data.json' : e.request, copy)); }
      return res;
    }).catch(() => caches.match(url.pathname.endsWith('data.json') ? 'data.json' : e.request))
  );
});
