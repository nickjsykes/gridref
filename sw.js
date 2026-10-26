// Caches the app shell so it opens with no signal. Map tiles are not cached.
const CACHE = "gridref-v4";
const SHELL = ["./", "index.html", "osgb.js", "parse.js", "config.js", "manifest.webmanifest", "icon-180.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first for the shell (so updates land), cache as the fallback
self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  if (e.request.method !== "GET" || !SHELL.some((s) => url.endsWith(s.replace("./", "/")) || url === s)) return;
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
