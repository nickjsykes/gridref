// Grid Ref: the app. Loaded after Leaflet, osgb.js, parse.js, zip.js and local.js.
(function () {
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("gridref." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("gridref." + k, JSON.stringify(v)); return true; } catch { return false; } },
  };

  // ---------- map ----------
  const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  const OS_KEY = (window.GRIDREF_CONFIG || {}).osKey || "";
  const LAYERS = {
    aerial: { name: "Aerial photo", layer: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" }) },
    // OS Outdoor: proper OS cartography (contours, paths, woods). Open data up to zoom 16 on
    // OS's free plan; needs a free OS Data Hub key in config.js, and only appears once there is one.
    ...(OS_KEY ? { outdoor: { name: "OS Outdoor", layer: L.tileLayer(`https://api.os.uk/maps/raster/v1/zxy/Outdoor_3857/{z}/{x}/{y}.png?key=${OS_KEY}`, { maxNativeZoom: 16, maxZoom: 19, attribution: "Contains OS data © Crown copyright and database rights 2026" }) } } : {}),
    topo: { name: "Topo", layer: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, subdomains: "abc", crossOrigin: true, attribution: "© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)" }) },
    os: { name: "OS map (offline)", layer: L.tileLayer("maps/{z}/{x}/{y}.webp", { minZoom: 10, maxNativeZoom: 17, maxZoom: 19, errorTileUrl: BLANK }) },
  };
  const start = store.get("view", { lat: 54.25, lon: -2.95, z: 11 });
  const map = L.map("map", { zoomControl: false, attributionControl: true, tap: false }).setView([start.lat, start.lon], start.z);
  map.attributionControl.addAttribution("OS data © Crown copyright 2026");
  let current = OS_KEY ? "outdoor" : "topo"; // every launch starts on OS Outdoor (or Topo without a key); a map picked in the layers menu lasts until the app is closed
  LAYERS[current].layer.addTo(map);
  // Zoom no further than the chosen map goes (the shading on its own isn't a map)
  const fitZoom = () => { map.setMaxZoom(LAYERS[current].layer.options.maxZoom || 19); if (map.getZoom() > map.getMaxZoom()) map.setZoom(map.getMaxZoom()); };
  fitZoom();
  function setBase(k) {
    if (k === current) return;
    map.removeLayer(LAYERS[current].layer);
    current = k;
    LAYERS[k].layer.addTo(map);
    fitZoom();
    if (offlineOverlay && map.hasLayer(offlineOverlay)) offlineOverlay.bringToFront();
  }

  let large = store.get("large", false);
  function keepTarget(change) {
    const t = target();
    change();
    layout();
    const h = sheet.offsetHeight;
    panTo(t, map.getZoom(), false);
    fitRef();
    update();
    // fitRef() and update() resize and refill the grid ref, which can change the panel's
    // height again (coming back from line/area it grew ~20px): re-centre on the same place
    if (sheet.offsetHeight !== h) { layout(); panTo(t, map.getZoom(), false); update(); }
  }
  function setLarge(on) {
    keepTarget(() => {
      large = on;
      store.set("large", on);
      document.body.classList.toggle("large", on);
    });
  }
  document.body.classList.toggle("large", large);
  $("textBtn").classList.toggle("on", large);
  $("textBtn").onclick = () => { setLarge(!large); $("textBtn").classList.toggle("on", large); toast(large ? "Large text" : "Normal text"); };

  const VERSION = "90"; // bump with each release so a phone can show which copy it's running
  const layersEl = $("layers");
  // LiDAR shading: the Environment Agency's 1 m ground model, blended over whichever map is
  // showing. Its own pane sits above the maps, so switching map never covers it.
  map.createPane("shade").style.zIndex = 250;
  const lidarShade = L.tileLayer.wms("https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wms", {
    layers: "Lidar_Composite_Hillshade_DTM_1m", format: "image/png", transparent: true, opacity: 0.55, maxNativeZoom: 19, maxZoom: 19, pane: "shade", className: "lidar", attribution: "LiDAR © Environment Agency" });
  let shadeOn = false; // off at every launch
  function setShade(on) {
    shadeOn = on;
    if (on) lidarShade.addTo(map); else map.removeLayer(lidarShade);
  }
  function drawLayerMenu() {
    layersEl.innerHTML = "";
    for (const [k, v] of Object.entries(LAYERS)) {
      const b = document.createElement("button");
      b.textContent = (k === current ? "● " : "○ ") + v.name;
      b.className = k === current ? "on" : "";
      b.onclick = () => {
        setBase(k);
        store.set("layer", k);
        layersEl.style.display = "none";
      };
      layersEl.appendChild(b);
    }
    const sh = document.createElement("button");
    sh.textContent = (shadeOn ? "☑ " : "☐ ") + "LiDAR shading";
    sh.className = "tick" + (shadeOn ? " on" : "");
    sh.onclick = () => { setShade(!shadeOn); drawLayerMenu(); placeLayerMenu(); };
    layersEl.appendChild(sh);
    if (pack.names) {
      const note = document.createElement("div");
      note.className = "lnote";
      note.textContent = "Offline maps: " + pack.names.map((n) => n.replace(/ Wood and Mosses| Mosses| Moor/g, "").replace("North Walney", "Walney")).join(", ");
      layersEl.appendChild(note);
    }
    if (pack.state === "failed") {
      const off = document.createElement("button");
      off.textContent = "Offline maps paused: tap to retry";
      off.onclick = () => { layersEl.style.display = "none"; downloadPack(); };
      layersEl.appendChild(off);
    }
    const ver = document.createElement("button");
    ver.textContent = "Nick Sykes for Natural England · v" + VERSION;
    ver.disabled = true;
    ver.className = "ver";
    layersEl.appendChild(ver);
  }
  // Open beside the layers button, bottom edges lined up, never off the top of the screen
  function placeLayerMenu() {
    const r = $("layersBtn").getBoundingClientRect();
    layersEl.style.right = window.innerWidth - r.left + 8 + "px";
    layersEl.style.top = "auto";
    layersEl.style.bottom = Math.max(8, window.innerHeight - r.bottom) + "px";
    const top = layersEl.getBoundingClientRect().top, minTop = 100;
    if (top < minTop) { layersEl.style.bottom = "auto"; layersEl.style.top = minTop + "px"; }
  }
  $("layersBtn").onclick = () => {
    const open = layersEl.style.display === "block";
    if (!open) drawLayerMenu();
    layersEl.style.display = open ? "none" : "block";
    if (!open) placeLayerMenu();
  };
  if (shadeOn) setShade(true);

  // Keep the crosshair in the middle of the visible map (above the sheet)
  const sheet = $("sheet");
  function layout() {
    const h = sheet.offsetHeight;
    document.documentElement.style.setProperty("--sheet-h", h + "px");
    document.documentElement.style.setProperty("--cross-y", (window.innerHeight - h) / 2 + "px");
  }
  // The point under the crosshair, not the map's geometric centre
  function target() {
    const size = map.getSize();
    return map.containerPointToLatLng([size.x / 2, (window.innerHeight - sheet.offsetHeight) / 2]);
  }
  function panTo(latlng, zoom, animate = true) {
    const z = Math.min(zoom || map.getZoom(), map.getMaxZoom());
    const offsetY = (window.innerHeight - (window.innerHeight - sheet.offsetHeight) / 2) - window.innerHeight / 2;
    const p = map.project(latlng, z).add([0, offsetY]);
    map.setView(map.unproject(p, z), z, { animate });
  }

  // ---------- OS grid overlay ----------
  const gridLayer = L.layerGroup().addTo(map);
  function drawGrid() {
    gridLayer.clearLayers();
    const z = map.getZoom();
    const step = z >= 13 ? 1000 : z >= 10 ? 10000 : 100000;
    const b = map.getBounds();
    const corners = [b.getSouthWest(), b.getNorthWest(), b.getNorthEast(), b.getSouthEast()].map((c) => OSGB.wgs84ToGrid(c.lat, c.lng));
    const minE = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.e)) / step) * step);
    const maxE = Math.min(700000, Math.ceil(Math.max(...corners.map((c) => c.e)) / step) * step);
    const minN = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.n)) / step) * step);
    const maxN = Math.min(1300000, Math.ceil(Math.max(...corners.map((c) => c.n)) / step) * step);
    if ((maxE - minE) / step > 80 || (maxN - minN) / step > 80) return;
    const style = { color: "#1d4f8f", weight: step === 100000 ? 2 : 1, opacity: 0.55, interactive: false };
    const seg = 8;
    for (let e = minE; e <= maxE; e += step) {
      const pts = [];
      for (let i = 0; i <= seg; i++) { const ll = OSGB.gridToWgs84(e, minN + ((maxN - minN) * i) / seg); pts.push([ll.lat, ll.lon]); }
      L.polyline(pts, style).addTo(gridLayer);
    }
    for (let n = minN; n <= maxN; n += step) {
      const pts = [];
      for (let i = 0; i <= seg; i++) { const ll = OSGB.gridToWgs84(minE + ((maxE - minE) * i) / seg, n); pts.push([ll.lat, ll.lon]); }
      L.polyline(pts, style).addTo(gridLayer);
    }
    // Label the 1 km / 10 km lines along the top and left edges of the screen
    if (step <= 10000) {
      const div = step === 1000 ? 1000 : 10000;
      const digits = step === 1000 ? 2 : 1;
      const top = map.getBounds().getNorth(), left = map.getBounds().getWest();
      for (let e = minE + step; e < maxE; e += step) {
        const ll = OSGB.gridToWgs84(e + step * 0.04, OSGB.wgs84ToGrid(top, map.getCenter().lng).n - step * 0.0);
        const txt = String(Math.floor((e % 100000) / div)).padStart(digits, "0");
        L.marker([top, ll.lon], { interactive: false, icon: L.divIcon({ className: "grid-label", html: txt, iconSize: null, iconAnchor: [-2, -74] }) }).addTo(gridLayer);
      }
      for (let n = minN + step; n < maxN; n += step) {
        const ll = OSGB.gridToWgs84(OSGB.wgs84ToGrid(map.getCenter().lat, left).e, n);
        const txt = String(Math.floor((n % 100000) / div)).padStart(digits, "0");
        L.marker([ll.lat, left], { interactive: false, icon: L.divIcon({ className: "grid-label", html: txt, iconSize: null, iconAnchor: [-4, 14] }) }).addTo(gridLayer);
      }
    }
  }

  // ---------- readout ----------
  // 6 or 8 figures only: phone GPS (~5 m in the open, worse under trees) plus the ~3-5 m
  // datum shift can't support a 10-figure (1 m) ref. 10-figure refs can still be searched.
  const digits = 8; // always 8-figure (10 m): honest for a phone GPS
  let here = null; // { lat, lon, acc }
  function setPrec() { update(); }

  function info(latlng) {
    const g = OSGB.wgs84ToGrid(latlng.lat, latlng.lng);
    return { lat: latlng.lat, lon: latlng.lng, e: g.e, n: g.n, ref: OSGB.gridRef(g.e, g.n, digits) };
  }

  function bearing(a, b) {
    const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180, Δλ = (b.lng - a.lng) * Math.PI / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2), x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const POINT_NAMES = ["North", "North-east", "East", "South-east", "South", "South-west", "West", "North-west"];
  const fmtBrg = (b) => `${POINTS[Math.round(b / 45) % 8]} (${String(Math.round(b) % 360).padStart(3, "0")}°)`;
  function fmtDist(m) { return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(m < 10000 ? 2 : 1) + " km"; }

  // Monospace digits are ~0.6em wide: size the ref to the room beside the 6/8 switch
  function fitRef() {
    const ref = $("ref");
    if (ref.classList.contains("off")) { ref.style.fontSize = ""; return; }
    const room = ref.parentElement.clientWidth - 20; // less the 8 px padding each side
    ref.style.fontSize = Math.max(20, Math.min(large ? 72 : 38, room / (ref.textContent.length * 0.62))) + "px";
  }

  let last = null;
  function update() {
    const t = following && here ? L.latLng(here.lat, here.lon) : target();
    const p = info(t);
    p.en = `${Math.round(p.e)}, ${Math.round(p.n)}`;
    p.ll = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
    last = p;
    const ref = $("ref");
    if (ref.textContent !== (p.ref || "Outside the GB grid")) {
      ref.textContent = p.ref || "Outside the GB grid";
      ref.classList.toggle("off", !p.ref);
      fitRef();
    }
    $("vEN").textContent = p.ref ? p.en : "—";
    $("vLL").textContent = p.ll;
    w3wUpdate(p);
    if (following && here) {
      $("fromMe").textContent = `You are here, GPS ±${Math.round(here.acc)} m`;
    } else if (here) {
      const me = L.latLng(here.lat, here.lon);
      const d = me.distanceTo(t);
      $("fromMe").textContent = d < 3 ? "" : `${fmtDist(d)} from you, ${fmtBrg(bearing(me, t))} ›`;
    } else {
      $("fromMe").textContent = "";
    }
    layout();
  }

  // ---------- what3words ----------
  // With an API key (config.js) the 3 words show in the row; without one the row
  // opens what3words at this spot, which shows the words there.
  const W3W_KEY = (window.GRIDREF_CONFIG || {}).what3wordsKey || "";
  const OPEN_ICON = $("w3wAct").innerHTML;
  let w3w = { at: "", words: "" }, w3wTimer;
  const spot = (p) => p.lat.toFixed(5) + "," + p.lon.toFixed(5);
  function w3wShow(text, isWords) {
    const v = $("vW3W");
    v.textContent = text;
    v.className = isWords ? "v" : "v dim";
    $("w3wAct").style.display = isWords ? "none" : ""; // words showing: tap the row to copy them
    $("w3wAct").classList.toggle("open", !isWords);
  }
  // Coordinates: the what3words app grabs any what3words link but ignores the coordinates
  // (it shows your own location), so go via w3w.html, which forwards after loading and so
  // stays in the browser. 3 words (from search): w3w.co opens the app at that square.
  function w3wHref(path) {
    return /^-?\d/.test(path) ? "w3w.html?ll=" + path : "https://w3w.co/" + path;
  }
  function w3wUpdate(p) {

    if (!W3W_KEY) return w3wShow("Press Open & paste in search", false);
    const at = spot(p);
    if (w3w.at === at && w3w.words) return w3wShow("///" + w3w.words, true);
    w3wShow("…", false);
    clearTimeout(w3wTimer);
    w3wTimer = setTimeout(async () => {
      try {
        const r = await fetch(`https://api.what3words.com/v3/convert-to-3wa?coordinates=${at}&language=en&key=${W3W_KEY}`);
        const j = await r.json();
        if (!j.words) throw new Error(j.error && j.error.message);
        w3w = { at, words: j.words };
        if (last && spot(last) === at) w3wShow("///" + j.words, true);
      } catch {
        if (last && spot(last) === at) w3wShow(navigator.onLine ? "Press Open & paste in search" : "Needs signal", false);
      }
    }, 450);
  }
  function openLink(url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // With words showing (API key), tapping the row copies them instead of opening
  // The what3words app won't take a location from a link (it shows your own), so: copy the
  // lat/long, open what3words, and they paste it into its search to get the 3 words.
  // Their app grabs every what3words link and opens at your own location. A page shown
  // inside our app can't be grabbed, so their map opens here, at the crosshair, with the
  // 3 words. If it won't load, "Open & paste" copies the lat/long and opens their app.
  $("w3wRow").addEventListener("click", (e) => {
    if (!last) return;
    e.preventDefault();
    if (w3w.words && w3w.at === spot(last)) return copy("///" + w3w.words, $("w3wRow"));
    w3wAt = `${last.lat.toFixed(6)}, ${last.lon.toFixed(6)}`;
    copy(w3wAt, document.querySelector('[data-copy="ll"]'));
    $("w3wFrame").src = `https://what3words.com/${last.lat.toFixed(6)},${last.lon.toFixed(6)}`;
    $("w3wModal").hidden = false;
  });
  let w3wAt = "";
  $("w3wClose").onclick = () => { $("w3wModal").hidden = true; $("w3wFrame").src = "about:blank"; };


  let saveView;
  map.on("move", update);
  map.on("moveend", () => {
    drawGrid();
    clearTimeout(saveView);
    saveView = setTimeout(() => { const c = map.getCenter(); store.set("view", { lat: c.lat, lon: c.lng, z: map.getZoom() }); }, 500);
  });
  map.on("movestart", () => { layersEl.style.display = "none"; $("results").style.display = "none"; $("featMenu").style.display = "none"; $("photoMenu").style.display = "none"; });
  map.on("dragstart", () => { if (following) { following = false; $("locBtn").classList.remove("on"); update(); } });
  map.on("click", (e) => { layersEl.style.display = "none"; $("results").style.display = "none"; $("photoMenu").style.display = "none"; if (!nav) panTo(e.latlng); });

  // ---------- GPS ----------
  let watchId = null, following = false, meDot = null, meRing = null, gpsBlocked = false;
  function startGps(follow = true) {
    if (!navigator.geolocation) { toast("Location isn't available on this device"); return; }
    if (follow) {
      following = true;
      $("locBtn").classList.add("on");
      if (here) { panTo(L.latLng(here.lat, here.lon), Math.max(map.getZoom(), 15)); update(); }
    }
    if (watchId != null) return;
    toast("Finding you…");
    let first = true;
    watchId = navigator.geolocation.watchPosition((pos) => {
      here = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
      gpsBlocked = false;
      course = pos.coords.speed > 0.6 && pos.coords.heading >= 0 ? pos.coords.heading : null;
      // Walking briskly with the phone held ahead: compass and GPS direction should roughly agree
      if (course != null && heading != null && pos.coords.speed > 1) disagree = Math.abs(diff(heading, course)) > 60 ? disagree + 1 : 0;
      const ll = L.latLng(here.lat, here.lon);
      if (!meDot) {
        meRing = L.circle(ll, { radius: here.acc, color: "#1a73e8", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
        meDot = L.circleMarker(ll, { radius: 7, color: "#fff", weight: 2.5, fillColor: "#1a73e8", fillOpacity: 1, interactive: false }).addTo(map);
      } else {
        meRing.setLatLng(ll).setRadius(here.acc);
        meDot.setLatLng(ll);
      }
      const a = Math.round(here.acc), badge = $("accBadge");
      badge.hidden = false;
      badge.textContent = `±${a} m`;
      badge.className = "acc" + (a > 25 ? " poor" : a > 10 ? " mid" : "");
      if (following && !nav) panTo(ll, first ? Math.max(map.getZoom(), 15) : undefined);
      first = false;
      update();
      if (nav) drawNav();
    }, (err) => {
      following = false;
      $("locBtn").classList.remove("on");
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
      gpsBlocked = err.code === 1;
      toast(gpsBlocked ? "Location is blocked. Settings › Privacy & Security › Location Services › Safari Websites › While Using" : "Couldn't get a GPS fix. Try again in the open");
      if (nav) drawNav();
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }
  $("locBtn").onclick = () => {
    if (following) { following = false; $("locBtn").classList.remove("on"); update(); }
    else startGps();
  };

  // ---------- actions ----------
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 1800);
  }
  async function copy(text, el, quiet) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch {
      // Older iOS: copy through a temporary text box
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      try { ok = document.execCommand("copy"); } catch {}
      ta.remove();
    }
    if (!ok) return toast("Couldn't copy on this phone");
    if (!quiet) toast("✓ Copied " + (text.length > 30 ? "" : text));
    try { navigator.vibrate && navigator.vibrate(30); } catch {}
    if (!el) return;
    el.classList.add("copied");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("copied"), 1400);
  }
  for (const el of document.querySelectorAll("[data-copy]")) {
    el.onclick = () => {
      if (!last) return;
      const what = el.dataset.copy;
      if ((what === "ref" || what === "en") && !last.ref) return toast("Outside the GB grid: move the crosshair onto Britain");
      copy(last[what], el);
    };
  }
  // Share: tick what goes in. Remembered for next time; name, notes, grid ref + Apple Maps to start with.
  // Name and notes only appear for saved things (the crosshair has neither).
  const SHARE_OPTS = [
    ["name", "Name", (x) => x.head],
    ["notes", "Notes", () => ""], // added last, below the links
    ["ref", "Grid ref", (x) => `Grid ref: ${x.ref}`],
    ["ll", "Lat / long", (x) => `Lat/long: ${x.lat.toFixed(5)}, ${x.lon.toFixed(5)}`],
    ["en", "Easting / northing", (x) => `E/N: ${Math.round(x.e)}, ${Math.round(x.n)}`],
    ["apple", "Apple Maps link", (x) => `https://maps.apple.com/?ll=${x.lat.toFixed(6)},${x.lon.toFixed(6)}&q=${encodeURIComponent(x.label || x.ref)}`],
    ["google", "Google Maps link", (x) => `https://www.google.com/maps/search/?api=1&query=${x.lat.toFixed(6)},${x.lon.toFixed(6)}`],
  ];
  let shareItem = null, shareOn = new Set(store.get("shareOpts", ["ref", "apple"]).filter((k) => k !== "app"));
  if (!store.get("shareNamed", false)) { shareOn.add("name").add("notes"); store.set("shareOpts", [...shareOn]); store.set("shareNamed", true); }
  function shareTextFor(x) {
    return [...SHARE_OPTS.filter(([k]) => shareOn.has(k)).map(([, , f]) => f(x)), shareOn.has("notes") && x.notes].filter(Boolean).join("\n");
  }
  function drawShare() {
    $("shOpts").innerHTML = "";
    for (const [k, label] of SHARE_OPTS) {
      if ((k === "name" && !shareItem.head) || (k === "notes" && !shareItem.notes)) continue;
      const l = document.createElement("label");
      l.innerHTML = `<input type="checkbox" ${shareOn.has(k) ? "checked" : ""}> <span></span>`;
      l.querySelector("span").textContent = label;
      l.querySelector("input").onchange = (e) => { e.target.checked ? shareOn.add(k) : shareOn.delete(k); store.set("shareOpts", [...shareOn]); $("shPrev").textContent = shareTextFor(shareItem); };
      $("shOpts").appendChild(l);
    }
    $("shPrev").textContent = shareTextFor(shareItem);
  }
  function openShare(item) {
    shareItem = item;
    drawShare();
    $("shareModal").hidden = false;
  }
  $("shCancel").onclick = () => { $("shareModal").hidden = true; };
  $("shareModal").onclick = (e) => { if (e.target === $("shareModal")) $("shareModal").hidden = true; };
  $("shGo").onclick = async () => {
    const text = shareTextFor(shareItem);
    if (!text) return toast("Tick at least one thing to share");
    $("shareModal").hidden = true;
    if (navigator.share) { try { await navigator.share({ text }); } catch {} } else copy(text);
  };
  $("shareBtn").onclick = () => {
    if (!last || !last.ref) return toast("Outside the GB grid: move the crosshair onto Britain");
    openShare({ ref: last.ref, lat: last.lat, lon: last.lon, e: last.e, n: last.n });
  };

  // ---------- photo store (IndexedDB: room for hundreds of photos) ----------
  const photoDB = (() => {
    let dbp;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open("gridref", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("photos");
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    }));
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction("photos", mode), req = fn(t.objectStore("photos"));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
      });
    };
    return { put: (id, blob) => run("readwrite", (st) => st.put(blob, id)), get: (id) => run("readonly", (st) => st.get(id)), del: (id) => run("readwrite", (st) => st.delete(id)) };
  })();

  // ---------- saved points ----------
  // Kept in this browser's localStorage. Re-read before every change so two open
  // copies of the app can't overwrite each other's points.
  // Every saved thing must make sense before it's kept or drawn: one broken entry (say from
  // a bad CSV) used to stop the whole app starting.
  const okLL = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  function sane(p) {
    if (!p || typeof p !== "object" || !okLL(p.lat, p.lon)) return false;
    if (p.kind === "line" || p.kind === "area") {
      return Array.isArray(p.pts) && p.pts.length >= (p.kind === "area" ? 3 : 2) && p.pts.every((q) => Array.isArray(q) && okLL(q[0], q[1]));
    }
    return true;
  }
  const loadPoints = () => {
    const raw = store.get("points", []);
    return Array.isArray(raw) ? raw.filter(sane).map((p) => ({ ...p, name: String(p.name ?? "Unnamed"), notes: p.notes == null ? "" : String(p.notes) })) : [];
  };
  let points = loadPoints();
  const fresh = () => (points = loadPoints());
  function savePoints() {
    points = points.filter(sane);
    const ok = store.set("points", points);
    drawPins();
    if (!ok) alert("This phone wouldn't let Grid Ref save. Share your points as CSV now so nothing is lost.");
    return ok;
  }
  window.addEventListener("storage", (e) => { if (e.key === "gridref.points") { fresh(); drawPins(); } });
  // Ask the browser not to clear our storage when space runs low
  const persist = () => { try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {} };
  const pinLayer = L.layerGroup().addTo(map);
  // Point markers: a colour and a shape, so different jobs can be told apart on the map
  // Your marks: one family, tuned to sit on topo and aerial. Magenta first and the default:
  // nothing on the map or the reserve boundaries (burnt orange) uses it. Orange is amber so
  // it can't be mistaken for a reserve edge. Old keys are kept so saved colours still match.
  const COLOURS = { magenta: "#c2255c", red: "#e03131", orange: "#f08c00", yellow: "#fcc419", green: "#2f9e44", blue: "#1c7ed6", purple: "#7048e8", black: "#2b2b2b", white: "#ffffff" };
  const SHAPES = {
    circle: '<circle cx="12" cy="12" r="8"/>',
    square: '<rect x="4.5" y="4.5" width="15" height="15" rx="2"/>',
    triangle: '<path d="M12 3.5 21 20H3Z"/>',
    diamond: '<path d="M12 2.5 21.5 12 12 21.5 2.5 12Z"/>',
    star: '<path d="m12 2.5 2.9 6.2 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8Z"/>',
  };
  const shapeSvg = (shape, colour, size = 22) => {
    if (!SHAPES[shape]) shape = "circle";
    const fill = COLOURS[colour] || COLOURS.orange, stroke = colour === "white" ? "#2b2b2b" : "#fff";
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="2.6" stroke-linejoin="round">${SHAPES[shape] || SHAPES.circle}</svg>`;
  };
  function shapeStats(pt) {
    const ll = pt.pts.map(([a, b]) => L.latLng(a, b));
    const st = mStats(pt.kind === "area" ? ll.concat([ll[0]]) : ll);
    return { length: st.d, area: pt.kind === "area" ? mStats(ll).area : null };
  }
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const nameLabel = (ll, name, dy) => L.marker(ll, { interactive: false, icon: L.divIcon({ className: "", html: `<div class="pinlabel">${esc(name)}</div>`, iconSize: [0, 0], iconAnchor: [-14, dy] }) });
  // How big your marks are: far out (whole reserves and beyond) they shrink so they don't
  // swamp the map; from 15 they're full size, with corner dots
  const zone = () => (map.getZoom() <= 12 ? "far" : map.getZoom() <= 14 ? "mid" : "near");
  let lastZone = null;
  map.on("zoomend", () => {
    const el = map.getContainer();
    el.classList.toggle("close", map.getZoom() >= 16);
    el.classList.toggle("far", zone() === "far");
    el.classList.toggle("mid", zone() === "mid");
    if (zone() !== lastZone) drawPins();
  });
  function drawPins() {
    pinLayer.clearLayers();
    const many = points.length > 300; // thousands of imported points: simple dots, drawn fast
    map.getContainer().classList.toggle("close", map.getZoom() >= 16);
    lastZone = zone();
    const W = { far: [4, 1.6, 1.6], mid: [5.5, 2.2, 2.2], near: [7, 3, 2.5] }[lastZone]; // casing, line, area edge
    map.getContainer().classList.toggle("far", lastZone === "far");
    map.getContainer().classList.toggle("mid", lastZone === "mid");
    for (const pt of points) try {
      if (!many) nameLabel(pt.kind === "area" ? L.latLngBounds(pt.pts).getCenter() : [pt.lat, pt.lon], pt.name, 8).addTo(pinLayer);
      if (pt.kind === "line" || pt.kind === "area") {
        // A white casing under a thinner coloured line: reads on topo and aerial alike, and
        // the wide casing is an easier target for a thumb. Small dots mark the corners.
        const c = COLOURS[pt.colour] || COLOURS.orange, area = pt.kind === "area";
        const Shape = area ? L.polygon : L.polyline, casing = pt.colour === "white" ? "#2b2b2b" : "#fff";
        Shape(pt.pts, { color: casing, weight: W[0], opacity: 0.85, lineJoin: "round", lineCap: "round", fillColor: c, fillOpacity: area ? 0.12 : 0, bubblingMouseEvents: false })
          .on("click", () => openFeature(pt))
          .addTo(pinLayer);
        Shape(pt.pts, { color: c, weight: area ? W[2] : W[1], opacity: 1, lineJoin: "round", lineCap: "round", fill: false, interactive: false }).addTo(pinLayer);
        if (!many && lastZone === "near" && pt.pts.length <= 80)
          for (const v of pt.pts) L.circleMarker(v, { radius: 3, color: c, weight: 2, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(pinLayer);
        continue;
      }
      if (pt.kind === "photo") {
        L.marker([pt.lat, pt.lon], { icon: L.divIcon({ className: "", html: `<div class="photopin">${CAMERA_SVG}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }) })
          .on("click", () => openFeature(pt))
          .addTo(pinLayer);
        continue;
      }
      (many
        ? L.circleMarker([pt.lat, pt.lon], { radius: 5, color: "#fff", weight: 1.5, fillColor: COLOURS[pt.colour] || COLOURS.orange, fillOpacity: 1, renderer: pinCanvas, bubblingMouseEvents: false })
        : L.marker([pt.lat, pt.lon], { icon: L.divIcon({ className: "pin", html: shapeSvg(pt.shape, pt.colour), iconSize: [22, 22], iconAnchor: [11, 11] }) }))
        .on("click", () => openFeature(pt))
        .addTo(pinLayer);
    } catch {}
  }
  const CAMERA_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/></svg>';

  // ---------- tap something on the map: snap to it, then a small menu ----------
  function openFeature(pt) {
    if (measure || nav || moving) return;
    const c = centreOf(pt), to = L.latLng(c.lat, c.lon);
    following = false;
    $("locBtn").classList.remove("on");
    if (target().distanceTo(to) < 1) return showFeatMenu(pt);
    map.once("moveend", () => setTimeout(() => showFeatMenu(pt), 0));
    panTo(to, Math.max(map.getZoom(), 15));
  }
  function showFeatMenu(pt) {
    preloadPhoto(pt);
    const m = $("featMenu"), c = centreOf(pt);
    m.innerHTML = "";
    const head = document.createElement("div");
    head.className = "fm-title";
    head.innerHTML = "<b></b><span></span>";
    head.querySelector("b").textContent = pt.name;
    head.querySelector("span").textContent = pt.kind === "area" ? fmtArea(shapeStats(pt).area) : pt.kind === "line" ? fmtDist(shapeStats(pt).length) : "";
    m.appendChild(head);
    const item = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = () => { m.style.display = "none"; fn(); }; m.appendChild(b); };
    if (pt.kind === "photo") item("View photo", () => viewPhoto(pt));
    item("Navigate", () => { const cc = centreOf(pt); navigateTo(cc.lat, cc.lon); });
    item("Share", () => shareSaved(pt));
    item("Edit", () => editSaved(pt));
    item("Delete", () => deleteSaved(pt));
    m.lastChild.classList.add("danger");
    m.style.right = "auto";
    m.style.bottom = "auto";
    m.style.display = "block";
    // Beside the crosshair, never on top of the thing you tapped
    const w = m.offsetWidth, h = m.offsetHeight, crossY = (window.innerHeight - sheet.offsetHeight) / 2, cx = window.innerWidth / 2;
    m.style.left = (cx + 26 + w <= window.innerWidth - 8 ? cx + 26 : Math.max(8, cx - 26 - w)) + "px";
    m.style.top = Math.min(Math.max(100, crossY - h / 2), window.innerHeight - sheet.offsetHeight - h - 8) + "px";
  }
  const pinCanvas = L.canvas({ padding: 0.3 });

  // One popup for name, notes, colour and shape (the last colour/shape is remembered)
  let pick = { colour: store.get("ptColour", "magenta"), shape: store.get("ptShape", "circle") };
  function drawPickers() {
    // Purple sits too close to magenta, and eight swatches keep the buttons thumb-sized; it's
    // still drawn (and offered) for anything already saved in it
    $("ptColour").innerHTML = Object.keys(COLOURS).filter((c) => c !== "purple" || pick.colour === "purple").map((c) => `<button type="button" data-c="${c}" aria-label="${c}" class="${c === pick.colour ? "on" : ""}">${shapeSvg("circle", c, 24)}</button>`).join("");
    $("ptShape").innerHTML = Object.keys(SHAPES).map((sh) => `<button type="button" data-s="${sh}" aria-label="${sh}" class="${sh === pick.shape ? "on" : ""}">${shapeSvg(sh, pick.colour, 24)}</button>`).join("");
  }
  $("ptColour").onclick = (e) => { const b = e.target.closest("button"); if (b) { pick.colour = b.dataset.c; drawPickers(); } };
  $("ptShape").onclick = (e) => { const b = e.target.closest("button"); if (b) { pick.shape = b.dataset.s; drawPickers(); } };
  let saving = null;
  $("saveBtn").onclick = () => {
    if (!last || !last.ref) return toast("Outside the GB grid: move the crosshair onto Britain");
    fresh();
    openSave({ kind: "point", lat: last.lat, lon: last.lon, e: Math.round(last.e), n: Math.round(last.n), acc: following && here ? Math.round(here.acc) : null });
  };
  const closeSave = () => { $("saveModal").hidden = true; saving = null; editing = null; pick = { colour: store.get("ptColour", "magenta"), shape: store.get("ptShape", "circle") }; $("ptName").blur(); $("ptNotes").blur(); };
  $("ptCancel").onclick = closeSave;
  $("saveModal").onclick = (e) => { if (e.target === $("saveModal")) closeSave(); };
  let editing = null;
  function editSaved(pt) {
    closeDrawer();
    openSave(pt, pt);
  }
  function openSave(geom, edit) {
    fresh();
    $("keepBar").hidden = true;
    saving = geom;
    editing = edit || null;
    const isShape = !!geom.kind && geom.kind !== "point"; // points saved before types existed have no kind
    $("ptKind").hidden = true;
    $("ptShape").hidden = isShape;
    $("ptColour").hidden = geom.kind === "photo"; // photo markers are always the dark camera
    if (isShape) {
      for (const b of $("ptKind").children) {
        b.disabled = b.dataset.k === "area" && (!geom.pts || geom.pts.length < 3);
        b.classList.toggle("on", b.dataset.k === geom.kind);
      }
    }
    $("ptName").value = editing ? editing.name : "";
    $("ptName").placeholder = autoName(geom.kind, geom.lat, geom.lon);
    $("ptNotes").value = editing ? editing.notes || "" : "";
    if (editing) pick = { colour: editing.colour || "orange", shape: editing.shape || "circle" };
    $("ptMoveRow").hidden = !editing;
    $("ptReshape").hidden = !(editing && editing.pts);
    drawPickers();
    $("saveModal").hidden = false;
    setTimeout(() => $("ptName").focus(), 50);
  }
  // Move / Reshape from Edit: keep any name/notes changes, then pick it up
  function editThenMove(mode) {
    const pt = editing;
    $("saveForm").requestSubmit();
    fresh();
    const now = points.find((q) => q.at === pt.at) || pt;
    startMove(now, mode);
  }
  $("ptMove").onclick = () => editThenMove("move");
  $("ptReshape").onclick = () => editThenMove("shape");
  $("ptKind").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled || !saving) return;
    saving.kind = b.dataset.k;
    for (const x of $("ptKind").children) x.classList.toggle("on", x === b);
    $("ptName").placeholder = autoName(saving.kind, saving.lat, saving.lon);
  };
  $("saveForm").onsubmit = (e) => {
    e.preventDefault();
    if (!saving) return;
    fresh();
    const name = $("ptName").value.trim() || $("ptName").placeholder;
    if (editing) {
      const i = points.findIndex((q) => q.at === editing.at && q.name === editing.name);
      if (i >= 0) points[i] = { ...points[i], name, notes: $("ptNotes").value.trim(), colour: pick.colour, ...(points[i].kind ? {} : { shape: pick.shape }) };
      closeSave();
      if (savePoints()) toast("✓ Updated " + name);
      return;
    }
    points.unshift({ name, notes: $("ptNotes").value.trim(), colour: pick.colour, shape: pick.shape, ...saving, at: new Date().toISOString() });
    store.set("ptColour", pick.colour);
    store.set("ptShape", pick.shape);
    persist();
    const wasShape = saving.kind && saving.kind !== "point";
    closeSave();
    if (savePoints()) toast("✓ Saved " + name);
    if (wasShape && measure) $("mDone").click(); // back to the map
  };
  $("listBtn").onclick = () => openDrawer();

  function ago(iso) {
    if (!iso) return "never";
    const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
    return d < 1 ? "today" : d === 1 ? "yesterday" : d + " days ago";
  }
  function navigateTo(lat, lon) {
    closeDrawer();
    following = false;
    $("locBtn").classList.remove("on");
    panTo(L.latLng(lat, lon), Math.max(map.getZoom(), 15), false);
    update();
    $("navBtn").click();
  }
  // Where a saved thing "is": a point, the start of a line, the middle of an area
  function centreOf(pt) {
    if (pt.kind !== "area") return { lat: pt.lat, lon: pt.lon, e: pt.e, n: pt.n };
    const g = pt.pts.map(([a, b]) => OSGB.wgs84ToGrid(a, b));
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < g.length; i++) {
      const j = (i + 1) % g.length, f = g[i].e * g[j].n - g[j].e * g[i].n;
      A += f; cx += (g[i].e + g[j].e) * f; cy += (g[i].n + g[j].n) * f;
    }
    const e = cx / (3 * A), n = cy / (3 * A), ll = OSGB.gridToWgs84(e, n);
    return { lat: ll.lat, lon: ll.lon, e: Math.round(e), n: Math.round(n) };
  }
  const keyOf = (p) => p.at + "|" + p.name;
  // ---------- the notebook: newest first under day headings, filter by type and reserve ----------
  // Imported files go into a folder of their own, shown as one row until you open it.
  let tab = store.get("ntab", "all"), resF = "", folder = null, menuPt = null;
  const KIND_WORD = { point: "Points", line: "Lines", area: "Areas", photo: "Photos" };
  $("tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) { tab = b.dataset.k; store.set("ntab", tab); openDrawer(); } };
  $("resFilter").onclick = (e) => { const b = e.target.closest("button"); if (b) { resF = b.dataset.r; openDrawer(); } };
  function showOnMap(pt) {
    closeDrawer();
    following = false;
    $("locBtn").classList.remove("on");
    if (pt.pts) map.fitBounds(L.latLngBounds(pt.pts), { paddingTopLeft: [30, 80], paddingBottomRight: [80, sheet.offsetHeight + 20], maxZoom: 17 });
    else panTo(L.latLng(pt.lat, pt.lon), Math.max(map.getZoom(), 15));
  }
  const dayKey = (iso) => new Date(iso).toDateString();
  function dayLabel(iso) {
    const d = new Date(iso), today = new Date(), y = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
  }
  const timeOf = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  function summary(list) {
    const n = { point: 0, line: 0, area: 0, photo: 0 };
    for (const p of list) n[p.kind || "point"]++;
    return Object.entries(n).filter(([, v]) => v).map(([k, v]) => `${v} ${KIND_WORD[k].toLowerCase().replace(/s$/, v > 1 ? "s" : "")}`).join(", ");
  }
  const EMPTY_TYPE = {
    point: "No points yet.<br>Line up the crosshair and tap the <b>+</b> point button.<br><br>Got a list of grid refs? <b>Import</b> a CSV.",
    line: "No lines yet.<br>Use the ruler on the left of the map, then <b>Save</b>.",
    area: "No areas yet.<br>Use the area tool on the left of the map, then <b>Save</b>.",
    photo: "No photos yet.<br>Tap <b>Photo</b> to take one or choose one from your phone, then <b>Save</b>. It's pinned on the map where it was taken.",
  };
  const empty = (html) => `<div class="empty"><i class="tex"></i><p>${html}</p></div>`;
  function openDrawer() {
    fresh();
    $("keepBar").hidden = true;
    if (folder && !points.some((p) => p.folder === folder)) folder = null;
    const scope = folder ? points.filter((p) => p.folder === folder) : points;
    // Which reserve each entry is in (worked out now, so imports and old entries get it too)
    const resOf = new Map(scope.map((p) => { const c = centreOf(p); return [p, reserveShort(L.latLng(c.lat, c.lon))]; }));
    const inRes = [...TEAM.values()].filter((r) => [...resOf.values()].includes(r));
    if (resF && resF !== "-" && !inRes.includes(resF)) resF = "";
    // Filters: type, then reserve (only offered when something is in a reserve)
    const counts = { all: scope.length, point: 0, line: 0, area: 0, photo: 0 };
    for (const p of scope) counts[p.kind || "point"]++;
    $("tabs").innerHTML = ["all", "point", "line", "area", "photo"].filter((k) => k === "all" || counts[k] || k === tab)
      .map((k) => `<button data-k="${k}" class="${k === tab ? "on" : ""}">${k === "all" ? "All" : KIND_WORD[k]}${counts[k] ? ` <small>${counts[k]}</small>` : ""}</button>`).join("");
    const elsewhere = [...resOf.values()].some((r) => !r);
    $("resFilter").innerHTML = inRes.length ? [["", "Everywhere"], ...inRes.map((r) => [r, r]), ...(elsewhere ? [["-", "Elsewhere"]] : [])]
      .map(([v, l]) => `<button data-r="${v}" class="${v === resF ? "on" : ""}">${esc(l)}</button>`).join("") : "";
    $("resFilter").hidden = !inRes.length;
    const match = (p) => (tab === "all" || (p.kind || "point") === tab) && (!resF || (resF === "-" ? !resOf.get(p) : resOf.get(p) === resF));
    // Header: the notebook, or the folder you're in
    $("dTitle").textContent = folder || "Notebook";
    $("dSub").textContent = folder ? `(${summary(scope)})` : "(on this phone only)";
    $("folderBack").hidden = !folder;
    $("folderActs").hidden = !folder;
    const list = $("list");
    list.innerHTML = "";
    const shown = scope.filter(match);
    if (!scope.length) list.innerHTML = empty("Your notebook is empty.<br>Line up the crosshair and tap the <b>+</b> point button, draw a line or an area, or take a photo.<br><br>Got a list of grid refs? <b>Import</b> a CSV.");
    else if (!shown.length) list.innerHTML = empty(tab !== "all" && !resF && !folder ? EMPTY_TYPE[tab] : "Nothing here with these filters.");
    // Rows: in a folder just its entries (by name); otherwise loose entries and one row per
    // folder, newest first, under day headings
    let rows;
    if (folder) rows = shown.slice().sort((a, b) => a.name.localeCompare(b.name, "en-GB", { numeric: true })).map((p) => ({ pt: p, at: p.at }));
    else {
      const folders = new Map();
      rows = [];
      for (const p of shown) {
        if (!p.folder) { rows.push({ pt: p, at: p.at }); continue; }
        const f = folders.get(p.folder) || folders.set(p.folder, { folder: p.folder, at: p.at, items: [] }).get(p.folder);
        f.items.push(p);
        if (p.at > f.at) f.at = p.at;
      }
      rows.push(...folders.values());
      rows.sort((a, b) => (a.at < b.at ? 1 : -1));
    }
    let lastDay = null;
    for (const r of rows) {
      if (!folder && dayKey(r.at) !== lastDay) {
        lastDay = dayKey(r.at);
        const h = document.createElement("div");
        h.className = "day";
        h.textContent = dayLabel(r.at);
        list.appendChild(h);
      }
      list.appendChild(r.folder ? folderRow(r) : itemRow(r.pt, resOf.get(r.pt), !folder));
    }
    $("backup").textContent = `Last export: ${ago(store.get("exported", ""))}`;
    if (selecting) drawSelBar();
    $("drawer").classList.add("open");
  }
  function folderRow(f) {
    const row = document.createElement("div");
    row.className = "item folderrow";
    row.innerHTML = `<span class="mk"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z"/></svg></span><div class="main"><div class="line1"><span class="name"></span></div><div class="meta"></div></div><span class="chev">›</span>`;
    row.querySelector(".name").textContent = f.folder;
    row.querySelector(".meta").textContent = `${summary(f.items)} · imported ${timeOf(f.at)}`;
    row.onclick = () => { folder = f.folder; resF = ""; openDrawer(); $("list").scrollTop = 0; };
    return row;
  }
  function itemRow(pt, res, withTime) {
    const row = document.createElement("div");
    row.className = "item";
    const kind = pt.kind || "point", isShape = kind === "line" || kind === "area";
    const st = isShape ? shapeStats(pt) : null;
    const col = COLOURS[pt.colour] || COLOURS.orange;
    const mk = kind === "photo" ? '<img class="thumb" alt="">' : !isShape ? shapeSvg(pt.shape, pt.colour, 18)
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="${kind === "area" ? col + "44" : "none"}" stroke="${col}" stroke-width="3" stroke-linejoin="round">${kind === "area" ? '<path d="M4 7 12 3l8 6-3 11H6Z"/>' : '<path d="M3 18 9 9l5 6 7-10"/>'}</svg>`;
    const what = !isShape ? OSGB.gridRef(pt.e, pt.n, digits) : kind === "area" ? fmtArea(st.area) : fmtDist(st.length);
    row.innerHTML = `<span class="chk">✓</span><span class="mk">${mk}</span><div class="main"><div class="line1"><span class="name"></span><span class="gr"></span></div><div class="note"></div><div class="meta"></div></div>`;
    row.querySelector(".name").textContent = pt.name;
    row.querySelector(".gr").textContent = what;
    if (kind === "photo") photoDB.get(pt.photoId).then((b) => { if (b) row.querySelector(".thumb").src = URL.createObjectURL(b); }).catch(() => {});
    // Notes: up to 4 lines here; tap the entry to read them in full
    if (pt.notes) row.querySelector(".note").textContent = pt.notes;
    else row.querySelector(".note").remove();
    const meta = row.querySelector(".meta");
    if (res) { const t = document.createElement("span"); t.className = "rtag"; t.textContent = res; meta.appendChild(t); }
    meta.append([withTime ? timeOf(pt.at) : "", pt.acc ? `±${pt.acc} m` : ""].filter(Boolean).join(" · "));
    const c = centreOf(pt);
    if (picked.has(keyOf(pt))) row.classList.add("picked");
    row.onclick = () => {
      if (selecting) {
        const k = keyOf(pt);
        picked.has(k) ? picked.delete(k) : picked.add(k);
        row.classList.toggle("picked", picked.has(k));
        return drawSelBar();
      }
      menuPt = pt;
      preloadPhoto(pt);
      $("imName").textContent = pt.name;
      $("imRef").textContent = OSGB.gridRef(c.e, c.n, digits) + (kind === "area" ? " (centre)" : kind === "line" ? " (start)" : "");
      $("imView").hidden = kind !== "photo";
      $("imNotes").textContent = pt.notes || "";
      $("itemMenu").hidden = false;
    };
    return row;
  }
  $("folderBack").onclick = () => { folder = null; resF = ""; openDrawer(); };
  $("folderMap").onclick = () => {
    const all = points.filter((p) => p.folder === folder).flatMap((p) => (p.pts ? p.pts : [[p.lat, p.lon]]));
    if (!all.length) return;
    closeDrawer();
    following = false;
    $("locBtn").classList.remove("on");
    map.fitBounds(L.latLngBounds(all), { paddingTopLeft: [30, 110], paddingBottomRight: [80, sheet.offsetHeight + 20], maxZoom: 17 });
  };
  $("folderDel").onclick = () => {
    const gone = points.filter((p) => p.folder === folder);
    deleteSaved(gone, `Deleted folder ${folder} (${gone.length})`);
    folder = null;
    openDrawer();
  };
  const closeMenu = () => { $("itemMenu").hidden = true; };
  $("imCancel").onclick = closeMenu;
  $("itemMenu").onclick = (e) => { if (e.target === $("itemMenu")) closeMenu(); };
  $("imShow").onclick = () => { closeMenu(); showOnMap(menuPt); };
  $("imNav").onclick = () => { closeMenu(); const c = centreOf(menuPt); navigateTo(c.lat, c.lon); };
  // A photo shares the picture itself. The iPhone only opens the share sheet straight from a
  // tap, so the picture is loaded as soon as its menu opens, ready to go.
  let photoReady = null;
  function preloadPhoto(pt) {
    photoReady = null;
    if (pt.kind !== "photo") return;
    photoDB.get(pt.photoId).then((b) => { if (b) photoReady = { id: pt.photoId, file: new File([b], `${pt.name.replace(/[^\w-]+/g, "_")}.jpg`, { type: "image/jpeg" }) }; }).catch(() => {});
  }
  async function sharePhoto(pt) {
    const f = photoReady && photoReady.id === pt.photoId ? photoReady.file : null;
    if (!f) return toast("Photo still loading: tap Share again");
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f] }); } catch {} }
    else toast("This phone can't share photos from here");
  }
  function shareSaved(pt) {
    if (pt.kind === "photo") return sharePhoto(pt);
    const c = centreOf(pt), ref = OSGB.gridRef(c.e, c.n, digits);
    const what = pt.kind === "area" ? ` (centre of ${fmtArea(shapeStats(pt).area)})` : pt.kind === "line" ? ` (start of ${fmtDist(shapeStats(pt).length)} line)` : "";
    openShare({ head: `${pt.name}${what}`, label: pt.name, notes: pt.notes || "", ref, lat: c.lat, lon: c.lon, e: c.e, n: c.n });
  }
  $("imShare").onclick = () => { closeMenu(); shareSaved(menuPt); };
  $("imEdit").onclick = () => { closeMenu(); editSaved(menuPt); };
  $("imView").onclick = () => { closeMenu(); viewPhoto(menuPt); };
  // Delete at once, with Undo for a few seconds (kinder than "are you sure?" with cold
  // thumbs). A photo's picture is only really removed once the Undo has gone.
  let undoTimer = null, undoItems = null;
  function finishDelete() {
    clearTimeout(undoTimer);
    for (const p of undoItems || []) if (p.photoId) photoDB.del(p.photoId).catch(() => {});
    undoItems = null;
    $("undoBar").hidden = true;
  }
  // One entry, or a list of them (a whole folder)
  function deleteSaved(what, label) {
    finishDelete();
    fresh();
    const gone = Array.isArray(what) ? what : [what];
    const keys = new Set(gone.map(keyOf));
    points = points.filter((p) => !keys.has(keyOf(p)));
    savePoints();
    undoItems = gone;
    $("undoText").textContent = label || `Deleted ${gone[0].name}`;
    $("keepBar").hidden = true;
    $("undoBar").hidden = false;
    undoTimer = setTimeout(finishDelete, 7000);
    return true;
  }
  $("undoBtn").onclick = () => {
    clearTimeout(undoTimer);
    if (!undoItems) return;
    fresh();
    points.push(...undoItems);
    points.sort((a, b) => (a.at < b.at ? 1 : -1));
    undoItems = null;
    $("undoBar").hidden = true;
    savePoints();
    if ($("drawer").classList.contains("open")) openDrawer();
    toast("Restored");
  };
  $("imDel").onclick = () => { if (deleteSaved(menuPt)) { closeMenu(); openDrawer(); } };
  function closeDrawer() { if (selecting) { selecting = false; picked.clear(); $("drawer").classList.remove("selecting"); } $("drawer").classList.remove("open"); }
  $("closeDrawer").onclick = closeDrawer;
  // ---------- export: everything, one tab, or picked entries; CSV or GeoJSON ----------
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  function toCSV(list) {
    const wkt = (p) => {
      if (!p.pts) return "";
      const c = p.pts.map(([a, b]) => `${b} ${a}`);
      return p.kind === "area" ? `POLYGON((${c.concat([c[0]]).join(", ")}))` : `LINESTRING(${c.join(", ")})`;
    };
    const rows = [["Name", "Type", "Grid ref", "Latitude", "Longitude", "Easting", "Northing", "Length (m)", "Area (ha)", "GPS accuracy (m)", "Saved", "Notes", "Colour", "Shape", "Geometry (WKT)", "Photo file", "Folder"]]
      .concat(list.map((p) => {
        const st = p.pts ? shapeStats(p) : null;
        return [q(p.name), p.kind || "point", OSGB.gridRef(p.e, p.n, 8), p.lat.toFixed(6), p.lon.toFixed(6), p.e, p.n, st ? Math.round(st.length) : "", st && st.area != null ? (st.area / 10000).toFixed(3) : "",
          p.acc ?? "", p.at, q(p.notes || ""), p.colour || "orange", p.shape || "circle", q(wkt(p)), p.photoId ? `photos/${p.photoId}.jpg` : "", q(p.folder || "")];
      }));
    return rows.map((r) => r.join(",")).join("\n");
  }
  // GeoJSON: what ArcGIS Online, Field Maps and QGIS take directly, shapes and all
  function toGeoJSON(list) {
    const features = list.map((p) => {
      const c = centreOf(p), st = p.pts ? shapeStats(p) : null;
      const ring = p.pts ? p.pts.map(([a, b]) => [+b.toFixed(6), +a.toFixed(6)]) : null;
      const geometry = p.kind === "area" ? { type: "Polygon", coordinates: [ring.concat([ring[0]])] }
        : p.kind === "line" ? { type: "LineString", coordinates: ring }
        : { type: "Point", coordinates: [+p.lon.toFixed(6), +p.lat.toFixed(6)] };
      return { type: "Feature", geometry, properties: {
        name: p.name, type: p.kind || "point", notes: p.notes || "", grid_ref: OSGB.gridRef(c.e, c.n, 8),
        latitude: +c.lat.toFixed(6), longitude: +c.lon.toFixed(6), easting: Math.round(c.e), northing: Math.round(c.n), length_m: st ? Math.round(st.length) : null,
        area_ha: st && st.area != null ? +(st.area / 10000).toFixed(4) : null, gps_accuracy_m: p.acc ?? null,
        saved: p.at, colour: p.colour || "orange", shape: p.shape || "circle", photo: p.photoId ? `photos/${p.photoId}.jpg` : null, folder: p.folder || null } };
    });
    return JSON.stringify({ type: "FeatureCollection", features }, null, 1);
  }
  async function exportList(list, fmt, withPhotos) {
    if (!list.length) return toast("Nothing picked to export");
    const day = new Date().toISOString().slice(0, 10);
    const photos = withPhotos ? list.filter((p) => p.photoId) : [];
    let file;
    if (photos.length) {
      // A zip: both data files (so it restores and opens anywhere) plus the photos themselves
      toast(`Packing ${photos.length} photo${photos.length > 1 ? "s" : ""}…`);
      const files = [{ name: `field-notes-${day}.csv`, data: toCSV(list) }, { name: `field-notes-${day}.geojson`, data: toGeoJSON(list) }];
      for (const p of photos) { try { const b = await photoDB.get(p.photoId); if (b) files.push({ name: `photos/${p.photoId}.jpg`, data: b }); } catch {} }
      file = new File([await Zip.make(files)], `field-notes-${day}.zip`, { type: "application/zip" });
    } else {
      file = fmt === "geojson"
        ? new File([toGeoJSON(list)], `field-notes-${day}.geojson`, { type: "application/geo+json" })
        : new File([toCSV(list)], `field-notes-${day}.csv`, { type: "text/csv" });
    }
    let done = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); done = true; } catch {}
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
      done = true;
    }
    if (done) { store.set("exported", new Date().toISOString()); openDrawer(); }
  }
  let exportFmt = "csv", exportPhotos = false, selecting = false;
  const picked = new Set();
  $("exportBtn").onclick = () => {
    fresh();
    if (!points.length) return toast("Nothing saved yet");
    // Same start every time: spreadsheet, everything, no photos
    $("exAll").textContent = `Everything (${points.length})`;
    for (const r of document.querySelectorAll('#exportModal input[name="exs"]')) r.checked = r.value === "all";
    for (const r of document.querySelectorAll('#exportModal input[name="exf"]')) r.checked = r.value === "csv";
    $("exPhotos").checked = false;
    $("exportModal").hidden = false;
  };
  $("exCancel").onclick = () => { $("exportModal").hidden = true; };
  $("exportModal").onclick = (e) => { if (e.target === $("exportModal")) $("exportModal").hidden = true; };
  $("exGo").onclick = () => {
    const scope = document.querySelector('#exportModal input[name="exs"]:checked').value;
    exportFmt = document.querySelector('#exportModal input[name="exf"]:checked').value;
    $("exportModal").hidden = true;
    fresh();
    exportPhotos = $("exPhotos").checked;
    if (scope === "all") return exportList(points, exportFmt, exportPhotos);
    // Pick: tap entries to tick them (across any tab), then Export
    selecting = true;
    picked.clear();
    $("drawer").classList.add("selecting");
    openDrawer();
    toast("Tap entries to pick them");
  };
  function endSelect() {
    selecting = false;
    picked.clear();
    $("drawer").classList.remove("selecting");
    openDrawer();
  }
  $("selCancel").onclick = endSelect;
  $("selGo").onclick = () => {
    fresh();
    const list = points.filter((p) => picked.has(keyOf(p)));
    endSelect();
    exportList(list, exportFmt, exportPhotos);
  };
  function drawSelBar() { $("selGo").textContent = `Export ${picked.size}`; }

  // Import: our own CSV back in, or any CSV with a name column and a grid ref,
  // E/N or lat/long column (e.g. a list of dormouse boxes)
  function parseCSV(text) {
    // Excel on some settings writes semicolons; some tools write tabs
    const first = text.split(/\r?\n/)[0] || "";
    const sep = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }
  function importCSV(text, photoFiles, folderName) {
    const rows = parseCSV(text.replace(/^﻿/, ""));
    if (rows.length < 2) return { added: 0, skipped: 0 };
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...names) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
    const iName = col("name", "label", "box", "id", "title"), iRef = col("grid ref", "gridref", "grid reference", "osgr", "ngr", "ref");
    const iE = col("easting", "x"), iN = col("northing", "y"), iLat = col("lat"), iLon = col("lon", "lng", "long");
    const iAt = col("saved", "date", "time"), iAcc = col("gps accuracy", "accuracy");
    const iNotes = col("notes", "note", "comment", "description"), iColour = col("colour", "color"), iShape = col("shape"), iGeom = col("geometry", "wkt");
    const iType = col("type"), iPhoto = col("photo file", "photo"), iFolder = col("folder");
    // Our own export coming back (a backup) restores as it was; anything else gets a folder
    const ours = head.includes("type") && head.includes("saved") && head.some((h) => h.startsWith("geometry"));
    const folderOf = (get) => get(iFolder) || (ours ? "" : folderName || "");
    const pendingPhotos = [];
    fresh();
    const seen = new Set(points.map((p) => p.name + "|" + p.e + "|" + p.n));
    let added = 0, skipped = 0;
    for (const r of rows.slice(1)) {
      const get = (i) => (i >= 0 ? (r[i] || "").trim() : "");
      // Lines and areas come back from their WKT
      const geom = get(iGeom).match(/^(LINESTRING|POLYGON)\s*\(+([^)]*)\)+/i);
      if (geom) {
        const pts = geom[2].split(",").map((xy) => xy.trim().split(/\s+/).map(Number)).map(([lon, lat]) => [lat, lon]);
        if (/POLYGON/i.test(geom[1]) && pts.length > 1) pts.pop();
        if (!pts.length || !pts.every((q) => okLL(q[0], q[1])) || pts.length < (/POLYGON/i.test(geom[1]) ? 3 : 2)) { skipped++; continue; }
        const g0 = OSGB.wgs84ToGrid(pts[0][0], pts[0][1]);
        const shp = { name: get(iName) || "Imported " + (added + 1), kind: /POLYGON/i.test(geom[1]) ? "area" : "line", pts, lat: pts[0][0], lon: pts[0][1], e: Math.round(g0.e), n: Math.round(g0.n),
          at: get(iAt) && !isNaN(Date.parse(get(iAt))) ? new Date(get(iAt)).toISOString() : new Date().toISOString(), acc: null, notes: get(iNotes),
          colour: COLOURS[get(iColour).toLowerCase()] ? get(iColour).toLowerCase() : "orange" };
        if (folderOf(get)) shp.folder = folderOf(get);
        const key = shp.name + "|" + shp.e + "|" + shp.n;
        if (seen.has(key)) { skipped++; continue; }
        seen.add(key);
        points.push(shp);
        added++;
        continue;
      }
      let ll = null;
      if (get(iLat) && get(iLon) && !isNaN(+get(iLat)) && !isNaN(+get(iLon))) ll = { lat: +get(iLat), lon: +get(iLon) };
      else if (get(iRef)) ll = GridSearch.parse(get(iRef)).find((x) => x.lat != null) || null;
      else if (get(iE) && get(iN) && OSGB.inGrid(+get(iE), +get(iN))) ll = OSGB.gridToWgs84(+get(iE), +get(iN));
      if (!ll || !okLL(ll.lat, ll.lon)) { skipped++; continue; }
      const g = OSGB.wgs84ToGrid(ll.lat, ll.lon);
      const at = get(iAt) && !isNaN(Date.parse(get(iAt))) ? new Date(get(iAt)).toISOString() : new Date().toISOString();
      const pt = { name: get(iName) || "Imported " + (added + 1), lat: ll.lat, lon: ll.lon, e: Math.round(g.e), n: Math.round(g.n), at, acc: +get(iAcc) || null,
        notes: get(iNotes), colour: COLOURS[get(iColour).toLowerCase()] ? get(iColour).toLowerCase() : "orange", shape: SHAPES[get(iShape).toLowerCase()] ? get(iShape).toLowerCase() : "circle" };
      if (folderOf(get)) pt.folder = folderOf(get);
      // A photo row from one of our zips: bring the picture back too
      if (get(iType) === "photo" && photoFiles && photoFiles.has(get(iPhoto))) {
        pt.kind = "photo";
        pt.photoId = "ph" + Date.now() + "_" + added;
        pendingPhotos.push({ id: pt.photoId, data: photoFiles.get(get(iPhoto)) });
      }
      const key = pt.name + "|" + pt.e + "|" + pt.n;
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      points.push(pt);
      added++;
    }
    points.sort((a, b) => (a.at < b.at ? 1 : -1));
    if (added) { persist(); savePoints(); }
    return { added, skipped, pendingPhotos, folder: points.find((p) => p.folder && folderName && p.folder === folderName) ? folderName : null };
  }
  window.__importCSV = importCSV; // for testing
  $("importBtn").onclick = () => $("importFile").click();
  $("importFile").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    let res;
    const folderName = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported";
    if (/\.zip$/i.test(f.name) || f.type === "application/zip") {
      let entries;
      try { entries = await Zip.read(f); } catch (err) { return toast(err.message); }
      const csv = entries.find((x) => /\.csv$/i.test(x.name));
      if (!csv) return toast("No CSV inside that zip");
      const photos = new Map(entries.filter((x) => /\.jpe?g$/i.test(x.name)).map((x) => [x.name, x.data]));
      res = importCSV(new TextDecoder().decode(csv.data), photos, folderName);
      for (const ph of res.pendingPhotos) { try { await photoDB.put(ph.id, new Blob([ph.data], { type: "image/jpeg" })); } catch {} }
    } else res = importCSV(await f.text(), null, folderName);
    // Open the folder it went into, so you see what came in
    if (res.added && res.folder) { folder = res.folder; resF = ""; }
    openDrawer();
    toast(`Imported ${res.added}` + (res.added && res.folder ? ` into "${res.folder}"` : "") + (res.pendingPhotos && res.pendingPhotos.length ? ` (${res.pendingPhotos.length} photos)` : "") + (res.skipped ? `, skipped ${res.skipped}` : ""));
  };

  // ---------- search ----------
  const resultsEl = $("results");
  function showResults(items, msg) {
    resultsEl.innerHTML = "";
    if (msg) {
      const m = document.createElement("div");
      m.className = "msg";
      m.textContent = msg;
      resultsEl.appendChild(m);
    }
    for (const it of items) {
      const b = document.createElement("button");
      // Everything is shown as the grid ref it lands on; the name goes underneath
      b.innerHTML = "<span class='tag'></span><span class='gr'></span><span class='t'></span><small></small>";
      const gr = it.lat != null ? fmtRef(it.lat, it.lon) : "";
      if (it.tag) b.querySelector(".tag").textContent = it.tag;
      else b.querySelector(".tag").remove();
      b.querySelector(".gr").textContent = gr || it.title;
      if (gr && it.title !== gr) b.querySelector(".t").textContent = it.title;
      else b.querySelector(".t").remove();
      b.querySelector("small").textContent = it.sub || "";
      if (it.clear) b.classList.add("clearrow");
      b.onclick = () => go(it);
      resultsEl.appendChild(b);
    }
    resultsEl.style.display = items.length || msg ? "block" : "none";
  }
  // Recent searches: the last 12 places you went to from the search box
  const HISTORY_MAX = 12;
  function remember(it) {
    const q = $("q").value.trim() || it.title;
    const key = (x) => x.lat.toFixed(5) + "," + x.lon.toFixed(5);
    const list = store.get("history", []).filter((h) => key(h) !== key(it));
    list.unshift({ q, title: it.title, sub: it.sub || "", lat: it.lat, lon: it.lon, zoom: it.zoom || 15, at: Date.now() });
    store.set("history", list.slice(0, HISTORY_MAX));
  }
  function showHistory() {
    const list = store.get("history", []);
    if (!list.length) return showResults([]);
    const items = list.map((h) => ({ title: h.q, sub: h.title !== h.q ? h.title + (h.sub ? " · " + h.sub : "") : h.sub, tag: "Recent", lat: h.lat, lon: h.lon, zoom: h.zoom, fromHistory: true }));
    items.push({ title: "Clear search history", clear: true });
    showResults(items);
  }
  function go(it) {
    if (it.clear) { store.set("history", []); resultsEl.style.display = "none"; return toast("Search history cleared"); }
    if (it.url) return openLink(it.w3w ? w3wHref(it.w3w) : it.url);
    if (!it.fromHistory) remember(it);
    resultsEl.style.display = "none";
    $("q").blur();
    following = false;
    $("locBtn").classList.remove("on");
    setCompact(true); // just the grid ref; swipe up for the other formats
    // Jump, don't glide: lands at once even if the phone has paused animation (Low Power Mode)
    panTo(L.latLng(it.lat, it.lon), it.zoom || 15, false);
    offerKeep(it);
  }
  // "Add to notebook" for a few seconds after a search lands; gone once you move the map
  let keepTimer = null, keepIt = null;
  function offerKeep(it) {
    clearTimeout(keepTimer);
    keepIt = it;
    $("keepText").textContent = it.title || "This place";
    $("keepBar").hidden = !$("undoBar").hidden;
    keepTimer = setTimeout(() => ($("keepBar").hidden = true), 9000);
    setTimeout(() => map.once("movestart", () => ($("keepBar").hidden = true)), 0);
  }
  $("keepBtn").onclick = () => {
    $("keepBar").hidden = true;
    if (!keepIt) return;
    const g = OSGB.wgs84ToGrid(keepIt.lat, keepIt.lon);
    fresh();
    openSave({ kind: "point", lat: keepIt.lat, lon: keepIt.lon, e: Math.round(g.e), n: Math.round(g.n), acc: null });
    if (keepIt.title && !/^[A-Z]{2} \d/.test(keepIt.title)) $("ptName").value = keepIt.title; // a place name, not a bare grid ref
  };
  const fmtRef = (lat, lon) => { const g = OSGB.wgs84ToGrid(lat, lon); return OSGB.gridRef(g.e, g.n, digits); };
  async function getJSON(url) { const r = await fetch(url); return r.json(); }

  // One parsed reading -> result rows (postcodes and what3words need a lookup)
  async function resolve(r) {
    if (r.lat != null) {
      const ll = `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}`;
      return [{ title: r.title || fmtRef(r.lat, r.lon) || ll, sub: ll, tag: r.label, lat: r.lat, lon: r.lon, zoom: r.zoom }];
    }
    if (r.kind === "postcode") {
      try { const hit = await LocalSearch.postcode(r.code); if (hit) return [hit]; } catch {}
      const j = await getJSON("https://api.postcodes.io/postcodes/" + r.code);
      if (!j.result) return [];
      const x = j.result;
      return [{ title: x.postcode, sub: [x.admin_ward, x.admin_district].filter(Boolean).join(", "), tag: "Postcode", lat: x.latitude, lon: x.longitude, zoom: 16 }];
    }
    if (r.kind === "outcode") {
      try { const hit = await LocalSearch.outcode(r.code); if (hit) return [hit]; } catch {}
      const j = await getJSON("https://api.postcodes.io/outcodes/" + r.code);
      if (!j.result) return [];
      const x = j.result;
      return [{ title: x.outcode, sub: (x.admin_district || []).slice(0, 2).join(", "), tag: "Postcode area", lat: x.latitude, lon: x.longitude, zoom: 13 }];
    }
    if (r.kind === "w3w") {
      if (W3W_KEY) {
        const j = await getJSON(`https://api.what3words.com/v3/convert-to-coordinates?words=${encodeURIComponent(r.words)}&key=${W3W_KEY}`);
        if (j.coordinates) return [{ title: "///" + r.words, sub: j.nearestPlace || "", tag: "what3words", lat: j.coordinates.lat, lon: j.coordinates.lng, zoom: 18 }];
      }
      return [{ title: "///" + r.words, sub: "Opens in what3words", tag: "what3words", url: "https://what3words.com/" + r.words, w3w: r.words }];
    }
    return [];
  }

  // Place names, as you type (Photon allows type-ahead; Nominatim doesn't)
  async function places(text) {
    const c = map.getCenter();
    const j = await getJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=7&lang=en&bbox=-8.8,49.8,2.0,60.95&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}`);
    const zoomFor = { city: 12, town: 13, village: 14, hamlet: 15, county: 10, state: 8, district: 13 };
    return (j.features || []).map((f) => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      let kind = p.osm_value === "yes" ? p.osm_key : p.osm_value || p.type || "";
      kind = kind.replace(/_/g, " ");
      const where = [p.city || p.town || p.village, p.county || p.state].filter((x) => x && x !== p.name);
      return {
        title: p.name || p.street || "Unnamed",
        sub: [kind && kind[0].toUpperCase() + kind.slice(1), ...where].join(" · "),
        lat, lon, zoom: zoomFor[p.type] || zoomFor[p.osm_value] || 16,
      };
    });
  }

  let seq = 0, typing;
  async function search(text, submit) {
    const my = ++seq;
    text = text.trim();
    if (!text) return showResults([]);
    const readings = GridSearch.parse(text);
    const bad = readings.find((r) => r.kind === "bad-ref");
    if (bad) return showResults([], bad.message);
    if (readings.some((r) => r.kind === "link-unknown")) {
      return showResults([], "Can't read a location from that link. Short links (maps.app.goo.gl) hide it: open the link, then copy the coordinates in.");
    }
    const items = [];
    // Grid refs, E/N, lat/long and map links work offline and show at once
    for (const r of readings) if (r.lat != null) items.push(...(await resolve(r)));
    if (items.length && !submit) showResults(items);
    const exact = readings.some((r) => r.lat != null || r.kind === "postcode" || r.kind === "w3w");
    // Places from the offline OS data (Cumbria and north Lancashire) show at once
    if (!exact && text.length >= 2) {
      try { items.push(...(await LocalSearch.searchPlaces(text, map.getCenter(), 6))); } catch {}
      if (my !== seq) return;
      if (items.length && !submit) showResults(items);
    }
    let offline = false;
    try {
      for (const r of readings) if (r.lat == null) items.push(...(await resolve(r)));
    } catch { offline = true; }
    // Then everywhere else, online. Skip anything the offline data already found.
    if (!exact && text.length >= 3 && !(submit && items.length)) {
      try {
        const near = (it) => items.some((x) => LocalSearch.norm(x.title) === LocalSearch.norm(it.title) && L.latLng(x.lat, x.lon).distanceTo([it.lat, it.lon]) < 800);
        items.push(...(await places(text)).filter((it) => !near(it)));
      } catch { offline = true; }
    }
    if (my !== seq) return;
    if (offline && !items.length) return showResults([], "No signal, and not in the offline place list. Grid refs, E/N and lat/long always work.");
    if (my !== seq) return;
    if (submit && items.length) return go(items[0]);
    showResults(items, items.length ? "" : text.length >= 3 ? "Nothing found. Try a grid ref (SD 339 836), postcode, lat/long or place." : "");
  }
  $("searchForm").onsubmit = (ev) => { ev.preventDefault(); clearTimeout(typing); search($("q").value, true); };
  $("q").addEventListener("input", () => {
    clearTimeout(typing);
    const v = $("q").value;
    if (!v.trim()) return showHistory();
    typing = setTimeout(() => search(v, false), 280);
  });
  $("q").addEventListener("focus", () => { if ($("q").value.trim()) search($("q").value, false); else showHistory(); });

  // Tap "340 m from you, NE (047°) ›" to navigate there
  $("fromMe").onclick = () => { if ($("fromMe").textContent && !following) $("navBtn").click(); };

  // ---------- sheet: swipe down for just the grid ref, up for everything ----------
  function setCompact(on) {
    if ($("sheet").classList.contains("compact") === on) return;
    keepTarget(() => { $("sheet").classList.toggle("compact", on); store.set("compact", on); });
  }
  $("sheet").classList.toggle("compact", store.get("compact", false));
  $("grab").onclick = () => setCompact(!$("sheet").classList.contains("compact"));
  let swipe = null;
  $("sheet").addEventListener("touchstart", (e) => {
    // Leave the format list free to scroll
    if (e.target.closest(".rows") || document.body.classList.contains("navigating")) return (swipe = null);
    swipe = { y: e.touches[0].clientY, moved: false };
  }, { passive: true });
  $("sheet").addEventListener("touchmove", (e) => {
    if (swipe && Math.abs(e.touches[0].clientY - swipe.y) > 10) swipe.moved = true;
  }, { passive: true });
  $("sheet").addEventListener("touchend", (e) => {
    if (!swipe) return;
    const dy = e.changedTouches[0].clientY - swipe.y;
    if (dy > 35) setCompact(true);
    else if (dy < -35) setCompact(false);
    // A swipe that starts on the grid ref mustn't also copy it
    if (swipe.moved) { swallowClick = true; setTimeout(() => (swallowClick = false), 400); }
    swipe = null;
  });
  let swallowClick = false;
  $("sheet").addEventListener("click", (e) => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true);

  // ---------- navigate: map + compass to the crosshair point ----------
  let nav = null, heading = null, wakeLock = null, navLine = null, navFlag = null;
  // The compass only turns the dial: readings arrive ~60 times a second, so they just
  // update a number and one animation frame draws it. Distance, grid ref and the map
  // line are redrawn on GPS fixes only.
  let compassAcc = null, navBrgDeg = 0, frame = 0, shownRose = 0, shownArrow = 0, course = null;
  const diff = (a, b) => ((((b - a) % 360) + 540) % 360) - 180; // shortest turn from a to b
  // A phone compass is often wrong for the first few seconds (and when held upright, or near
  // a car or magnetic case) while still sounding sure of itself. So the arrow stays grey,
  // with a "settling" message, until: the phone says it's within 25°, a couple of seconds
  // have passed, the phone is roughly flat, and, when walking, it agrees with GPS direction.
  let compassSince = 0, tilt = 0, disagree = 0;
  function compassTrusted() {
    if (heading == null) return false;
    if (Date.now() - compassSince < 2500) return false;
    if (compassAcc != null && (compassAcc < 0 || compassAcc > 25)) return false;
    if (Math.abs(tilt) > 60) return false;
    return disagree < 3;
  }
  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === "number" && e.webkitCompassHeading >= 0) {
      h = e.webkitCompassHeading; // iPhone: magnetic north, ~0.5° from true in Cumbria
      compassAcc = e.webkitCompassAccuracy;
    } else if (e.absolute && typeof e.alpha === "number") h = (360 - e.alpha) % 360; // Android
    if (typeof e.beta === "number") tilt = e.beta;
    if (h != null && heading == null) compassSince = Date.now();
    if (h == null) return;
    heading = heading == null ? h : (heading + diff(heading, h) * 0.35 + 360) % 360;
    if (nav && !frame) frame = requestAnimationFrame(drawDial);
  }
  // Which way the phone (or, walking with no compass, the person) is facing
  function facing() {
    if (heading != null) return { deg: heading, src: "compass" };
    if (course != null) return { deg: course, src: "travel" };
    return { deg: 0, src: "none" };
  }
  function drawDial() {
    frame = 0;
    if (!nav) return;
    const f = facing();
    // Turn by the shortest way from where the dial is now, so passing north never spins it
    shownRose += diff(shownRose, -f.deg);
    shownArrow += diff(shownArrow, navBrgDeg - f.deg);
    $("rose").style.transform = `rotate(${shownRose}deg)`;
    $("arrow").style.transform = `rotate(${shownArrow}deg)`;
    document.querySelector(".dial").classList.toggle("unsure", f.src === "compass" && !compassTrusted());
  }
  async function compassOn() {
    // iPhone asks permission, and only from a tap
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      try { if ((await DeviceOrientationEvent.requestPermission()) !== "granted") return false; } catch { return false; }
    }
    window.addEventListener("deviceorientationabsolute", onOrient);
    window.addEventListener("deviceorientation", onOrient);
    return true;
  }
  function compassOff() {
    compassSince = 0;
    disagree = 0;
    window.removeEventListener("deviceorientationabsolute", onOrient);
    window.removeEventListener("deviceorientation", onOrient);
    heading = null;
  }
  // Arriving: the panel goes green with a tick, the phone buzzes, and a short quiet chime
  // plays. iPhone web apps can't vibrate, so the chime is what you'll notice in a pocket.
  // Sound has to be switched on by a tap first, so tapping Navigate readies it.
  let chime = null;
  function unlockChime() {
    try {
      chime = chime || new (window.AudioContext || window.webkitAudioContext)();
      if (chime.state === "suspended") chime.resume();
    } catch { chime = null; }
  }
  function announceArrival() {
    try { navigator.vibrate && navigator.vibrate([180, 90, 180, 90, 320]); } catch {}
    [0, 160, 320].forEach((t) => setTimeout(haptic, t));
    if (!chime) return;
    try {
      const now = chime.currentTime;
      [[784, 0], [1047, 0.16]].forEach(([f, at]) => { // G5 then C6: a rising "found it"
        const o = chime.createOscillator(), g = chime.createGain();
        o.type = "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0, now + at);
        g.gain.linearRampToValueAtTime(0.18, now + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, now + at + 0.5);
        o.connect(g).connect(chime.destination);
        o.start(now + at);
        o.stop(now + at + 0.55);
      });
    } catch {}
  }
  function drawNav() {
    if (!nav) return;
    const to = L.latLng(nav.lat, nav.lon);
    if (!here) {
      $("navDist").textContent = "—";
      $("navBrg").textContent = gpsBlocked ? "Location is blocked" : "Finding you…";
      $("navDeg").textContent = "";
      $("navAcc").textContent = gpsBlocked ? "Settings › Privacy & Security › Location Services › Safari Websites › While Using" : "";
      return;
    }
    const me = L.latLng(here.lat, here.lon), d = me.distanceTo(to), brg = bearing(me, to);
    // Arrived within GPS accuracy; it takes a few metres more to "leave" again, so a GPS
    // wobble at the spot doesn't flick it on and off
    const arrived = nav.arrived ? d <= Math.max(15, here.acc * 1.5) : d <= Math.max(8, here.acc);
    if (arrived && !nav.arrived) announceArrival();
    nav.arrived = arrived;
    sheet.classList.toggle("arrived", arrived);
    $("navDist").textContent = arrived ? "You've arrived" : fmtDist(d);
    $("navBrg").textContent = arrived ? `Within GPS accuracy` : `Head ${POINT_NAMES[Math.round(brg / 45) % 8]}`;
    $("navDeg").textContent = arrived ? "" : `${String(Math.round(brg) % 360).padStart(3, "0")}°`;
    $("navAcc").textContent = `You: ${OSGB.gridRef(OSGB.wgs84ToGrid(here.lat, here.lon).e, OSGB.wgs84ToGrid(here.lat, here.lon).n, digits)} · ±${Math.round(here.acc)} m`;
    navBrgDeg = brg;
    drawDial();
    document.querySelector(".dial").classList.toggle("here", arrived);
    const f = facing();
    $("navHint").textContent = arrived ? ""
      : f.src === "compass" ? (compassTrusted() ? "Hold flat. Keep away from magnets: phone case, car, gates."
        : Math.abs(tilt) > 60 ? "Hold the phone flatter: the compass only works lying roughly flat."
        : disagree >= 3 ? "Compass disagrees with your walking direction: wave the phone in a figure-of-8, away from metal or a magnetic case."
        : "Compass settling (grey arrow). Hold flat; if it stays grey, wave the phone in a figure-of-8.")
      : f.src === "travel" ? "No compass: the arrow follows your direction of walking. Keep moving."
      : "No compass on this phone: the arrow is drawn with north at the top. Use the map and bearing.";
    const line = [me, to];
    if (navLine) navLine.setLatLngs(line);
    else navLine = L.polyline(line, { color: "#c0392b", weight: 3, dashArray: "6 8", interactive: false }).addTo(map);
    // Keep both ends on screen while walking
    const b = map.getBounds().pad(-0.1);
    if (!b.contains(me) || !b.contains(to)) fitNav();
  }
  function fitNav() {
    if (!nav) return;
    const pts = [[nav.lat, nav.lon]];
    if (here) pts.push([here.lat, here.lon]);
    map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [40, 90], paddingBottomRight: [70, sheet.offsetHeight + 30], maxZoom: 17, animate: false });
  }
  $("navBtn").onclick = async () => {
    if (!last || !last.ref) return toast("Outside the GB grid: move the crosshair onto Britain");
    if (following) return toast("Move the crosshair to where you want to go, then tap Navigate");
    nav = { lat: last.lat, lon: last.lon, view: { c: map.getCenter(), z: map.getZoom() } };
    unlockChime();
    $("navRef").textContent = last.ref;
    document.body.classList.add("navigating");
    layout();
    navFlag = L.marker([nav.lat, nav.lon], { interactive: false, icon: L.divIcon({ className: "flag", html: "🚩", iconSize: [30, 30], iconAnchor: [6, 28] }) }).addTo(map);
    const compass = await compassOn();
    if (!compass) toast("Compass not allowed. The map and distance still work");
    startGps(false);
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch {}
    fitNav();
    drawNav();
  };
  $("navEnd").onclick = () => {
    const to = nav;
    nav = null;
    sheet.classList.remove("arrived");
    compassOff();
    if (navLine) { map.removeLayer(navLine); navLine = null; }
    if (navFlag) { map.removeLayer(navFlag); navFlag = null; }
    try { wakeLock && wakeLock.release(); } catch {}
    wakeLock = null;
    document.body.classList.remove("navigating");
    layout();
    if (to) map.setView(to.view.c, to.view.z, { animate: false }); // back exactly where you started
    update();
  };
  // The wake lock drops when the phone sleeps or the app is switched away
  document.addEventListener("visibilitychange", async () => {
    if (nav && document.visibilityState === "visible") { try { wakeLock = await navigator.wakeLock.request("screen"); } catch {} }
  });

  // ---------- offline OS maps: download themselves, take over with no signal ----------
  // Tiles for the reserves are cut from OS OpenMap Local (build/build_tiles.py) and hosted
  // here. The app quietly downloads them all when it has signal; the service worker then
  // serves them with none. maps/index.json lists every tile.
  const offlineOverlay = L.tileLayer("maps/{z}/{x}/{y}.webp", { minZoom: 10, maxNativeZoom: 17, maxZoom: 19, errorTileUrl: BLANK, zIndex: 5 });
  const pack = {
    state: "idle", done: 0, total: 0, mb: 0, reserves: 0,
    text() {
      if (this.state === "ready") return `✓ Offline maps ready (${this.reserves} reserves)`;
      if (this.state === "downloading") return `Offline maps downloading: ${Math.round((this.done / (this.total || 1)) * 100)}% of ${this.mb} MB`;
      if (this.state === "failed") return "Offline maps paused. Tap to retry";
      return "Offline maps: waiting for signal";
    },
  };
  async function downloadPack() {
    if (!("caches" in window) || pack.state === "downloading") return;
    let idx;
    try { idx = await (await fetch("maps/index.json", { cache: "no-cache" })).json(); } catch { pack.state = "failed"; return; }
    pack.reserves = idx.reserves.length;
    pack.names = idx.reserves;
    pack.mb = Math.round(idx.bytes / 1e6);
    if (store.get("pack", "") === idx.version) { pack.state = "ready"; return; }
    const cache = await caches.open("gridref-maps");
    const missing = async () => {
      const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname.split("/maps/")[1]));
      return idx.tiles.filter((t) => !have.has(t));
    };
    let todo = await missing();
    pack.total = idx.tiles.length;
    pack.done = pack.total - todo.length;
    pack.state = "downloading";
    if (todo.length > 50) toast(`Downloading offline maps (${pack.mb} MB)`);
    // A few requests can fail in a rush or on patchy signal: go round again for the gaps,
    // and only give up if a whole pass gets nothing (no signal)
    for (let pass = 0; pass < 5 && todo.length; pass++) {
      let got = 0;
      const queue = todo.slice();
      const worker = async () => {
        while (queue.length) {
          const t = queue.shift();
          try {
            const r = await fetch("maps/" + t);
            if (r.ok) { await cache.put("maps/" + t, r); pack.done++; got++; }
          } catch {}
        }
      };
      await Promise.all(Array.from({ length: 14 }, worker)); // GitHub serves over HTTP/2, so many at once is fine
      todo = await missing();
      pack.done = pack.total - todo.length;
      if (!got) break;
    }
    if (todo.length) { pack.state = "failed"; return; }
    // Tiles from reserves taken out of the pack: free the space
    const keep = new Set(idx.tiles);
    for (const r of await cache.keys()) { const t = new URL(r.url).pathname.split("/maps/")[1]; if (t !== "index.json" && !keep.has(t)) cache.delete(r); }
    store.set("pack", idx.version);
    pack.state = "ready";
    toast("✓ Offline maps ready");
  }

  // No signal: lay the OS map over whatever map is showing (aerial photos can't be kept,
  // so that switches to the topo map underneath). Signal back: put it all back.
  let offlineMode = false, swappedFrom = null, tileErrors = [], probe = null;
  function goOffline() {
    if (offlineMode) return;
    offlineMode = true;
    if (current === "aerial") { swappedFrom = "aerial"; setBase("topo"); }
    if (current !== "os") offlineOverlay.addTo(map);
    toast("Switching to offline maps");
    clearInterval(probe);
    probe = setInterval(async () => {
      try { await fetch("version.json", { cache: "no-store" }); goOnline(); } catch {}
    }, 20000);
  }
  function goOnline() {
    if (!offlineMode) return;
    offlineMode = false;
    clearInterval(probe);
    map.removeLayer(offlineOverlay);
    if (swappedFrom) { setBase(swappedFrom); swappedFrom = null; }
    toast("Back online: normal maps");
    if (pack.state !== "ready") downloadPack();
  }
  // Phones often claim to be online with no usable signal, so also watch for map tiles
  // failing to load: several in a few seconds means no signal.
  for (const k of ["topo", "aerial"]) {
    LAYERS[k].layer.on("tileerror", () => {
      const now = Date.now();
      tileErrors = tileErrors.filter((t) => now - t < 6000).concat(now);
      if (tileErrors.length >= 4) goOffline();
    });
  }
  window.addEventListener("offline", goOffline);
  window.addEventListener("online", goOnline);

  // ---------- reserve boundaries (Natural England, live when there's signal) ----------
  const NNR_LIVE = "https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/National_Nature_Reserves_England/FeatureServer/0/query?where=1%3D1&geometry=290000,440000,400000,600000&geometryType=esriGeometryEnvelope&inSR=27700&spatialRel=esriSpatialRelIntersects&outFields=NAME,LABEL,REF_CODE,MEASURE&outSR=4326&geometryPrecision=5&maxAllowableOffset=0.00003&f=geojson";
  const nnrLayer = L.geoJSON(null, { interactive: false, style: { color: "#0b7a3b", weight: 2.5, opacity: 0.85, dashArray: "8 5", fillColor: "#0b7a3b", fillOpacity: 0.05 } }).addTo(map);
  let nnr = [];
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // "Roudsea 10:42": the reserve you're in (or what it is) and the time
  function autoName(kind, lat, lon, when = new Date()) {
    const r = lat != null ? reserveShort(L.latLng(lat, lon)) : "";
    return `${r || { line: "Line", area: "Area", photo: "Photo" }[kind] || "Point"} ${timeOf(when.toISOString())}`;
  }
  // The team's short name for the reserve at a spot ("Roudsea"), or ""
  function reserveShort(ll) {
    const f = reserveFeatureAt(ll);
    return f ? TEAM.get(f.properties.REF_CODE) || f.properties.LABEL : "";
  }
  function reserveAt(ll) { const f = reserveFeatureAt(ll); return f ? f.properties.LABEL : ""; }
  function reserveFeatureAt(ll) {
    for (const f of nnr) {
      const [w, s2, e, n] = f.bbox;
      if (ll.lng < w || ll.lng > e || ll.lat < s2 || ll.lat > n) continue;
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        if (inRing(ll.lng, ll.lat, poly[0]) && !poly.slice(1).some((h) => inRing(ll.lng, ll.lat, h))) return f;
      }
    }
    return "";
  }
  // The South Cumbria team's reserves (NE NNR REF_CODE -> short name)
  // A Map keeps this order (a plain object would sort the number-like codes). These are the
  // only reserves drawn: other NNRs are left off so the map shows the team's patch.
  const TEAM = new Map([["1006114", "Walney"], ["1006954", "Duddon"], ["1006126", "Roudsea"], ["1006058", "Gait Barrows"], ["1006067", "Hallsenna"], ["1006018", "Blelham Bog"], ["1006111", "North Fen"]]);
  const isTeam = (f) => TEAM.has(f.properties && f.properties.REF_CODE);
  // Burnt orange: nothing on the topo map uses it, and tiles stay light in dark mode
  const RESERVE = "#d9480f";
  nnrLayer.options.style = () => ({ color: RESERVE, weight: 3, opacity: 0.95, fillColor: RESERVE, fillOpacity: map.getZoom() < 14 ? 0.14 : 0.04 });
  const resLabels = L.layerGroup().addTo(map);
  function drawResLabels() {
    resLabels.clearLayers();
    if (map.getZoom() > 13) return;
    for (const f of nnr) if (isTeam(f)) {
      const c = L.geoJSON(f).getBounds().getCenter();
      L.marker(c, { interactive: false, icon: L.divIcon({ className: "", html: `<div class="reslabel">${TEAM.get(f.properties.REF_CODE)}</div>`, iconSize: [0, 0] }) }).addTo(resLabels);
    }
  }
  map.on("zoomend", () => { nnrLayer.setStyle(nnrLayer.options.style); drawResLabels(); });
  function drawChips() {
    const last = store.get("lastReserve", "");
    $("chips").innerHTML = "";
    for (const [code, name] of TEAM) {
      const f = nnr.find((x) => x.properties.REF_CODE === code);
      if (!f) continue;
      const b = document.createElement("button");
      b.textContent = name;
      b.className = code === last ? "on" : "";
      b.onclick = () => {
        store.set("lastReserve", code);
        following = false;
        $("locBtn").classList.remove("on");
        map.fitBounds(L.geoJSON(f).getBounds(), { paddingTopLeft: [30, 110], paddingBottomRight: [70, sheet.offsetHeight + 20], maxZoom: 16, animate: false });
        drawChips();
      };
      $("chips").appendChild(b);
    }
  }
  function useNNR(gj) {
    if (!gj || !gj.features || !gj.features.length) return false;
    gj = { ...gj, features: gj.features.filter(isTeam) };
    if (!gj.features.length) return false;
    nnr = gj.features.map((f) => {
      const b = L.geoJSON(f).getBounds();
      return { ...f, bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] };
    });
    nnrLayer.clearLayers().addData(gj);
    drawResLabels();
    drawChips();
    update();
    return true;
  }
  async function loadNNR() {
    // Live from Natural England first (always current); the copy shipped with the app if not
    try { if (useNNR(await (await fetch(NNR_LIVE)).json())) return; } catch {}
    try { useNNR(await (await fetch("data/nnr.geojson")).json()); } catch {}
  }
  map.attributionControl.addAttribution("Reserve boundaries © Natural England");

  // ---------- measure: points at the crosshair (or GPS), distance and area ----------
  // Area is worked out on the OS grid (flat metres), which is what a ranger would measure on a map.
  let measure = null, mLine = null, mLive = null, mDots = null;
  function mStats(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += pts[i - 1].distanceTo(pts[i]);
    let area = null;
    if (pts.length >= 3) {
      const g = pts.map((p) => OSGB.wgs84ToGrid(p.lat, p.lng));
      let a = 0;
      for (let i = 0; i < g.length; i++) { const j = (i + 1) % g.length; a += g[i].e * g[j].n - g[j].e * g[i].n; }
      area = Math.abs(a) / 2;
    }
    return { d, area };
  }
  const fmtArea = (m2) => `${(m2 / 10000).toFixed(m2 < 100000 ? 2 : 1)} ha (${Math.round(m2).toLocaleString("en-GB")} m²)`;
  // Two tools: the ruler measures a line (walls, fences, hedges), the area tool measures an
  // area (bracken, scrub). Numbers are for the points added; the dotted line is the next one.
  function drawMeasure() {
    if (!measure) return;
    const pts = measure.pts, t = target(), isArea = measure.kind === "area";
    mLine.setLatLngs(isArea && pts.length >= 3 ? pts.concat([pts[0]]) : pts);
    mLive.setLatLngs(pts.length ? [pts[pts.length - 1], t] : []);
    mDots.clearLayers();
    // Big enough to see past the crosshair; the first one ringed so you know you've started
    pts.forEach((p, i) => L.circleMarker(p, { radius: i ? 6 : 8, color: "#fff", weight: 3, fillColor: "#c0392b", fillOpacity: 1, interactive: false }).addTo(mDots));
    const st = mStats(isArea && pts.length >= 3 ? pts.concat([pts[0]]) : pts);
    $("mDist").textContent = fmtDist(st.d);
    const a = isArea && pts.length >= 3 ? mStats(pts).area : null;
    $("mArea").textContent = a != null ? `${Math.round(a).toLocaleString("en-GB")} m²` : "—";
    $("mHa").textContent = a != null ? `${(a / 10000).toFixed(a < 100000 ? 2 : 1)} ha` : "—";
    for (const id of ["mDist", "mArea", "mHa"]) fitNum($(id));
  }
  // Big numbers shrink to stay on one line in their box (no "m²" dropping to a new line)
  function fitNum(el) {
    el.style.fontSize = "";
    if (!el.offsetWidth) return;
    let s = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth && s > 14) el.style.fontSize = --s + "px";
  }
  function startMeasure(kind) {
    measure = { kind, pts: [] };
    mLine = L.polyline([], { color: "#c0392b", weight: 3, interactive: false }).addTo(map);
    mLive = L.polyline([], { color: "#c0392b", weight: 2, dashArray: "4 6", interactive: false }).addTo(map);
    mDots = L.layerGroup().addTo(map);
    // Switch the panel inside keepTarget, so the place under the crosshair is read before
    // the panel changes height (reading it after made the crosshair land somewhere else)
    keepTarget(() => {
      document.body.classList.toggle("area-mode", kind === "area");
      document.body.classList.add("measuring");
    });
    drawMeasure();
  }
  $("measureBtn").onclick = () => startMeasure("line");
  $("areaBtn").onclick = () => startMeasure("area");
  $("mAdd").onclick = () => { measure.pts.push(target()); drawMeasure(); toast(`Point ${measure.pts.length} added`); };
  $("mUndo").onclick = () => { if (!measure.pts.length) return; measure.pts.pop(); drawMeasure(); toast(measure.pts.length ? `Back to ${measure.pts.length} point${measure.pts.length > 1 ? "s" : ""}` : "No points"); };
  $("mSave").onclick = () => {
    const pts = measure.pts, isArea = measure.kind === "area";
    if (pts.length < (isArea ? 3 : 2)) return toast(isArea ? "Add at least 3 corners" : "Add at least 2 points");
    const st = mStats(pts), first = OSGB.wgs84ToGrid(pts[0].lat, pts[0].lng);
    openSave({
      kind: measure.kind,
      pts: pts.map((q) => [+q.lat.toFixed(6), +q.lng.toFixed(6)]),
      lat: pts[0].lat, lon: pts[0].lng, e: Math.round(first.e), n: Math.round(first.n),
      length: Math.round(st.d), area: isArea ? Math.round(st.area) : null, acc: null,
    });
  };
  $("mDone").onclick = () => {
    measure = null;
    for (const l of [mLine, mLive, mDots]) map.removeLayer(l);
    keepTarget(() => document.body.classList.remove("measuring", "area-mode"));
  };
  for (const id of ["mDist", "mArea", "mHa"]) $(id).parentElement.onclick = () => { const v = $(id).textContent; if (v !== "—") copy(v, $(id).parentElement); };
  map.on("move", () => { if (measure) drawMeasure(); });

  // ---------- photo with the grid ref stamped on ----------
  // Take one: placed by GPS if the blue dot is on, otherwise the crosshair.
  // Choose one from the phone: placed where the photo says it was taken, otherwise the crosshair.
  const photoMenu = $("photoMenu");
  $("photoBtn").onclick = () => {
    if (photoMenu.style.display === "block") return (photoMenu.style.display = "none");
    const b = $("photoBtn").getBoundingClientRect();
    photoMenu.style.left = b.right + 10 + "px";
    photoMenu.style.top = b.top + "px";
    photoMenu.style.display = "block";
  };
  $("pmTake").onclick = () => { photoMenu.style.display = "none"; $("photoIn").click(); };
  $("pmPick").onclick = () => { photoMenu.style.display = "none"; $("photoPick").click(); };
  $("photoIn").onchange = (e) => stampPhoto(e, false);
  $("photoPick").onchange = (e) => stampPhoto(e, true);
  async function stampPhoto(e, fromPhone) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    toast("Stamping the photo…");
    const ex = fromPhone ? await EXIF.read(file) : {};
    const where = ex.lat != null ? { lat: ex.lat, lon: ex.lon, src: "Photo's location" }
      : here && !fromPhone ? { lat: here.lat, lon: here.lon, src: `GPS ±${Math.round(here.acc)} m` }
      : { lat: last.lat, lon: last.lon, src: "Crosshair" };
    if (fromPhone && ex.lat == null) toast("No location in that photo: placed at the crosshair");
    const g = OSGB.wgs84ToGrid(where.lat, where.lon);
    const ref = OSGB.gridRef(g.e, g.n, digits) || `${where.lat.toFixed(5)}, ${where.lon.toFixed(5)}`;
    const when = ex.when || (fromPhone && file.lastModified ? new Date(file.lastModified) : new Date());
    const reserve = nnr.length ? reserveAt(L.latLng(where.lat, where.lon)) : "";
    const img = new Image();
    img.src = URL.createObjectURL(file);
    try { await img.decode(); } catch { return toast("Couldn't read that photo"); }
    // Big phone photos are scaled to 2400 px on the long side: plenty, and quick to share
    const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const base = document.createElement("canvas");
    base.width = Math.round(img.naturalWidth * k);
    base.height = Math.round(img.naturalHeight * k);
    base.getContext("2d").drawImage(img, 0, 0, base.width, base.height);
    URL.revokeObjectURL(img.src);
    const pad2 = (v) => String(v).padStart(2, "0");
    const stamp = `${when.getFullYear()}${pad2(when.getMonth() + 1)}${pad2(when.getDate())}_${pad2(when.getHours())}${pad2(when.getMinutes())}`; // local time
    stampJob = { base, name: `${ref.replace(/\s+/g, "")}_${stamp}.jpg`, ref, ll: `${where.lat.toFixed(5)}, ${where.lon.toFixed(5)}`,
      when: `${when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} ${timeOf(when.toISOString())}`,
      reserve: reserve.replace(/ \(NNR\)$/, ""), src: where.src };
    photoNew = { lat: where.lat, lon: where.lon, e: Math.round(g.e), n: Math.round(g.n), acc: where.src.startsWith("GPS") ? Math.round(here.acc) : null,
      name: autoName("photo", where.lat, where.lon, when) };
    $("photoSave").hidden = false;
    drawStampOpts();
    await restamp();
    // Sharing needs a fresh tap (the camera one has expired by now), so show it with a button.
    // On iPhone the share sheet has "Save Image" for the Photos library.
    $("photoModal").hidden = false;
  }
  // What goes on the stamp: tick and it redraws. Remembered for next time.
  const STAMP_OPTS = [["ref", "Grid ref"], ["ll", "Lat/long"], ["when", "Date & time"], ["reserve", "Reserve"], ["src", "GPS / crosshair"]];
  let stampJob = null, stampOn = new Set(store.get("stampOpts", ["ref", "when", "reserve"]));
  function drawStampOpts() {
    $("stampOpts").hidden = false;
    $("stampOpts").innerHTML = STAMP_OPTS.filter(([k]) => k !== "reserve" || stampJob.reserve)
      .map(([k, l]) => `<button type="button" data-k="${k}" class="${stampOn.has(k) ? "on" : ""}">${l}</button>`).join("");
  }
  $("stampOpts").onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b || !stampJob) return;
    stampOn.has(b.dataset.k) ? stampOn.delete(b.dataset.k) : stampOn.add(b.dataset.k);
    store.set("stampOpts", [...stampOn]);
    drawStampOpts();
    await restamp();
  };
  // A compact label in the bottom-left corner, only as wide as its words
  async function restamp() {
    const j = stampJob, c = document.createElement("canvas");
    c.width = j.base.width;
    c.height = j.base.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(j.base, 0, 0);
    const u = Math.round(Math.min(c.width, c.height * 1.4) / 42); // text size scales with the photo
    const small = `600 ${u}px -apple-system, sans-serif`, big = `700 ${Math.round(u * 1.35)}px ui-monospace, Menlo, monospace`;
    const lines = [];
    const head = stampOn.has("ref") ? j.ref : stampOn.has("ll") ? j.ll : "";
    if (head) lines.push({ t: head, f: big });
    const sub = [stampOn.has("ll") && stampOn.has("ref") ? j.ll : "", stampOn.has("when") ? j.when : "", stampOn.has("src") ? j.src : ""].filter(Boolean).join(" · ");
    if (sub) lines.push({ t: sub, f: small });
    if (stampOn.has("reserve") && j.reserve) lines.push({ t: j.reserve, f: small });
    if (lines.length) {
      const pad = Math.round(u * 0.6), m = Math.round(u * 0.8), lh = (l) => parseInt(l.f.match(/(\d+)px/)[1]) * 1.28;
      const w = Math.max(...lines.map((l) => { ctx.font = l.f; return ctx.measureText(l.t).width; })) + pad * 2;
      const h = lines.reduce((s, l) => s + lh(l), 0) + pad * 2 - u * 0.2;
      ctx.fillStyle = "rgba(0,0,0,.5)";
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(m, c.height - m - h, w, h, u * 0.5) : ctx.rect(m, c.height - m - h, w, h);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "top";
      let y = c.height - m - h + pad;
      for (const l of lines) { ctx.font = l.f; ctx.fillText(l.t, m + pad, y); y += lh(l); }
    }
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
    photoFile = new File([blob], j.name, { type: "image/jpeg" });
    if ($("photoOut").src.startsWith("blob:")) URL.revokeObjectURL($("photoOut").src);
    $("photoOut").src = URL.createObjectURL(photoFile);
  }
  let photoFile = null, photoNew = null;
  $("photoSave").onclick = async () => {
    if (!photoFile || !photoNew) return;
    const id = "ph" + Date.now();
    try { await photoDB.put(id, photoFile); } catch { return toast("Couldn't save the photo on this phone"); }
    fresh();
    points.unshift({ kind: "photo", photoId: id, notes: "", colour: "black", ...photoNew, at: new Date().toISOString() });
    persist();
    savePoints();
    closePhoto();
    toast("✓ Saved");
  };
  async function viewPhoto(pt) {
    let blob;
    try { blob = await photoDB.get(pt.photoId); } catch {}
    if (!blob) return toast("That photo isn't on this phone any more");
    photoFile = new File([blob], `${pt.name.replace(/[^\w-]+/g, "_")}.jpg`, { type: "image/jpeg" });
    photoNew = null;
    stampJob = null;
    $("stampOpts").hidden = true;
    $("photoSave").hidden = true;
    $("photoOut").src = URL.createObjectURL(blob);
    $("photoModal").hidden = false;
  }
  $("photoShare").onclick = async () => {
    if (!photoFile) return;
    if (navigator.canShare && navigator.canShare({ files: [photoFile] })) {
      try { await navigator.share({ files: [photoFile] }); } catch {}
    } else {
      const a = document.createElement("a");
      a.href = $("photoOut").src;
      a.download = photoFile.name;
      a.click();
    }
  };
  function closePhoto() { $("photoModal").hidden = true; URL.revokeObjectURL($("photoOut").src); photoFile = null; photoNew = null; }
  $("photoClose").onclick = closePhoto;

  // ---------- move and reshape saved things ----------
  // Move: the thing follows the crosshair (a dashed preview) until "Place here". Using the
  // crosshair rather than dragging the pin means your finger never hides where it's going.
  // Reshape (lines and areas): drag the big corner handles; length/area update as you go.
  let moving = null;
  const moveLayer = L.layerGroup().addTo(map);
  const shiftPts = (pts, dLat, dLon) => pts.map(([a, b]) => [+(a + dLat).toFixed(6), +(b + dLon).toFixed(6)]);
  function moveStats(pts, kind) {
    const ll = pts.map(([a, b]) => L.latLng(a, b));
    if (kind === "area") return `${fmtArea(mStats(ll).area)} · edge ${fmtDist(mStats(ll.concat([ll[0]])).d)}`;
    return fmtDist(mStats(ll).d);
  }
  function drawMove() {
    if (!moving) return;
    moveLayer.clearLayers();
    const { pt } = moving;
    const col = "#c0392b", style = { color: col, weight: 3, dashArray: "7 6", fillColor: col, fillOpacity: 0.12, interactive: false };
    if (moving.mode === "move") {
      const t = target(), dLat = t.lat - moving.from.lat, dLon = t.lng - moving.from.lng;
      if (pt.pts) {
        const pts = shiftPts(pt.pts, dLat, dLon);
        (pt.kind === "area" ? L.polygon(pts, style) : L.polyline(pts, style)).addTo(moveLayer);
      }
      $("mvInfo").textContent = `${fmtDist(moving.from.distanceTo(t))} from where it was`;
    } else {
      (pt.kind === "area" ? L.polygon(moving.pts, style) : L.polyline(moving.pts, style)).addTo(moveLayer);
      moving.pts.forEach((q, i) => {
        L.marker(q, { draggable: true, icon: L.divIcon({ className: "", html: '<div class="handle"></div>', iconSize: [34, 34], iconAnchor: [17, 17] }) })
          .on("drag", (e) => { const ll = e.target.getLatLng(); moving.pts[i] = [+ll.lat.toFixed(6), +ll.lng.toFixed(6)]; redrawShape(); })
          .addTo(moveLayer);
      });
      $("mvInfo").textContent = moveStats(moving.pts, pt.kind);
    }
  }
  // While dragging a handle, only the outline and numbers change (redrawing the handles would drop the drag)
  function redrawShape() {
    moveLayer.eachLayer((l) => { if (l.setLatLngs) l.setLatLngs(moving.pts); });
    $("mvInfo").textContent = moveStats(moving.pts, moving.pt.kind);
  }
  function startMove(pt, mode) {
    closeDrawer();
    $("featMenu").style.display = "none";
    following = false;
    $("locBtn").classList.remove("on");
    const c = centreOf(pt);
    moving = { pt, mode, from: L.latLng(c.lat, c.lon), pts: pt.pts ? pt.pts.map((q) => q.slice()) : null };
    $("mvTitle").textContent = (mode === "move" ? "Moving " : "Reshaping ") + pt.name;
    $("mvHint").textContent = mode === "move" ? "Drag the map until the crosshair is on the new spot." : "Drag the round handles to move each corner.";
    $("mvGo").textContent = mode === "move" ? "Place here" : "Save shape";
    keepTarget(() => document.body.classList.add("moving", mode === "move" ? "move-mode" : "shape-mode"));
    if (mode === "move") panTo(moving.from, map.getZoom(), false);
    else map.fitBounds(L.latLngBounds(pt.pts), { paddingTopLeft: [40, 80], paddingBottomRight: [40, sheet.offsetHeight + 30], maxZoom: 18 });
    drawMove();
  }
  function endMove() {
    moving = null;
    moveLayer.clearLayers();
    keepTarget(() => document.body.classList.remove("moving", "move-mode", "shape-mode"));
  }
  map.on("move", () => { if (moving && moving.mode === "move") drawMove(); });
  $("mvCancel").onclick = endMove;
  $("mvGo").onclick = () => {
    fresh();
    const i = points.findIndex((q) => q.at === moving.pt.at && q.name === moving.pt.name);
    if (i < 0) return endMove();
    const p = { ...points[i] };
    if (moving.mode === "move") {
      const t = target(), dLat = t.lat - moving.from.lat, dLon = t.lng - moving.from.lng;
      if (p.pts) p.pts = shiftPts(p.pts, dLat, dLon);
      p.lat = p.pts ? p.pts[0][0] : t.lat;
      p.lon = p.pts ? p.pts[0][1] : t.lng;
    } else {
      p.pts = moving.pts;
      p.lat = p.pts[0][0];
      p.lon = p.pts[0][1];
    }
    const g = OSGB.wgs84ToGrid(p.lat, p.lon);
    p.e = Math.round(g.e);
    p.n = Math.round(g.n);
    p.acc = null; // no longer where the GPS put it
    points[i] = p;
    const name = p.name, mode = moving.mode;
    endMove();
    if (savePoints()) toast(mode === "move" ? `✓ Moved ${name}` : `✓ Reshaped ${name}`);
  };

  // ---------- a haptic tick on every tap (field tool: you should feel it worked) ----------
  // iPhone (iOS 18+) ticks when a switch is flipped through its label, and only inside the
  // tap itself, so each tap flips a throwaway switch. Android just vibrates.
  function haptic() {
    try { navigator.vibrate && navigator.vibrate(12); } catch {}
    try {
      const l = document.createElement("label"), i = document.createElement("input");
      i.type = "checkbox";
      i.setAttribute("switch", "");
      i.className = "hx";
      l.className = "hx";
      l.style.cssText = "position:fixed;left:-99px;top:0;opacity:0";
      l.appendChild(i);
      document.body.appendChild(l);
      l.click();
      l.remove();
    } catch {}
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest(".hx, #hapticSw, [data-copy]")) return; // copy rows already tick through their own switch
    if (e.target.closest("button, a, .item .main, .shopts label, .leaflet-marker-icon")) haptic();
  }, true);

  // ---------- opened from a shared link: …/gridref/?q=SD 3390 8360 ----------
  // Anything the search box understands works: grid ref, lat/long, E/N, postcode, place.
  (function openShared() {
    const params = new URLSearchParams(location.search), q = params.get("q");
    if (!q) return;
    params.delete("q");
    history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : ""));
    setTimeout(async () => {
      $("q").value = q;
      await search(q, true);
      $("q").value = "";
      toast("Shared location: " + q);
    }, 400);
  })();

  // ---------- install nudge ----------
  // Offline maps and saved points only work properly from the Home Screen icon, and only
  // Safari can add one on iPhone. So: in Edge/Chrome, say "open in Safari"; in Safari, say
  // how to add it. Never shown once installed; dismissing hides it for a fortnight.
  (function installNudge() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const installed = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
    const snoozed = Date.now() - store.get("instSnooze", 0) < 14 * 86400000;
    if (!ios || installed || snoozed) return;
    const otherBrowser = /CriOS|EdgiOS|FxiOS|OPiOS|GSA\//.test(navigator.userAgent);
    $("instText").textContent = otherBrowser
      ? "Open this page in Safari to install it. Offline maps and your saved points need the Safari version."
      : "Tap ••• next to the web address, then Share, then “Add to Home Screen”. Open it from that icon from then on.";
    $("install").hidden = false;
    $("instClose").onclick = () => { $("install").hidden = true; store.set("instSnooze", Date.now()); };
  })();

  // ---------- go ----------
  window.addEventListener("resize", () => { layout(); fitRef(); update(); });
  // Every launch opens on the team's patch, Walney to Gait Barrows, framed in the clear map
  // between the reserve chips, the side buttons and the panel
  const openOnPatch = () => {
    layout();
    map.fitBounds([[54.118, -3.292], [54.198, -2.785]], {
      paddingTopLeft: [68, 104], paddingBottomRight: [68, sheet.offsetHeight + 10], animate: false });
  };
  for (const step of [() => setPrec(digits), openOnPatch, drawPins, drawGrid, loadNNR, () => { if (!navigator.onLine) goOffline(); }]) {
    try { step(); } catch (e) { console.error(e); }
  }
  setTimeout(() => { if (navigator.onLine) downloadPack(); }, 4000);
  layout();
  update();
  // Any browser (Edge and Chrome on iPhone have no service worker): ask GitHub which
  // version is current and, if this page is older, load the new one. The ?v= makes the
  // browser fetch a fresh page instead of reusing its cached copy.
  async function checkVersion() {
    try {
      const j = await (await fetch("version.json", { cache: "no-store" })).json();
      if (j.v && j.v !== VERSION && !location.search.includes("v=" + j.v)) {
        const u = new URLSearchParams(location.search);
        u.set("v", j.v);
        location.replace(location.pathname + "?" + u);
      }
    } catch {}
  }
  checkVersion();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkVersion(); });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register("sw.js").then((r) => r.update()).catch(() => {});
    // Check for a new version whenever the app comes back to the front
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
    });
  }
})();
