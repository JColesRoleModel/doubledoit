/* Offline shell. Tasks themselves are cached by Firestore (IndexedDB), not here.
   Strategy: network-first for our own files (so deploys show up right away),
   cache-first for versioned Firebase SDK + fonts. */
const CACHE = "todo-tablets-v2";
const SHELL = [
  "./", "./index.html", "./dashboard.html", "./scroll.html", "./styles.css",
  "./js/app.js", "./js/dashboard.js", "./js/firebase.js", "./js/tasks.js",
  "./manifest.json", "./assets/img/landscape.webp", "./assets/icons/icon-192.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);

  // Never touch Firebase auth handler or API traffic.
  if(url.pathname.startsWith("/__/")) return;

  const isStaticCDN =
    (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) ||
    url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

  if(isStaticCDN){
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if(res.ok || res.type === "opaque"){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  if(url.origin !== location.origin) return;

  e.respondWith(
    fetch(req).then(res => {
      if(res.ok){
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })
      .then(hit => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined)))
  );
});
