// DoubleDoIt moved into Tree of Life. This worker replaces the old offline cache: it deletes it and steps aside,
// so the old address always loads the redirect page fresh.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => self.registration.unregister()));
});
