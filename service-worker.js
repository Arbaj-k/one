const CACHE_NAME = "student-brain-shell-v5";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./voice-assistant.js", "./manifest.json", "./icons/student-brain.svg"];
const OFFLINE_FALLBACK = "./index.html";
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("student-brain-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(OFFLINE_FALLBACK, response.clone()));
      return response;
    }).catch(async () => (await caches.match(req)) || (await caches.match(OFFLINE_FALLBACK)) || Response.error()));
    return;
  }
  event.respondWith(caches.match(req).then(cached => {
    const network = fetch(req).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(req, response.clone()));
      return response;
    }).catch(() => cached || Response.error());
    return cached || network;
  }));
});
