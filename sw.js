// Keeps Grid Ref working with no signal:
//  - the app itself and the offline place/postcode data (network first, so updates land)
//  - map tiles you've looked at (cache first, refreshed in the background after a week)
const CACHE = "gridref-v119";
const TILES = "gridref-tiles";
const MAPS = "gridref-maps"; // the offline OS map pack and boundary data: kept across updates
const MAX_TILES = 5000; // roughly 100-150 MB of topo tiles
const SHELL = ["./", "index.html", "app.js", "app.css", "osgb.js", "parse.js", "local.js", "config.js", "manifest.webmanifest", "icon-180.png", "w3w.html", "install.html", "qr.png", "osprey.svg", "art/contours.svg", "data/nnr.geojson", "data/ostn15.json",
  "zip.js", "exif.js", "data/places.json", "data/postcodes.json",
  "vendor/leaflet/leaflet.css", "vendor/leaflet/leaflet.js"];
// Aerial imagery isn't cached: Esri's terms don't allow keeping it offline
const TILE_HOSTS = /(^|\.)tile\.opentopomap\.org$|^tile\.openstreetmap\.org$/;
const WEEK = 7 * 24 * 3600 * 1000;

// One file failing (a blip on unpkg, say) must not block the update, or phones get
// stuck on the old version: cache each file separately and carry on regardless.
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: "no-cache" })))))
    .then(() => self.skipWaiting()));
});
// On an upgrade: clear the old files and take over. The page reloads itself (once): forcing
// a reload from here as well made three reloads race on an iPhone home-screen app, which
// could leave it frozen until it was closed and reopened.
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const old = (await caches.keys()).filter((k) => k !== CACHE && k !== TILES && k !== MAPS);
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

let puts = 0;
async function trimTiles(cache) {
  const keys = await cache.keys();
  // keys() comes back oldest first, so drop from the front
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(k);
}

async function tile(request) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(request);
  const refresh = () => fetch(request).then(async (r) => {
    if (r.ok) {
      await cache.put(request, r.clone());
      if (++puts % 100 === 0) trimTiles(cache);
    }
    return r;
  });
  if (hit) {
    const age = Date.now() - new Date(hit.headers.get("date") || 0).getTime();
    if (age > WEEK) refresh().catch(() => {});
    return hit;
  }
  return refresh();
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (TILE_HOSTS.test(url.hostname)) return e.respondWith(tile(e.request));
  // Offline OS map pack: from the phone first; the app downloads the whole pack
  if (url.origin === location.origin && url.pathname.includes("/maps/")) {
    return e.respondWith(caches.open(MAPS).then(async (c) => (await c.match(e.request, { ignoreSearch: true })) || fetch(e.request)));
  }
  // Reserve boundaries: live from Natural England when there's signal, last copy when not
  if (url.hostname === "services.arcgis.com") {
    return e.respondWith(caches.open(MAPS).then((c) => fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => c.match(e.request))));
  }
  const href = e.request.url;
  if (!SHELL.some((s) => (s.startsWith("http") ? href === s : href.split("?")[0].endsWith(s.replace("./", "/"))))) return;
  // no-cache: always ask GitHub for the latest copy, or a 10-minute browser cache serves the old app
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
