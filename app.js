// Field Notes: the app. Loaded after Leaflet, osgb.js, parse.js, zip.js and local.js.
(function () {
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("gridref." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("gridref." + k, JSON.stringify(v)); return true; } catch { return false; } },
  };

  // ---------- map ----------
  const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  const OS_KEY = (window.GRIDREF_CONFIG || {}).osKey || "";
  const OS_PROXY = ((window.GRIDREF_CONFIG || {}).osProxy || "").replace(/\/$/, "");
  const LAYERS = {
    aerial: { name: "Aerial photo", layer: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, crossOrigin: true, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" }) },
    // OS Outdoor: proper OS cartography (contours, paths, woods). Two ways in, set in config.js:
    // - osProxy: our Cloudflare Worker (proxy/), which holds a Premium-plan key, so the map
    //   carries on to zoom 20 with OS MasterMap detail (buildings, fences, field boundaries)
    // - osKey: a free OpenData key straight to OS, which stops at zoom 16 and stretches after
    ...(OS_PROXY ? { outdoor: { name: "OS Outdoor", layer: L.tileLayer(`${OS_PROXY}/outdoor/{z}/{x}/{y}.png`, { maxNativeZoom: 20, maxZoom: 20, crossOrigin: true, attribution: "Contains OS data © Crown copyright and database rights 2026" }) } }
      : OS_KEY ? { outdoor: { name: "OS Outdoor", layer: L.tileLayer(`https://api.os.uk/maps/raster/v1/zxy/Outdoor_3857/{z}/{x}/{y}.png?key=${OS_KEY}`, { maxNativeZoom: 16, maxZoom: 19, crossOrigin: true, attribution: "Contains OS data © Crown copyright and database rights 2026" }) } } : {}),
    os: { name: "OS map (offline)", layer: L.tileLayer("maps/{z}/{x}/{y}.webp", { minZoom: 10, maxNativeZoom: 17, maxZoom: 19, errorTileUrl: BLANK }) },
  };
  const start = store.get("view", { lat: 54.25, lon: -2.95, z: 11 });
  const launchQ = new URLSearchParams(location.search).get("q"); // opened from a shared link: go straight there
  // Zoom stops where your fingers stop: whole-step snapping made pinches jump a level after
  // you let go, so it never quite landed where you meant
  const map = L.map("map", { zoomControl: false, attributionControl: true, tap: false, zoomSnap: 0.1, zoomDelta: 1, wheelPxPerZoomLevel: 120, bounceAtZoomLimits: false })
    .setView([start.lat, start.lon], start.z);
  map.attributionControl.addAttribution("OS data © Crown copyright 2026");
  // The credits fold into a small © beside the + button (tap to read them; they fold away
  // again after a few seconds), so a full-width line of small print doesn't fight the map
  map.attributionControl.setPosition("bottomleft");
  map.attributionControl.getContainer().addEventListener("click", (e) => {
    const c = e.currentTarget;
    if (e.target.closest("a")) return;
    c.classList.toggle("open");
    clearTimeout(c._t);
    if (c.classList.contains("open")) c._t = setTimeout(() => c.classList.remove("open"), 6000);
  });
  let current = LAYERS.outdoor ? "outdoor" : "os"; // every launch starts on OS Outdoor (or the offline OS map without a key); a map picked in the layers menu lasts until the app is closed
  LAYERS[current].layer.addTo(map);
  // Zoom no further than the chosen map goes (the shading on its own isn't a map)
  const fitZoom = () => { map.setMaxZoom(LAYERS[current].layer.options.maxZoom || 19); if (map.getZoom() > map.getMaxZoom()) map.setZoom(map.getMaxZoom()); };
  fitZoom();
  // The offline OS map only covers the reserves, and only from zoom 11 in: everywhere else it
  // was a blank (dark in dark mode). So OS Outdoor sits underneath it, shown wherever the
  // offline tiles stop, as long as there's signal.
  LAYERS.os.layer.setZIndex(2);
  function setBase(k) {
    if (k === current) return;
    map.removeLayer(LAYERS[current].layer);
    if (current === "os" && LAYERS.outdoor && k !== "outdoor") map.removeLayer(LAYERS.outdoor.layer);
    current = k;
    if (k === "os" && LAYERS.outdoor) LAYERS.outdoor.layer.addTo(map).setZIndex(1);
    LAYERS[k].layer.addTo(map);
    fitZoom();
    if (offlineOverlay && map.hasLayer(offlineOverlay)) offlineOverlay.bringToFront();
    if (k === "os" && map.getZoom() < 11) toast("Offline map covers the reserves, closer in. OS Outdoor shows out here");
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

  const VERSION = "184"; // bump with each release so a phone can show which copy it's running
  const APP_VERSION = "1.0"; // the version people see; VERSION is the build, bumped by build/release.py
  // On patchy signal a phone can pair an old saved page with this newer code, and the code then
  // trips over buttons the old page doesn't have (it killed the boundaries and pins once). If
  // the page isn't this build's, fetch both fresh, once; offline, carry on as best we can.
  try {
    const m = (document.querySelector('script[src*="app.js"]')?.getAttribute("src") || "").match(/v=(\d+)/);
    if (m && m[1] !== VERSION && sessionStorage.getItem("gridref.pagefix") !== VERSION) {
      sessionStorage.setItem("gridref.pagefix", VERSION);
      location.replace(location.pathname + "?v=" + VERSION);
      return;
    }
  } catch {}
  const layersEl = $("layers");
  // LiDAR shading: the Environment Agency's 1 m ground model, blended over whichever map is
  // showing. Its own pane sits above the maps, so switching map never covers it.
  const shadePane = map.createPane("shade");
  shadePane.style.zIndex = 250;
  let shadePct = store.get("lidarPct", 65); // the slider: how strongly the LiDAR shows through
  shadePane.style.opacity = shadePct / 100;
  const lidarShade = L.tileLayer.wms("https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wms", {
    layers: "Lidar_Composite_Hillshade_DTM_1m", format: "image/png", transparent: true, opacity: 0.55, crossOrigin: true, maxNativeZoom: 19, maxZoom: 19, pane: "shade", className: "lidar", attribution: "LiDAR © Environment Agency" });
  // Round the team's reserves the ground detail is our own, sharper relief (walls, banks,
  // ditches, drains), part of the offline pack so it works with no signal. Elsewhere it's
  // the Environment Agency's online shading. One switch: whichever fits where you're looking.
  const reliefLayer = L.tileLayer("maps/relief/{z}/{x}/{y}.webp", { minZoom: 14, maxNativeZoom: 17, maxZoom: 19, errorTileUrl: BLANK, pane: "shade", attribution: "LiDAR © Environment Agency" });
  let shadeOn = false; // off at every launch
  function nearReserve() {
    const c = map.getCenter();
    return nnr.some((f) => { const [w, s, e, n] = f.bbox; return c.lng > w - 0.008 && c.lng < e + 0.008 && c.lat > s - 0.005 && c.lat < n + 0.005; });
  }
  function drawShade() {
    if (!shadeOn) { map.removeLayer(reliefLayer); map.removeLayer(lidarShade); return; }
    const ours = map.getZoom() >= 14 && nearReserve();
    if (ours) { if (!map.hasLayer(reliefLayer)) reliefLayer.addTo(map); map.removeLayer(lidarShade); }
    else { if (!map.hasLayer(lidarShade)) lidarShade.addTo(map); map.removeLayer(reliefLayer); }
  }
  function setShade(on) {
    shadeOn = on;
    drawShade();
  }
  map.on("moveend", () => { if (shadeOn) drawShade(); });
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
    // LiDAR: a tick to show it, and a slider for how strongly (moving it turns it on)
    const row = document.createElement("div");
    row.className = "lidarrow";
    const sh = document.createElement("button");
    sh.textContent = (shadeOn ? "☑ " : "☐ ") + "LiDAR";
    sh.className = "tick" + (shadeOn ? " on" : "");
    sh.onclick = () => { setShade(!shadeOn); drawLayerMenu(); placeLayerMenu(); };
    const sl = document.createElement("input");
    sl.type = "range";
    sl.min = 0;
    sl.max = 100;
    sl.step = 5;
    sl.value = shadePct;
    sl.setAttribute("aria-label", "LiDAR strength");
    const pct = document.createElement("span");
    pct.textContent = shadePct + "%";
    sl.oninput = () => {
      shadePct = +sl.value;
      shadePane.style.opacity = shadePct / 100;
      pct.textContent = shadePct + "%";
      if (!shadeOn) { setShade(true); sh.textContent = "☑ LiDAR"; sh.classList.add("on"); }
    };
    sl.onchange = () => store.set("lidarPct", shadePct);
    // iPhone's own slider only moves if you land on the small knob, and a near miss scrolls the
    // menu instead. So the whole bar takes the touch: tap anywhere to jump there, then drag.
    const slide = (e) => {
      const r = sl.getBoundingClientRect();
      const v = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 20) * 5;
      if (v !== +sl.value) { sl.value = v; sl.oninput(); }
    };
    sl.onpointerdown = (e) => { e.preventDefault(); sl.setPointerCapture(e.pointerId); slide(e); };
    sl.onpointermove = (e) => { if (sl.hasPointerCapture(e.pointerId)) slide(e); };
    sl.onpointerup = sl.onpointercancel = () => sl.onchange();
    row.append(sh, sl, pct);
    layersEl.appendChild(row);
    if (pack.state === "failed") {
      const off = document.createElement("button");
      off.textContent = "Offline maps paused: tap to retry";
      off.onclick = () => { layersEl.style.display = "none"; downloadPack(); };
      layersEl.appendChild(off);
    }
    const by = document.createElement("div");
    by.className = "byline";
    by.textContent = `Nick S for Cumbria NNRs (${VERSION})`;
    layersEl.appendChild(by);
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
  // Measured from where the panel actually starts, never window.innerHeight: the iPhone
  // home-screen app can misreport innerHeight, which left points landing below the crosshair
  function crossY() { return sheet.getBoundingClientRect().top / 2; }
  // The crosshair in map-container pixels
  function crossPt() { return L.point(map.getSize().x / 2, crossY() - map.getContainer().getBoundingClientRect().top); }
  function layout() {
    const h = sheet.offsetHeight;
    document.documentElement.style.setProperty("--sheet-h", h + "px");
    document.documentElement.style.setProperty("--cross-y", crossY() + "px");
  }
  // The point under the crosshair, not the map's geometric centre
  function target() {
    return map.containerPointToLatLng(crossPt());
  }
  function panTo(latlng, zoom, animate = true) {
    const z = Math.min(zoom || map.getZoom(), map.getMaxZoom());
    const offsetY = map.getSize().y / 2 - crossPt().y;
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

  let last = null, atMe = false;
  function update() {
    const t = following && here ? L.latLng(here.lat, here.lon) : target(), h0 = sheet.offsetHeight;
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
    // Inside the GPS error circle a distance and direction are just noise: on a wobbly fix
    // they flipped every second (and the line kept vanishing, jolting the panel). So it
    // says "You are here" until you're clearly outside, with a margin so it doesn't flicker.
    const fm = $("fromMe");
    fm.dataset.nav = "";
    if (following && here) {
      fm.textContent = `You are here, GPS ±${Math.round(here.acc)} m`;
    } else if (here) {
      const me = L.latLng(here.lat, here.lon);
      const d = me.distanceTo(t), near = Math.max(5, here.acc);
      atMe = atMe ? d < near * 1.3 : d < near;
      fm.textContent = atMe ? `You are here, GPS ±${Math.round(here.acc)} m` : `${fmtDist(d)} from you, ${fmtBrg(bearing(me, t))} ›`;
      if (!atMe) fm.dataset.nav = "1";
    } else {
      fm.textContent = "";
    }
    layout();
    // The panel grew or shrank (the GPS line appearing, say), which moves the crosshair: put
    // the same place back under it, unless a finger is on the map or it's mid-zoom
    if (sheet.offsetHeight !== h0 && !map._animatingZoom && !map._flyToFrame && !map.dragging.moving() && !(map.touchZoom && map.touchZoom._zooming)) panTo(t, map.getZoom(), false);
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
  map.on("movestart", () => { layersEl.style.display = "none"; $("results").style.display = "none"; $("featMenu").style.display = "none"; });
  map.on("dragstart", () => { if (following) { following = false; $("locBtn").classList.remove("on"); update(); } });
  let reserveTap = null; // set with the reserves: zoomed out, a tap on or near one goes to it
  // A tap brings that spot to the crosshair; a second tap there straight after zooms in on it,
  // one level, so the map can be worked one-handed. Our own double tap rather than Leaflet's:
  // its zoom centres on the finger, which the first tap has already moved somewhere else.
  map.doubleClickZoom.disable();
  let lastTap = null;
  map.on("click", (e) => {
    layersEl.style.display = "none";
    $("results").style.display = "none";
    if (nav) return;
    if (maker) return mkTap(e);
    const now = Date.now(), again = lastTap && now - lastTap.t < 400 && e.containerPoint.distanceTo(lastTap.p) < 40;
    if (again) { panTo(lastTap.ll, Math.min(map.getZoom() + 1, map.getMaxZoom())); lastTap = null; return; }
    if (reserveTap && reserveTap(e)) { lastTap = null; return; }
    lastTap = { t: now, p: e.containerPoint, ll: e.latlng };
    panTo(e.latlng);
  });

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
      if (measure && measure.walking) walkStep();
    }, (err) => {
      // A weak or lost signal is usually brief and the watch carries on by itself, so keep
      // following; only a refusal switches GPS off
      if (err.code !== 1) {
        if (first) toast("Weak GPS signal. Still trying…");
        return;
      }
      following = false;
      $("locBtn").classList.remove("on");
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
      gpsBlocked = true;
      toast("Location is blocked. Settings › Privacy & Security › Location Services › Safari Websites › While Using");
      update();
      if (nav) drawNav();
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }
  $("locBtn").onclick = () => {
    if (following) { following = false; $("locBtn").classList.remove("on"); update(); }
    else startGps();
  };

  // ---------- actions ----------
  function toast(msg, ms = 1800) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), ms);
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
  // Share: tick what goes in. Remembered for next time; grid ref, Apple Maps, name and notes to
  // start with. The message reads location first (where a chat shows the map preview), then a
  // blank line, then the name and notes, so it's easy to read.
  // Name and notes only appear for saved things (the crosshair has neither).
  const SHARE_OPTS = [
    ["ref", "Grid ref", (x) => `Grid ref: ${x.ref}`],
    ["ll", "Lat/long", (x) => `Lat/long: ${x.lat.toFixed(5)}, ${x.lon.toFixed(5)}`],
    ["en", "E/N", (x) => `E/N: ${Math.round(x.e)}, ${Math.round(x.n)}`],
    ["apple", "Apple Maps", (x) => `https://maps.apple.com/?ll=${x.lat.toFixed(6)},${x.lon.toFixed(6)}&q=${encodeURIComponent(x.label || x.ref)}`],
    ["google", "Google Maps", (x) => `https://www.google.com/maps/search/?api=1&query=${x.lat.toFixed(6)},${x.lon.toFixed(6)}`],
    ["pic", "Current map", () => ""],
    ["photos", "Photos", () => ""],
    ["name", "Name", (x) => x.head],
    ["notes", "Notes", (x) => x.notes],
  ];
  let shareItem = null, shareOn = new Set(store.get("shareOpts", ["ref", "apple"]).filter((k) => k !== "app"));
  // 27 Oct: start everyone on just the grid ref and Apple Maps (name and notes ride along on saved things)
  if (!store.get("shareReset3", false)) { shareOn = new Set(["ref", "apple", "name", "notes"]); store.set("shareOpts", [...shareOn]); store.set("shareReset3", true); }
  if (!store.get("shareNamed", false)) { shareOn.add("name").add("notes"); store.set("shareOpts", [...shareOn]); store.set("shareNamed", true); }
  // 28 Oct: photos ride along by default (only offered for things that have them)
  if (!store.get("sharePhotos", false)) { shareOn.add("photos"); store.set("shareOpts", [...shareOn]); store.set("sharePhotos", true); }
  function shareTextFor(x) {
    const part = (keys) => SHARE_OPTS.filter(([k]) => keys.includes(k) && shareOn.has(k)).map(([, , f]) => f(x)).filter(Boolean).join("\n");
    return [part(["ref", "ll", "en", "apple", "google"]), part(["name", "notes"])].filter(Boolean).join("\n\n");
  }
  function drawShare() {
    $("shOpts").innerHTML = "";
    for (const [k, label] of SHARE_OPTS) {
      if ((k === "name" && !shareItem.head) || (k === "notes" && !shareItem.notes) || (k === "pic" && !shareItem.canPic) || (k === "photos" && !(shareItem.photos || []).length)) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.className = shareOn.has(k) ? "on" : "";
      b.onclick = () => {
        shareOn.has(k) ? shareOn.delete(k) : shareOn.add(k);
        store.set("shareOpts", [...shareOn]);
        b.classList.toggle("on", shareOn.has(k));
        $("shPrev").textContent = shareTextFor(shareItem);
        if (k === "pic") { if (shareOn.has("pic")) makePic(); else $("shPic").hidden = true; }
      };
      $("shOpts").appendChild(b);
    }
    $("shPrev").textContent = shareTextFor(shareItem);
  }
  // ---------- a picture of the map for sharing ----------
  // The map under the crosshair as a square picture: map tiles (and LiDAR if it's on), the
  // reserve edge, a pin, and a footer with the grid ref, lat/long, reserve and date. Nothing
  // of yours goes in it: no saved points, no blue dot. Chats show it as the big preview.
  async function mapPicture(x) {
    const box = map.getContainer().getBoundingClientRect();
    const { x: cx, y: cy } = crossPt();
    const half = Math.min(cx, cy), S = 1080, k = S / (2 * half), FOOT = 190;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S + FOOT;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ece4d0";
    ctx.fillRect(0, 0, S, S);
    const put = (img) => {
      const r = img.getBoundingClientRect();
      ctx.drawImage(img, (r.left - box.left - (cx - half)) * k, (r.top - box.top - (cy - half)) * k, r.width * k, r.height * k);
    };
    for (const img of document.querySelectorAll(".leaflet-tile-pane img.leaflet-tile-loaded")) put(img);
    const shade = [...document.querySelectorAll(".leaflet-shade-pane img.leaflet-tile-loaded")];
    if (shade.length) {
      ctx.save();
      ctx.globalCompositeOperation = "hard-light";
      ctx.globalAlpha = shadePct / 100;
      for (const img of shade) { ctx.filter = img.classList.contains("lidar") ? "brightness(.72) contrast(1.35)" : "none"; put(img); }
      ctx.restore();
    }
    // the team's reserve edges, drawn fresh (the map's own vector layer also holds your shapes)
    ctx.save();
    ctx.strokeStyle = "#d9480f";
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    const at = (lat, lon) => { const p = map.latLngToContainerPoint([lat, lon]); return [(p.x - (cx - half)) * k, (p.y - (cy - half)) * k]; };
    for (const f of nnr) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) for (const ring of poly) {
        ctx.beginPath();
        ring.forEach(([lon, lat], i) => { const [px, py] = at(lat, lon); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
    // the pin, its point on the spot
    const [px, py] = at(x.lat, x.lon);
    ctx.save();
    ctx.translate(px, py);
    ctx.shadowColor = "rgba(0,0,0,.35)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#c2255c";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-10, -22, -30, -34, -30, -58);
    ctx.arc(0, -58, 30, Math.PI, 0);
    ctx.bezierCurveTo(30, -34, 10, -22, 0, 0);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(0, -58, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // footer
    ctx.fillStyle = "#fbf9f3";
    ctx.fillRect(0, S, S, FOOT);
    ctx.fillStyle = "#e3dfd1";
    ctx.fillRect(0, S, S, 2);
    ctx.fillStyle = "#26261f";
    ctx.font = "700 64px ui-monospace, Menlo, monospace";
    ctx.fillText(x.ref, 44, S + 84);
    ctx.font = "500 30px -apple-system, sans-serif";
    ctx.fillStyle = "#6b695c";
    const where = reserveAt(L.latLng(x.lat, x.lon)).replace(/ \(NNR\)$/, "");
    const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    ctx.fillText([`${x.lat.toFixed(5)}, ${x.lon.toFixed(5)}`, where, day].filter(Boolean).join("  ·  "), 44, S + 138);
    ctx.font = "400 19px -apple-system, sans-serif";
    ctx.textAlign = "right";
    const credit = Object.keys(map.attributionControl._attributions || {}).join(" · ").replace(/<[^>]+>/g, "").slice(0, 120);
    ctx.fillText(credit, S - 30, S + FOOT - 22);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88)); // fails (null) if a map server didn't allow it
    return blob ? new File([blob], `${x.ref.replace(/\s+/g, "")}.jpg`, { type: "image/jpeg" }) : null;
  }
  // The picture is made as the share sheet opens: an iPhone only shares straight from a tap,
  // so it has to be ready when Share is pressed
  let sharePic = null, sharePhotos = null;
  function openShare(item) {
    shareItem = item;
    // only when the map is showing the place being shared (not from a notebook entry elsewhere)
    item.canPic = map.getContainer().clientWidth > 0 && target().distanceTo([item.lat, item.lon]) < 30;
    sharePic = null;
    // its photos are read in now, so they're ready when Share is pressed (same iPhone rule)
    sharePhotos = item.photos && item.photos.length ? photoFiles(item.label, item.photos) : null;
    $("shPic").hidden = true;
    if (item.canPic && shareOn.has("pic")) makePic();
    drawShare();
    $("shareModal").hidden = false;
  }
  function makePic() {
    const it = shareItem;
    sharePic = mapPicture(it).catch(() => null);
    sharePic.then((f) => { if (shareItem === it && f && shareOn.has("pic")) { $("shPic").src = URL.createObjectURL(f); $("shPic").hidden = false; } });
  }
  $("shCancel").onclick = () => { $("shareModal").hidden = true; };
  $("shareModal").onclick = (e) => { if (e.target === $("shareModal")) $("shareModal").hidden = true; };
  $("shGo").onclick = async () => {
    const text = shareTextFor(shareItem);
    const pic = shareItem.canPic && shareOn.has("pic") && sharePic ? await sharePic : null;
    const phs = shareOn.has("photos") && sharePhotos ? await sharePhotos : [];
    const files = [pic, ...phs].filter(Boolean);
    if (!text && !files.length) return toast("Tick at least one thing to share");
    $("shareModal").hidden = true;
    if (files.length && navigator.canShare && navigator.canShare({ files })) { try { await navigator.share({ files, text }); } catch {} return; }
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
  // Photos belong to a point, line or area (pt.photos: id plus where it was taken). Before
  // 28 Oct a photo was an entry of its own: those read back as a point carrying that photo.
  function upgrade(p) {
    if (p.kind !== "photo") return p;
    const { photoId, ...rest } = p;
    return { ...rest, kind: "point", shape: p.shape || "circle", colour: p.colour || "black",
      photos: photoId ? [{ id: photoId, lat: p.lat, lon: p.lon, acc: p.acc ?? null }] : [] };
  }
  const photosOf = (p) => (Array.isArray(p.photos) ? p.photos.filter((x) => x && x.id) : []);
  const loadPoints = () => {
    const raw = store.get("points", []);
    return Array.isArray(raw) ? raw.filter(sane).map((p) => upgrade({ ...p, name: String(p.name ?? "Unnamed"), notes: p.notes == null ? "" : String(p.notes) })) : [];
  };
  let points = loadPoints();
  const fresh = () => (points = loadPoints());
  function savePoints() {
    points = points.filter(sane);
    const ok = store.set("points", points);
    drawPins();
    if (!ok) alert("This phone wouldn't let Field Notes save. Share your points as CSV now so nothing is lost.");
    return ok;
  }
  window.addEventListener("storage", (e) => { if (e.key === "gridref.points") { fresh(); drawPins(); } });
  // OS's own grid conversion (OSTN15): makes grid refs and eastings/northings match OS, QGIS
  // and ArcGIS to within centimetres (the formula alone is about a metre out). Entries saved
  // before it had their eastings/northings worked out the old way, so redo those once.
  async function loadOSTN() {
    try {
      OSGB.setCorrection(await (await fetch("data/ostn15.json")).json());
      if (!store.get("ostn15", false)) {
        fresh();
        for (const p of points) { const g = OSGB.wgs84ToGrid(p.lat, p.lon); p.e = Math.round(g.e); p.n = Math.round(g.n); }
        if (points.length) savePoints();
        store.set("ostn15", true);
      }
      drawGrid();
      update();
    } catch {}
  }
  // Ask the browser not to clear our storage when space runs low
  const persist = () => { try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {} };
  let maker = null; // Make a map, while it's open (see "make a map")
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
      // Making a map: only the picked entries, and the ones tapped off drawn faint
      if (maker && !maker.keys.has(keyOf(pt))) continue;
      const off = maker && maker.off.has(keyOf(pt)) ? "mkoff" : "";
      if (!many) nameLabel(pt.kind === "area" ? L.latLngBounds(pt.pts).getCenter() : [pt.lat, pt.lon], pt.name, 8).addTo(pinLayer);
      if (pt.kind === "line" || pt.kind === "area") {
        // A white casing under a thinner coloured line: reads on topo and aerial alike, and
        // the wide casing is an easier target for a thumb. Small dots mark the corners.
        const c = COLOURS[pt.colour] || COLOURS.orange, area = pt.kind === "area";
        const Shape = area ? L.polygon : L.polyline, casing = pt.colour === "white" ? "#2b2b2b" : "#fff";
        Shape(pt.pts, { color: casing, weight: W[0], opacity: 0.85, lineJoin: "round", lineCap: "round", fillColor: c, fillOpacity: area ? 0.12 : 0, bubblingMouseEvents: false, className: off })
          .on("click", (e) => openFeature(pt, e))
          .addTo(pinLayer);
        // An invisible band 30 px wide along the edge: a thumb-sized target for a thin line
        Shape(pt.pts, { color: "#000", weight: 30, opacity: 0.001, fill: false, lineJoin: "round", lineCap: "round", bubblingMouseEvents: false })
          .on("click", (e) => openFeature(pt, e))
          .addTo(pinLayer);
        Shape(pt.pts, { color: c, weight: area ? W[2] : W[1], opacity: 1, lineJoin: "round", lineCap: "round", fill: false, interactive: false, className: off }).addTo(pinLayer);
        if (!many && lastZone === "near" && pt.pts.length <= 80)
          for (const v of pt.pts) L.circleMarker(v, { radius: 3, color: c, weight: 2, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(pinLayer);
        // A small camera where each photo of it was taken (not from far out: too busy)
        if (!many && lastZone !== "far")
          for (const ph of photosOf(pt)) if (okLL(ph.lat, ph.lon))
            L.marker([ph.lat, ph.lon], { icon: L.divIcon({ className: "", html: `<div class="photodot">${CAMERA_SVG}</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }) })
              .on("click", (e) => openFeature(pt, e))
              .addTo(pinLayer);
        continue;
      }
      // Points with photos wear a small dark camera badge; colour and shape still say what it is
      const badge = photosOf(pt).length ? `<i class="pcam">${CAMERA_SVG}</i>` : "";
      (many
        ? L.circleMarker([pt.lat, pt.lon], { radius: 5, color: "#fff", weight: 1.5, fillColor: COLOURS[pt.colour] || COLOURS.orange, fillOpacity: 1, renderer: pinCanvas, bubblingMouseEvents: false })
        : L.marker([pt.lat, pt.lon], { icon: L.divIcon({ className: "pin " + off, html: shapeSvg(pt.shape, pt.colour, 18) + badge, iconSize: [18, 18], iconAnchor: [9, 9] }) }))
        .on("click", (e) => openFeature(pt, e))
        .addTo(pinLayer);
    } catch {}
  }
  const CAMERA_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/></svg>';

  // ---------- tap something on the map: snap to it, then a small menu ----------
  // A line snaps to its middle (on the line, unlike the middle of its box)
  function midOf(pt) {
    const ll = pt.pts.map(([a, b]) => L.latLng(a, b));
    let half = shapeStats(pt).length / 2;
    for (let i = 1; i < ll.length; i++) {
      const d = ll[i - 1].distanceTo(ll[i]);
      if (half <= d && d > 0) { const k = half / d; return L.latLng(ll[i - 1].lat + (ll[i].lat - ll[i - 1].lat) * k, ll[i - 1].lng + (ll[i].lng - ll[i - 1].lng) * k); }
      half -= d;
    }
    return ll[ll.length - 1];
  }
  // Tap something: it comes in close. A point to zoom 17; a line or area as big as fits
  // the clear map (up to 18), never further out than you already were
  function openFeature(pt, e) {
    // Making a map: a drawing on top of the mark wins (it's removed); otherwise the mark is
    // left off the map, or put back
    if (maker) { if (e && mkTap(e)) return; const k = keyOf(pt); maker.off.has(k) ? maker.off.delete(k) : maker.off.add(k); return drawPins(); }
    if (measure || nav || moving) return;
    const shape = pt.kind === "line" || pt.kind === "area";
    const c = centreOf(pt), to = pt.kind === "line" ? midOf(pt) : L.latLng(c.lat, c.lon);
    following = false;
    $("locBtn").classList.remove("on");
    let z = 17;
    if (shape) {
      const room = L.point(map.getSize().x - 60, (sheet.getBoundingClientRect().top - 120) - 40);
      z = Math.min(18, map.getBoundsZoom(L.latLngBounds(pt.pts), false, map.getSize().subtract(room)) - 0.3); // a little slack: it centres on the line, not its box
    }
    z = Math.max(map.getZoom(), Math.min(z, map.getMaxZoom()));
    if (target().distanceTo(to) < 1 && Math.abs(map.getZoom() - z) < 0.05) return showFeatMenu(pt);
    map.once("moveend", () => setTimeout(() => showFeatMenu(pt), 0));
    panTo(to, z);
  }
  function showFeatMenu(pt) {
    const m = $("featMenu"), c = centreOf(pt), nPh = photosOf(pt).length;
    m.innerHTML = "";
    const head = document.createElement("div");
    head.className = "fm-title";
    head.innerHTML = "<b></b><span></span>";
    head.querySelector("b").textContent = pt.name;
    head.querySelector("span").textContent = pt.kind === "area" ? fmtArea(shapeStats(pt).area) : pt.kind === "line" ? fmtDist(shapeStats(pt).length) : "";
    m.appendChild(head);
    const item = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = () => { m.style.display = "none"; fn(); }; m.appendChild(b); };
    if (nPh) item(nPh > 1 ? `View photos (${nPh})` : "View photo", () => viewPhotos(pt));
    item("Navigate", () => { const cc = centreOf(pt); navigateTo(cc.lat, cc.lon); });
    item("Share", () => shareSaved(pt));
    item("Edit", () => editSaved(pt));
    item("Delete", () => deleteSaved(pt));
    m.lastChild.classList.add("danger");
    m.style.right = "auto";
    m.style.bottom = "auto";
    m.style.display = "block";
    // Beside the crosshair, never on top of the thing you tapped
    const w = m.offsetWidth, h = m.offsetHeight, cy = crossY(), cx = window.innerWidth / 2;
    m.style.left = (cx + 26 + w <= window.innerWidth - 8 ? cx + 26 : Math.max(8, cx - 26 - w)) + "px";
    m.style.top = Math.min(Math.max(100, cy - h / 2), sheet.getBoundingClientRect().top - h - 8) + "px";
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
  // Photos being added or removed in the popup. Nothing is final until Save: photos taken
  // and then cancelled are thrown away, and removed ones only go once you save.
  const MAX_PHOTOS = 6;
  let draft = null;
  const closeSave = (kept) => {
    if (draft && !kept) for (const id of draft.added) photoDB.del(id).catch(() => {});
    draft = null;
    $("saveModal").hidden = true; saving = null; editing = null; pick = { colour: store.get("ptColour", "magenta"), shape: store.get("ptShape", "circle") }; $("ptName").blur(); $("ptNotes").blur();
  };
  $("ptCancel").onclick = () => { const was = editing; closeSave(); if (was) showOnMap(was); };
  $("saveModal").onclick = (e) => { if (e.target === $("saveModal")) closeSave(); };
  let editing = null;
  function editSaved(pt) {
    closeDrawer();
    openSave(pt, pt);
  }
  function drawDraft() {
    const box = $("ptThumbs");
    if (!box || !draft) return;
    for (const im of box.querySelectorAll("img")) if (im.src.startsWith("blob:")) URL.revokeObjectURL(im.src);
    box.innerHTML = "";
    draft.photos.forEach((ph, i) => {
      const s = document.createElement("span");
      s.className = "pth";
      s.innerHTML = '<img alt="Photo"><button type="button" class="x" aria-label="Remove photo">×</button>';
      photoDB.get(ph.id).then((b) => { if (b) s.querySelector("img").src = URL.createObjectURL(b); }).catch(() => {});
      s.querySelector("img").onclick = () => viewPhotos({ name: $("ptName").value.trim() || $("ptName").placeholder, photos: draft.photos }, i);
      s.querySelector(".x").onclick = () => {
        draft.photos.splice(draft.photos.indexOf(ph), 1);
        if (draft.added.delete(ph.id)) photoDB.del(ph.id).catch(() => {});
        else draft.removed.add(ph.id);
        drawDraft();
      };
      box.appendChild(s);
    });
    $("ptPhotos").querySelector(".phbtns").hidden = draft.photos.length >= MAX_PHOTOS;
  }
  // The camera or the phone's photos, then the stamp screen, then back here
  let photoFor = null; // "draft" (this popup) or "quick" (hold +)
  if ($("ptTake")) $("ptTake").onclick = () => { photoFor = "draft"; $("photoIn").click(); };
  if ($("ptPick")) $("ptPick").onclick = () => { photoFor = "draft"; $("photoPick").click(); };
  function openSave(geom, edit) {
    fresh();
    $("keepBar").hidden = true;
    saving = geom;
    editing = edit || null;
    const isShape = !!geom.kind && geom.kind !== "point"; // points saved before types existed have no kind
    $("ptKind").hidden = true;
    $("ptShape").hidden = isShape;
    $("ptColour").hidden = false;
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
    draft = { photos: photosOf(editing || geom).slice(), added: new Set(), removed: new Set() };
    drawDraft();
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
    const photos = draft ? draft.photos.slice() : photosOf(editing || saving);
    if (draft) for (const id of draft.removed) photoDB.del(id).catch(() => {});
    if (editing) {
      const i = points.findIndex((q) => q.at === editing.at && q.name === editing.name);
      const isShape = editing.kind === "line" || editing.kind === "area";
      if (i >= 0) points[i] = { ...points[i], name, notes: $("ptNotes").value.trim(), colour: pick.colour, ...(isShape ? {} : { shape: pick.shape }), photos };
      closeSave(true);
      if (savePoints()) toast("✓ Updated " + name);
      if (i >= 0) showOnMap(points[i]); // finish on the thing you just edited (Edit can start from the notebook)
      return;
    }
    points.unshift({ name, notes: $("ptNotes").value.trim(), colour: pick.colour, shape: pick.shape, ...saving, photos, at: new Date().toISOString() });
    store.set("ptColour", pick.colour);
    store.set("ptShape", pick.shape);
    persist();
    const wasShape = saving.kind && saving.kind !== "point";
    closeSave(true);
    if (savePoints()) toast("✓ Saved " + name + (photos.length ? ` with ${photos.length} photo${photos.length > 1 ? "s" : ""}` : ""));
    if (wasShape && measure) $("mDone").click(); // back to the map
  };
  // The notebook opens on the reserve you're looking at (zoomed in, centred on or within one of
  // the team's reserves), otherwise on everything. Roudsea's chip view centres between its two
  // blocks, so it's the reserve's outer box that counts, not its boundary.
  function viewedReserve() {
    if (map.getZoom() < CLOSE) return "";
    const c = map.getCenter();
    let best = "", bestD = Infinity;
    for (const f of nnr) {
      if (!isTeam(f)) continue;
      const [w, s, e, n] = f.bbox;
      if (c.lng < w || c.lng > e || c.lat < s || c.lat > n) continue;
      const d = c.distanceTo([(s + n) / 2, (w + e) / 2]);
      if (d < bestD) { bestD = d; best = TEAM.get(f.properties.REF_CODE); }
    }
    return best;
  }
  $("listBtn").onclick = () => { resF = viewedReserve(); openDrawer(); };

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
  // Filter by reserve (the chips); "" is Everything
  let resF = "", folder = null, menuPt = null;
  const KIND_WORD = { point: "Points", line: "Lines", area: "Areas", photo: "Photos" };
  // Tap a reserve to see only its entries; tap it again to see everything
  $("resFilter").onclick = (e) => { const b = e.target.closest("button"); if (b) { resF = resF === b.dataset.r ? "" : b.dataset.r; openDrawer(); } };
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
  const empty = (html) => `<div class="empty"><i class="tex"></i><p>${html}</p></div>`;
  function openDrawer() {
    fresh();
    $("keepBar").hidden = true;
    if (folder && !points.some((p) => p.folder === folder)) folder = null;
    const scope = folder ? points.filter((p) => p.folder === folder) : points;
    // Which reserve each entry is in (worked out now, so imports and old entries get it too)
    const resOf = new Map(scope.map((p) => { const c = centreOf(p); return [p, reserveShort(L.latLng(c.lat, c.lon))]; }));
    const inRes = [...TEAM.values()].filter((r) => [...resOf.values()].includes(r));
    if (resF && !inRes.includes(resF)) resF = "";
    // Reserve filter (only offered when something is in a reserve)
    $("resFilter").innerHTML = [["", "Everything"], ...inRes.map((r) => [r, r])].map(([v, l]) => `<button data-r="${esc(v)}" class="${v === resF ? "on" : ""}">${esc(l)}</button>`).join("");
    $("resFilter").hidden = !inRes.length;
    const match = (p) => !resF || resOf.get(p) === resF;
    // Header: the notebook, or the folder you're in
    $("dTitle").textContent = folder || "Notebook";
    $("dSub").textContent = folder ? `(${summary(scope)})` : "(on this phone only)";
    $("folderBack").hidden = !folder;
    $("folderActs").hidden = !folder;
    const list = $("list");
    list.innerHTML = "";
    const shown = scope.filter(match);
    if (!scope.length) list.innerHTML = empty("Your notebook is empty.<br>Line up the crosshair, tap <b>+</b>, then pick a point, line or area. Add photos as you save it.<br>In a hurry? <b>Hold +</b> to take a photo and pin it where you stand.<br><br>Got a list of grid refs? <b>Import</b> a CSV.");
    else if (!shown.length) list.innerHTML = empty("Nothing here with these filters.");
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
    // Saved maps: one row at the top of the notebook, opening the list
    const nMaps = savedMaps().length;
    if (!folder && !selecting && nMaps) {
      const row = document.createElement("div");
      row.className = "item folderrow";
      row.innerHTML = `<span class="mk"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20Z"/><path d="M9 4v13.5M15 6.5V20"/></svg></span><div class="main"><div class="line1"><span class="name">Saved maps</span></div><div class="meta">${nMaps} map${nMaps > 1 ? "s" : ""}</div></div><span class="chev">›</span>`;
      row.onclick = showMaps;
      if (list.firstChild && list.querySelector(".empty")) list.innerHTML = "";
      list.appendChild(row);
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
    const mk = !isShape ? shapeSvg(pt.shape, pt.colour, 18)
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="${kind === "area" ? col + "44" : "none"}" stroke="${col}" stroke-width="3" stroke-linejoin="round">${kind === "area" ? '<path d="M4 7 12 3l8 6-3 11H6Z"/>' : '<path d="M3 18 9 9l5 6 7-10"/>'}</svg>`;
    const what = !isShape ? OSGB.gridRef(pt.e, pt.n, digits) : kind === "area" ? fmtArea(st.area) : fmtDist(st.length);
    row.innerHTML = `<span class="chk">✓</span><span class="mk">${mk}</span><div class="main"><div class="line1"><span class="name"></span><span class="gr"></span></div><div class="note"></div><div class="pthumbs"></div><div class="meta"></div></div>`;
    row.querySelector(".name").textContent = pt.name;
    row.querySelector(".gr").textContent = what;
    // Its photos as a strip of small thumbnails (tap one to open it)
    const phs = photosOf(pt), strip = row.querySelector(".pthumbs");
    if (!phs.length) strip.remove();
    phs.forEach((ph, i) => {
      const im = document.createElement("img");
      im.alt = "Photo";
      im.onclick = (e) => { if (selecting) return; e.stopPropagation(); viewPhotos(pt, i); };
      photoDB.get(ph.id).then((b) => { if (b) im.src = URL.createObjectURL(b); }).catch(() => {});
      strip.appendChild(im);
    });
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
      $("imName").textContent = pt.name;
      $("imRef").textContent = OSGB.gridRef(c.e, c.n, digits) + (kind === "area" ? " (centre)" : kind === "line" ? " (start)" : "");
      $("imView").hidden = !phs.length;
      $("imView").textContent = phs.length > 1 ? `View photos (${phs.length})` : "View photo";
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
  function shareSaved(pt) {
    const c = centreOf(pt), ref = OSGB.gridRef(c.e, c.n, digits);
    const what = pt.kind === "area" ? ` (centre of ${fmtArea(shapeStats(pt).area)})` : pt.kind === "line" ? ` (start of ${fmtDist(shapeStats(pt).length)} line)` : "";
    openShare({ head: `${pt.name}${what}`, label: pt.name, notes: pt.notes || "", ref, lat: c.lat, lon: c.lon, e: c.e, n: c.n, photos: photosOf(pt) });
  }
  // A saved thing's photos as files, named after it ("Broken_stile_2.jpg")
  async function photoFiles(name, photos) {
    const base = (name || "photo").replace(/[^\w-]+/g, "_");
    const out = [];
    for (const [i, ph] of photos.entries()) {
      try { const b = await photoDB.get(ph.id); if (b) out.push(new File([b], `${base}${photos.length > 1 ? "_" + (i + 1) : ""}.jpg`, { type: "image/jpeg" })); } catch {}
    }
    return out;
  }
  $("imShare").onclick = () => { closeMenu(); shareSaved(menuPt); };
  $("imEdit").onclick = () => { closeMenu(); editSaved(menuPt); };
  $("imView").onclick = () => { closeMenu(); viewPhotos(menuPt); };
  // Delete at once, with Undo for a few seconds (kinder than "are you sure?" with cold
  // thumbs). A photo's picture is only really removed once the Undo has gone.
  let undoTimer = null, undoItems = null;
  function finishDelete() {
    clearTimeout(undoTimer);
    for (const p of undoItems || []) for (const ph of photosOf(p)) photoDB.del(ph.id).catch(() => {});
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
  // ---------- export: everything or picked entries; CSV or GeoJSON ----------
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  function toCSV(list) {
    const wkt = (p) => {
      if (!p.pts) return "";
      const c = p.pts.map(([a, b]) => `${b} ${a}`);
      return p.kind === "area" ? `POLYGON((${c.concat([c[0]]).join(", ")}))` : `LINESTRING(${c.join(", ")})`;
    };
    const rows = [["Name", "Type", "Grid ref", "Latitude (WGS84)", "Longitude (WGS84)", "Easting (OSGB36 EPSG:27700)", "Northing (OSGB36 EPSG:27700)", "Length (m)", "Area (ha)", "GPS accuracy (m)", "Saved", "Notes", "Colour", "Shape", "Geometry (WKT)", "Photo file", "Folder"]]
      .concat(list.map((p) => {
        const st = p.pts ? shapeStats(p) : null;
        return [q(p.name), p.kind || "point", OSGB.gridRef(p.e, p.n, 8), p.lat.toFixed(6), p.lon.toFixed(6), p.e, p.n, st ? Math.round(st.length) : "", st && st.area != null ? (st.area / 10000).toFixed(3) : "",
          p.acc ?? "", p.at, q(p.notes || ""), p.colour || "orange", p.shape || "circle", q(wkt(p)), q(photosOf(p).map((ph) => `photos/${ph.id}.jpg`).join("; ")), q(p.folder || "")];
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
        saved: p.at, colour: p.colour || "orange", shape: p.shape || "circle", photos: photosOf(p).map((ph) => `photos/${ph.id}.jpg`).join("; ") || null, folder: p.folder || null } };
    });
    return JSON.stringify({ type: "FeatureCollection", features }, null, 1);
  }
  async function exportList(list, fmt, withPhotos) {
    if (!list.length) return toast("Nothing picked to export");
    const day = new Date().toISOString().slice(0, 10);
    const photos = withPhotos ? list.flatMap(photosOf) : [];
    let file;
    if (photos.length) {
      // A zip: both data files (so it restores and opens anywhere) plus the photos themselves
      toast(`Packing ${photos.length} photo${photos.length > 1 ? "s" : ""}…`);
      const files = [{ name: `field-notes-${day}.csv`, data: toCSV(list) }, { name: `field-notes-${day}.geojson`, data: toGeoJSON(list) }];
      for (const ph of photos) { try { const b = await photoDB.get(ph.id); if (b) files.push({ name: `photos/${ph.id}.jpg`, data: b }); } catch {} }
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
    // Pick: tap entries to tick them, then Export
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
    const list = points.filter((p) => picked.has(keyOf(p))), forMap = selecting === "map";
    endSelect();
    if (forMap) return startMaker(list);
    exportList(list, exportFmt, exportPhotos);
  };
  // selecting: false, true (picking what to export) or "map" (picking what goes on a map)
  function drawSelBar() { $("selGo").textContent = selecting === "map" ? `Make map (${picked.size})` : `Export ${picked.size}`; }

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
    // "photos/a.jpg; photos/b.jpg": each file found in the zip gets a fresh id on this phone
    const withPics = (get) => (photoFiles ? get(iPhoto).split(/\s*;\s*/).filter((f) => photoFiles.has(f)) : []).map((f) => {
      const id = "ph" + Date.now() + "_" + pendingPhotos.length;
      pendingPhotos.push({ id, data: photoFiles.get(f) });
      return { id, lat: null, lon: null };
    });
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
        const phs = withPics(get);
        if (phs.length) shp.photos = phs;
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
      if (get(iType) === "point" || get(iType) === "photo") pt.kind = "point"; // old exports had photo rows
      // From one of our zips: bring its pictures back too
      const phs = withPics(get);
      if (phs.length) { pt.photos = phs; if (get(iType) === "photo") pt.colour = COLOURS[get(iColour).toLowerCase()] ? pt.colour : "black"; }
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
  // An email to Nick with what he'd otherwise have to ask for: which build, which phone,
  // home-screen app or browser, screen sizes, and where the crosshair was
  function reportBug() {
    const to = (window.GRIDREF_CONFIG || {}).feedbackTo;
    if (!to) return toast("No feedback address set up yet");
    const box = map.getContainer().getBoundingClientRect();
    const details = [
      `Field Notes ${APP_VERSION}, build ${VERSION}`,
      `Opened as: ${navigator.standalone || matchMedia("(display-mode: standalone)").matches ? "home-screen app" : "browser"}`,
      `Phone: ${navigator.userAgent}`,
      `Screen ${screen.width}×${screen.height}, window ${innerWidth}×${innerHeight}, map ${Math.round(box.width)}×${Math.round(box.height)}, panel ${sheet.offsetHeight}`,
      `Map: ${current}, zoom ${map.getZoom()}${last && last.ref ? ", crosshair " + last.ref : ""}`,
      `Notebook: ${points.length} entries${here ? `, GPS ±${Math.round(here.acc)} m` : ""}`,
    ];
    const body = "What happened (and what you expected):\n\n\n\n---\n" + details.join("\n");
    location.href = `mailto:${to}?subject=${encodeURIComponent(`Field Notes bug (build ${VERSION})`)}&body=${encodeURIComponent(body)}`;
  }
  // ---------- tides: type "tide" in the search box ----------
  // Official tide times (ADMIRALTY, metres above chart datum like the tide tables), fetched
  // daily by a GitHub job into data/tides.json. A copy is kept so they work offline for a week.
  // Nothing on screen unless asked for. Each station shows the run of tides up to its second
  // high; tap it for the next four days. Big tide (top of the spring range) in bold.
  const TIDE_STATIONS = [["1006114", "Walney and Duddon"], ["1006126", "Roudsea and the Leven"]];
  const TIDE_BIG = { "Duddon Bar": 8.4, "Ulverston": 9.3 };
  let tides = store.get("tides", null);
  const loadTides = () => fetch("data/tides.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j && j.reserves) { tides = j; store.set("tides", j); } }).catch(() => {});
  const tTime = (at) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  function dayWord(at) {
    const d = new Date(at), t = new Date();
    if (d.toDateString() === t.toDateString()) return "today";
    if (d.toDateString() === new Date(t.getTime() + 86400000).toDateString()) return "tomorrow";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
  }
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  function tideEvent(e, big, tag = "") {
    const txt = `${tag}${e.high ? "High" : "Low"} ${tTime(e.at)}${e.high ? ` (${e.m.toFixed(1)} m)` : ""}`;
    return e.high && e.m >= big ? `<b>${esc(txt)}</b>` : esc(txt);
  }
  async function showTides() {
    if (!tides) await loadTides();
    else loadTides();
    resultsEl.innerHTML = "";
    const now = Date.now();
    for (const [code, where] of TIDE_STATIONS) {
      const st = tides && tides.reserves && tides.reserves[code];
      const next = st ? st.events.filter((e) => Date.parse(e.at) > now) : [];
      if (!next.length) continue;
      const big = TIDE_BIG[st.station] ?? 99;
      // up to and including the second high, with the day named where it changes
      const run = [];
      for (const e of next) { run.push(e); if (run.filter((x) => x.high).length === 2) break; }
      let day = "today";
      const line = run.map((e) => { const d = dayWord(e.at), tag = d !== day ? cap(d) + ": " : ""; day = d; return tideEvent(e, big, tag); }).join(", ");
      // the next four days, a line each
      const days = new Map();
      for (const e of next) {
        const d = dayWord(e.at);
        if (days.size === 4 && !days.has(d)) break;
        (days.get(d) || days.set(d, []).get(d)).push(e);
      }
      const table = [...days].map(([d, evs]) => `<div><span>${esc(cap(d))}</span><span class="ev">${evs.map((e) => tideEvent(e, big)).join(", ")}</span></div>`).join("");
      const b = document.createElement("button");
      b.className = "tiderow";
      b.innerHTML = `<span class="tag">Tides</span><span class="t">${esc(st.station)}</span><small>${esc(where)}</small>
        <div class="tl">${line}</div><div class="tdays" hidden>${table}</div>`;
      b.onclick = () => { const t = b.querySelector(".tdays"); t.hidden = !t.hidden; b.querySelector(".tl").hidden = !t.hidden; };
      resultsEl.appendChild(b);
    }
    const m = document.createElement("div");
    m.className = "msg";
    m.textContent = resultsEl.children.length ? "Tap a station for the next four days. Metres above chart datum; bold is a big tide. © UKHO" : "No tide times on this phone yet: try again with signal";
    resultsEl.appendChild(m);
    resultsEl.style.display = "block";
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
    if (it.feedback) { resultsEl.style.display = "none"; $("q").value = ""; $("q").blur(); return reportBug(); }
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
    if (r.kind === "pluscode") {
      let ref = map.getCenter(), where = "";
      if (r.locality) {
        try { const hit = (await LocalSearch.searchPlaces(r.locality, ref, 1))[0]; if (hit) { ref = L.latLng(hit.lat, hit.lon); where = hit.title; } } catch {}
      }
      const p = GridSearch.plusRecover(r.code, ref.lat, ref.lng);
      return [{ title: fmtRef(p.lat, p.lon) || r.code, sub: `${r.code}${where ? " " + where : " (near the map)"}`, tag: "Plus code", lat: p.lat, lon: p.lon, zoom: 18 }];
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

  // Your notebook (names, notes, folders) and the team's reserves, matched like place names
  // (typos allowed), so "fallen oak", "post 10" or "gait" find yours first
  function mine(text) {
    const q = LocalSearch.norm(text);
    if (q.length < 2) return [];
    const words = q.split(" ");
    const hit = (s) => s && LocalSearch.fuzzyMatch(words, LocalSearch.norm(s).split(" "));
    const out = [];
    for (const [code, name] of TEAM) {
      const f = nnr.find((x) => x.properties.REF_CODE === code);
      if (!f || !(hit(name) || hit(f.properties.LABEL))) continue;
      const b = L.geoJSON(f).getBounds(), c = b.getCenter();
      out.push({ title: f.properties.LABEL.replace(/ \(NNR\)$/, ""), sub: "National Nature Reserve", tag: "Reserve", lat: c.lat, lon: c.lng, zoom: Math.min(16, map.getBoundsZoom(b)) });
    }
    for (const p of points) {
      if (out.length >= 8) break;
      if (!(hit(p.name) || hit(p.notes) || hit(p.folder))) continue;
      const c = centreOf(p);
      out.push({ title: p.name, sub: [KIND_WORD[p.kind || "point"].replace(/s$/, ""), p.folder, dayLabel(p.at)].filter(Boolean).join(" · "), tag: "Notebook", lat: c.lat, lon: c.lon, zoom: 17 });
    }
    return out;
  }
  let seq = 0, typing;
  let easterEgg = null; // set with the reserves: a team member's name, searched with Go
  async function search(text, submit) {
    const my = ++seq;
    text = text.trim();
    if (!text) return showResults([]);
    if (/^(high |low )?tides?( times?| tables?)?$/i.test(text)) return showTides();
    if (submit && easterEgg && easterEgg(text)) { $("q").value = ""; $("q").blur(); return showResults([]); }
    // Tucked away on purpose: only the exact word "nick" offers it
    if (text.toLowerCase() === "nick") return showResults([{ title: "Report bug to Nick…", sub: "Opens an email with this phone's details filled in", feedback: true }]);
    const readings = GridSearch.parse(text);
    // A whole message pasted in: look for a grid ref, lat/long, plus code, postcode or
    // what3words inside it
    if (!readings.length && /\s\S+\s/.test(text)) readings.push(...GridSearch.findIn(text));
    const bad = readings.find((r) => r.kind === "bad-ref");
    if (bad) return showResults([], bad.message);
    if (readings.some((r) => r.kind === "link-unknown")) {
      return showResults([], "Can't read a location from that link. Short links (maps.app.goo.gl) hide it: open the link, then copy the coordinates in.");
    }
    const items = [];
    // Grid refs, E/N, lat/long and map links work offline and show at once
    for (const r of readings) if (r.lat != null) items.push(...(await resolve(r)));
    if (items.length && !submit) showResults(items);
    const exact = readings.some((r) => r.lat != null || r.kind === "postcode" || r.kind === "w3w" || r.kind === "pluscode");
    if (!exact) items.push(...mine(text));
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
    showResults(items, items.length ? "" : text.length >= 3 ? "Nothing found by that name. Try fewer letters, or a grid ref (SD 339 836), postcode, lat/long or plus code." : "");
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
  $("fromMe").onclick = () => { if ($("fromMe").dataset.nav && !following) $("navBtn").click(); };

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
  // a car or magnetic case) while still sounding sure of itself. So the arrow stays orange,
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
    drawHint();
  }
  // The words under the dial: a bold line and one or two lines of advice, the same shape in
  // every state so the panel never changes height. Until the compass can be trusted it says
  // "Compass not ready" in orange, steady (no flashing), with all the advice at once; the
  // moment it's good the dial flashes bright green with a tick, then settles to normal.
  let hintKey = "", wasTrusted = false, readyUntil = 0, compassOk = false, navAt = 0;
  const MAGNETS = "Hold it flat, away from magnets: phone case, car, gates.";
  function drawHint() {
    if (!nav) return;
    const el = $("navHint"), f = facing(), dial = document.querySelector(".dial"), now = Date.now();
    const trusted = f.src === "compass" && compassTrusted();
    // Not ready: a compass that isn't trusted yet, or one that's been allowed but hasn't spoken
    const notReady = !nav.arrived && (f.src === "compass" ? !trusted : compassOk && f.src === "none" && now - navAt < 5000);
    if (trusted && !wasTrusted) { readyUntil = now + 1600; haptic(); setTimeout(drawHint, 1650); }
    wasTrusted = trusted;
    const ready = !nav.arrived && now < readyUntil;
    dial.classList.toggle("ready", ready);
    const [head, text, cls] = nav.arrived ? ["", "", ""]
      : notReady ? ["Compass not ready", Math.abs(tilt) > 60 ? "Hold the phone flatter: it only works lying roughly flat."
        : disagree >= 3 ? "It disagrees with your walking direction. Wave it in a figure-of-8, away from metal."
        : MAGNETS + " Still orange? Wave it in a figure-of-8.", "warn"]
      : ready ? ["✓ Compass ready", MAGNETS, "ok"]
      : f.src === "compass" ? ["Compass", MAGNETS, ""]
      : f.src === "travel" ? ["No compass", "The arrow follows your direction of walking. Keep moving.", ""]
      : ["No compass", "North is at the top of the dial. Use the map and the bearing.", ""];
    const key = head + "|" + text + "|" + cls;
    if (key === hintKey) return;
    hintKey = key;
    el.className = "nav-hint" + (cls ? " " + cls : "");
    el.innerHTML = head ? "<b></b><span></span>" : "";
    if (head) { el.querySelector("b").textContent = head; el.querySelector("span").textContent = text; }
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
    drawHint();
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
    hintKey = "";
    wasTrusted = false;
    readyUntil = 0;
    navAt = Date.now();
    compassOk = false;
    const compass = await compassOn();
    compassOk = compass;
    if (!compass) toast("Compass not allowed. The map and distance still work");
    drawHint();
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
    // Once: throw away tiles stored before 27 Oct. v116 only fetched the files phones didn't
    // have, so the old OS tiles with LiDAR baked in stayed (same names) under the new pack.
    if (!store.get("packClean2", false)) { await caches.delete("gridref-maps"); store.set("pack", ""); store.set("packClean2", true); }
    if (store.get("pack", "") === idx.version) { pack.state = "ready"; return; }
    // A new pack replaces the old one outright, for the same reason
    if (store.get("pack", "")) { await caches.delete("gridref-maps"); store.set("pack", ""); }
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

  // No signal: lay the offline OS map (the reserves) over whatever map is showing; aerial
  // photos can't be kept, so that switches back to OS Outdoor underneath. Signal back: put it all back.
  let offlineMode = false, swappedFrom = null, tileErrors = [], probe = null;
  function goOffline() {
    if (offlineMode) return;
    offlineMode = true;
    if (current === "aerial" && LAYERS.outdoor) { swappedFrom = "aerial"; setBase("outdoor"); }
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
  for (const k of ["outdoor", "aerial"].filter((x) => LAYERS[x])) {
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
    const what = { line: "line", area: "area", photo: "photo" }[kind] || "";
    const head = r ? `${r}${what ? " " + what : ""}` : what ? what[0].toUpperCase() + what.slice(1) : "Point";
    return `${head} ${timeOf(when.toISOString())}`;
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
  // Zoomed out: a bold line and a tint, so the reserves stand out across the county. Zoomed in
  // (11.5 up): a crisp edge with a soft band just inside it, the way OS marks national park
  // edges (so you can tell which side is the reserve), and a faint spotlight outside. The switch
  // sits well below every reserve chip's view (all land at about 13 or closer) and above the
  // launch overview (about 9), so every chip shows the same style on any phone.
  const CLOSE = 11.5;
  nnrLayer.options.style = () => (map.getZoom() < CLOSE
    ? { color: RESERVE, weight: 3, opacity: 0.95, fillColor: RESERVE, fillOpacity: 0.14 }
    : { color: RESERVE, weight: 1.6, opacity: 1, fill: false, lineJoin: "round" });
  const bandLayer = L.geoJSON(null, { interactive: false, style: { color: RESERVE, weight: 18, opacity: 0.3, fill: false, lineJoin: "round" } });
  // The band is a wide stroke clipped to the reserve's own shape, so only its inner half shows.
  // The clip <use>s the boundary path, so it follows that path as Leaflet redraws it.
  function clipBand() {
    const edges = {};
    nnrLayer.eachLayer((l) => { if (l._path) edges[l.feature.properties.REF_CODE] = l._path; });
    bandLayer.eachLayer((l) => {
      const edge = edges[l.feature.properties.REF_CODE], band = l._path;
      if (!edge || !band || band.getAttribute("clip-path")) return;
      const NS = "http://www.w3.org/2000/svg", svg = band.ownerSVGElement;
      const id = "edge-" + l.feature.properties.REF_CODE;
      edge.id = id;
      let defs = svg.querySelector("defs");
      if (!defs) svg.prepend((defs = document.createElementNS(NS, "defs")));
      let clip = document.getElementById("clip-" + id);
      if (!clip) {
        clip = document.createElementNS(NS, "clipPath");
        clip.id = "clip-" + id;
        const use = document.createElementNS(NS, "use");
        use.setAttribute("href", "#" + id);
        use.setAttribute("clip-rule", "evenodd");
        clip.appendChild(use);
        defs.appendChild(clip);
      }
      band.setAttribute("clip-path", `url(#clip-${id})`);
    });
  }
  // The spotlight: one shape covering the whole region with the reserves cut out of it, in its
  // own pane under the boundaries, just a hint darker around them (10%): the team mark things
  // outside the reserves too (shops, parking), so the rest of the map must stay fully usable
  const maskPane = map.createPane("mask");
  maskPane.style.zIndex = 350;
  let maskLayer = null;
  function drawMask() {
    if (maskLayer) map.removeLayer(maskLayer);
    const flip = (ring) => ring.map(([x, y]) => [y, x]);
    const holes = [], islands = [];
    for (const f of nnr) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) { holes.push(flip(poly[0])); islands.push(...poly.slice(1).map((h) => [flip(h)])); }
    }
    const world = [[52.5, -6], [52.5, 0.5], [56.5, 0.5], [56.5, -6]];
    maskLayer = L.polygon([[world, ...holes], ...islands], { pane: "mask", renderer: L.svg({ pane: "mask" }), interactive: false, stroke: false, fillColor: "#18231d", fillOpacity: 0.1 }).addTo(map);
  }
  function closeUp() {
    const close = map.getZoom() >= CLOSE;
    maskPane.classList.toggle("on", close);
    // County view: your own marks can't be tapped, so a tap on a reserve always opens it
    map.getContainer().classList.toggle("county", !close);
    if (close && !map.hasLayer(bandLayer)) bandLayer.addTo(map).bringToBack();
    if (!close && map.hasLayer(bandLayer)) map.removeLayer(bandLayer);
    if (close) clipBand();
  }
  // Tap a reserve chip: its boundary draws itself round as the map lands on it, in the same
  // time for every reserve. A reserve in several pieces (Duddon has ten) draws them one after
  // another, each getting its share of the time by length: drawn as one outline, every piece
  // would grow at once and the many small ones would be done in a blink.
  const DRAW_MS = 600;
  function drawOn(code) {
    nnrLayer.eachLayer((l) => {
      const path = l._path;
      if (!path || l.feature.properties.REF_CODE !== code || !path.getTotalLength) return;
      const NS = "http://www.w3.org/2000/svg";
      const parts = (path.getAttribute("d") || "").match(/M[^M]*/g) || [];
      const temps = parts.map((d) => {
        const t = document.createElementNS(NS, "path");
        t.setAttribute("d", d);
        for (const a of ["stroke", "stroke-width", "stroke-linejoin", "stroke-linecap"]) if (path.getAttribute(a)) t.setAttribute(a, path.getAttribute(a));
        t.setAttribute("fill", "none");
        path.parentNode.appendChild(t);
        return { t, len: Math.ceil(t.getTotalLength()) };
      });
      const total = temps.reduce((a, x) => a + x.len, 0) || 1;
      path.style.strokeOpacity = 0;
      let at = 0;
      for (const { t, len } of temps) {
        const ms = (DRAW_MS * len) / total;
        t.style.strokeDasharray = `${len} ${len}`;
        t.style.strokeDashoffset = len;
        t.getBoundingClientRect(); // start from the hidden state
        t.style.transition = `stroke-dashoffset ${ms}ms linear ${at}ms`;
        t.style.strokeDashoffset = 0;
        at += ms;
      }
      setTimeout(() => { temps.forEach(({ t }) => t.remove()); path.style.strokeOpacity = ""; }, DRAW_MS + 80);
    });
  }

  const resLabels = L.layerGroup().addTo(map);
  function drawResLabels() {
    resLabels.clearLayers();
    if (map.getZoom() > 13) return;
    // Names sit just off the reserve (above it; North Fen below, as Blelham Bog is right on
    // top of it) as halo text, so the reserve itself is never hidden under its label
    for (const f of nnr) if (isTeam(f)) {
      const bb = L.geoJSON(f).getBounds(), below = f.properties.REF_CODE === "1006111";
      const at = L.latLng(below ? bb.getSouth() : bb.getNorth(), bb.getCenter().lng);
      L.marker(at, { interactive: false, icon: L.divIcon({ className: "", html: `<div class="reslabel${below ? " below" : ""}" data-code="${f.properties.REF_CODE}">${TEAM.get(f.properties.REF_CODE)}</div>`, iconSize: [0, 0] }) }).addTo(resLabels);
    }
  }
  map.on("zoomend", () => { nnrLayer.setStyle(nnrLayer.options.style); closeUp(); drawResLabels(); });
  // Fit a reserve into the biggest clear space on screen: nothing over it, not even the
  // see-through buttons. Two ways to fit: the full width down to the tops of the corner
  // buttons, or the gap between the two button columns down to the panel. A wide reserve
  // wins in the first, a tall one in the second; whichever lets it come in closer is used.
  // fly: glide there (a reserve chip, a tap on the county view) and resolve once landed
  function fitClear(bounds, fly) {
    const box = map.getContainer().getBoundingClientRect(), m = 10, r = (el) => el.getBoundingClientRect();
    const left = r(document.querySelector(".fabs.left")), right = r(document.querySelector(".fabs:not(.left)"));
    const attr = document.querySelector(".leaflet-control-attribution");
    const top = r($("chips")).bottom + m - box.top, panel = r(sheet).top - m - box.top;
    const corners = Math.min(left.top, right.top, attr ? r(attr).top : Infinity) - m - box.top;
    const W = box.width, H = box.height;
    const fits = [
      { tl: [m, top], br: [m, H - corners] },
      { tl: [left.right + m - box.left, top], br: [W - (right.left - m - box.left), H - panel] },
    ].map((o) => ({ ...o, z: map.getBoundsZoom(bounds, false, L.point(o.tl).add(o.br)) }));
    const best = fits[0].z >= fits[1].z ? fits[0] : fits[1];
    const opts = { paddingTopLeft: best.tl, paddingBottomRight: best.br, maxZoom: 17 };
    if (!fly || matchMedia("(prefers-reduced-motion: reduce)").matches) { map.fitBounds(bounds, { ...opts, animate: false }); return Promise.resolve(); }
    return new Promise((done) => {
      const t = setTimeout(done, 2500); // in case the glide is cut short without a moveend
      map.once("moveend", () => { clearTimeout(t); done(); });
      map.flyToBounds(bounds, { ...opts, duration: 1.1, easeLinearity: 0.25 });
    });
  }
  // The reserve's own edge stays hidden on the way in, then draws itself round on landing
  function hideEdge(code, hide) {
    nnrLayer.eachLayer((l) => { if (l._path && l.feature.properties.REF_CODE === code) l._path.style.strokeOpacity = hide ? 0 : ""; });
  }
  async function goReserve(f) {
    const code = f.properties.REF_CODE;
    following = false;
    $("locBtn").classList.remove("on");
    hideEdge(code, true);
    await fitClear(L.geoJSON(f).getBounds(), true);
    drawOn(code);
  }
  // On the county view the reserves are small: a tap on one, or within a thumb's width of it,
  // opens it as its chip would. The nearest wins where two are close (Blelham Bog, North Fen).
  reserveTap = (e) => {
    if (map.getZoom() >= CLOSE || !nnr.length) return false;
    // The name counts as the reserve too: it's what your eye goes to
    const { clientX: x, clientY: y } = e.originalEvent;
    for (const el of document.querySelectorAll(".reslabel")) {
      const r = el.getBoundingClientRect();
      if (x > r.left - 6 && x < r.right + 6 && y > r.top - 6 && y < r.bottom + 6) {
        const f = nnr.find((g) => g.properties.REF_CODE === el.dataset.code);
        if (f) { goReserve(f); return true; }
      }
    }
    const p = e.containerPoint, near = 28;
    let best = null, bestD = Infinity;
    for (const f of nnr) {
      if (!isTeam(f)) continue;
      const [w, s, ea, n] = f.bbox;
      const a = map.latLngToContainerPoint([n, w]), b = map.latLngToContainerPoint([s, ea]);
      const dx = Math.max(a.x - p.x, 0, p.x - b.x), dy = Math.max(a.y - p.y, 0, p.y - b.y);
      const d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; best = f; }
    }
    if (!best || bestD > near) return false;
    goReserve(best);
    return true;
  };
  // ---------- easter eggs: a team member's name in the search, then Go ----------
  // Each plays out on that person's reserve: the map flies there and the animals are pinned to
  // real places, only on land. All drawn here (nothing to download), then gone.
  const EGG_SVG = {
    // ringed plover: sandy-brown back, white below, a full black breast band with a white collar
    // above it, white forehead under a black crown bar, black mask through the eye, short orange
    // bill tipped black, orange legs. No yellow eye-ring: that's a little ringed plover
    plover: `<svg viewBox="0 0 64 44" width="64" height="44"><g stroke="#f08a1c" stroke-width="2.6" stroke-linecap="round"><path class="l1" d="M27 33l-2 9"/><path class="l2" d="M33 33l2 9"/></g>
      <ellipse cx="30" cy="26" rx="16" ry="9.5" fill="#fff"/>
      <path d="M8 25C11 16 24 12 36 13c3 3 2 6-2 7-8 2-17 4-26 5Z" fill="#b0916b"/><path d="M8 25 3 23l6-2Z" fill="#6f5a40"/>
      <path class="wing" d="M14 21c6-5 15-6 22-4-6 3-14 5-22 4Z" fill="#8f7354"/>
      <path d="M36 14c4 0 9 3 10 9 0 3-1 6-3 6-1-4-3-8-7-11Z" fill="#111"/><path d="M35 12.5c3-1.5 7-1 9 2-3 0-6-1-9-.5Z" fill="#fff"/>
      <circle cx="46" cy="10" r="7.2" fill="#b0916b"/><path d="M44 3.6c3-.8 6 0 8 2.4l-7 1.2Z" fill="#111"/><path d="M50 6.4c2 .6 3 2 3.4 3.6l-5-.6Z" fill="#fff"/>
      <path d="M53.5 10.5 44 9.5c-3 .2-4 2.6-3 4.6h6l6.5-1.6Z" fill="#111"/><path d="M41.5 14.5c2 3 7 3.6 11.5.2Z" fill="#fff"/>
      <circle cx="48" cy="11" r="1.7" fill="#111"/><circle cx="48.5" cy="10.5" r=".45" fill="#fff"/>
      <path d="M53.5 10.4l6 1.3-6 1.4Z" fill="#f08a1c"/><path d="M57.6 11.3l2 .4-2 .5Z" fill="#111"/></svg>`,
    // natterjack toad: squat, short-legged and warty, olive with red-brown warts, the thin yellow
    // stripe down its back, lemon-green eye with a horizontal pupil, legs tucked under (it runs)
    toad: `<svg viewBox="0 0 64 40" width="64" height="40"><path d="M17 31c-5 3-4 7 3 7h7" stroke="#69713f" stroke-width="5" stroke-linecap="round" fill="none"/>
      <path d="M8 30c0-10 10-17 24-17 12 0 20 4 23 10 2 5-2 9-9 10H14c-4 0-6-1-6-3Z" fill="#7b8452"/>
      <path d="M12 20c10-7 26-8 38-3" stroke="#e8d84a" stroke-width="2" fill="none" stroke-linecap="round"/>
      <g fill="#5d6639"><circle cx="18" cy="25" r="1.8"/><circle cx="26" cy="29" r="1.5"/><circle cx="34" cy="24" r="1.7"/><circle cx="41" cy="28" r="1.4"/><circle cx="22" cy="19" r="1.2"/></g>
      <g fill="#93603f"><circle cx="30" cy="20" r="1.3"/><circle cx="14" cy="28" r="1.2"/><circle cx="38" cy="19" r="1.1"/></g>
      <ellipse cx="43" cy="18.5" rx="5" ry="2.4" fill="#6b7446"/><circle cx="49" cy="16.5" r="4" fill="#7b8452"/>
      <circle cx="49.5" cy="16" r="2.6" fill="#c8d43c"/><ellipse cx="49.6" cy="16" rx="1.9" ry=".75" fill="#111"/>
      <path d="M46 23.5c3 .4 6-.2 8-2" stroke="#3d4423" stroke-width="1.2" fill="none"/><path d="M44 32l2 6h4" stroke="#69713f" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
    // Duke of Burgundy: dark brown, chequered orange, white fringe; wings beat from the body
    duke: `<svg viewBox="-24 -18 48 36" width="48" height="36"><g class="wings"><g fill="#4a2f1e" stroke="#2a1a10" stroke-width=".6">
      <path d="M0-2C-6-15-20-16-21-7c-1 6 9 8 21 6Z"/><path d="M0 0c-9 1-17 4-15 11 2 5 11 1 15-8Z"/><path d="M0-2C6-15 20-16 21-7c1 6-9 8-21 6Z"/><path d="M0 0c9 1 17 4 15 11-2 5-11 1-15-8Z"/></g>
      <g fill="#e2892b"><circle cx="-14" cy="-9" r="1.8"/><circle cx="-9" cy="-6" r="1.6"/><circle cx="-16" cy="-4" r="1.4"/><circle cx="-10" cy="5" r="1.6"/><circle cx="-6" cy="8" r="1.3"/><circle cx="14" cy="-9" r="1.8"/><circle cx="9" cy="-6" r="1.6"/><circle cx="16" cy="-4" r="1.4"/><circle cx="10" cy="5" r="1.6"/><circle cx="6" cy="8" r="1.3"/>
        <circle cx="-18" cy="-10" r="1.3"/><circle cx="-12" cy="-12" r="1.3"/><circle cx="-6" cy="-9" r="1.3"/><circle cx="-12" cy="-3" r="1.3"/><circle cx="-13" cy="7" r="1.3"/><circle cx="-8" cy="10" r="1.2"/>
        <circle cx="18" cy="-10" r="1.3"/><circle cx="12" cy="-12" r="1.3"/><circle cx="6" cy="-9" r="1.3"/><circle cx="12" cy="-3" r="1.3"/><circle cx="13" cy="7" r="1.3"/><circle cx="8" cy="10" r="1.2"/></g>
      <g fill="#1d130b"><circle cx="-13" cy="7" r=".5"/><circle cx="-8" cy="10" r=".5"/><circle cx="13" cy="7" r=".5"/><circle cx="8" cy="10" r=".5"/></g>
      <g fill="#fff"><circle cx="-20" cy="-9" r=".7"/><circle cx="-21" cy="-6" r=".7"/><circle cx="20" cy="-9" r=".7"/><circle cx="21" cy="-6" r=".7"/><circle cx="-14" cy="11" r=".7"/><circle cx="14" cy="11" r=".7"/></g></g>
      <ellipse cx="0" cy="1" rx="1.6" ry="8" fill="#1d130b"/><path d="M-1-6l-4-6M1-6l4-6" stroke="#1d130b" stroke-width=".7"/></svg>`,
    // hazel dormouse: golden, big black eyes, a thick furry tail curled up behind
    dormouse: `<svg viewBox="0 0 64 40" width="64" height="40"><path d="M16 27c-9 1-14-4-12-11 1-4 5-6 8-4" stroke="#c4822f" stroke-width="7.5" stroke-linecap="round" fill="none"/>
      <ellipse cx="30" cy="26" rx="16" ry="10.5" fill="#d99a42"/><ellipse cx="32" cy="31" rx="11" ry="4.5" fill="#f3dcae"/>
      <circle cx="44" cy="19" r="9.5" fill="#d99a42"/><circle cx="41" cy="10.5" r="4" fill="#d99a42"/><circle cx="41" cy="10.5" r="2.2" fill="#e9a99a"/>
      <circle cx="48" cy="18" r="3.1" fill="#111"/><circle cx="49" cy="17" r="1" fill="#fff"/><circle cx="53.3" cy="21.5" r="1.5" fill="#c46a5e"/>
      <path d="M52 22l8-2M52 23l8 1M51 24l7 3" stroke="#6b4a24" stroke-width=".6"/><path d="M24 35l-1 3M37 35l1 3" stroke="#c4822f" stroke-width="3" stroke-linecap="round"/></svg>`,
    // rosy marsh moth: a moth, not a butterfly. Wings swept back flat over the body in a long
    // triangle, rosy-brown with darker cross-lines and kidney marks, a furry thorax, and in
    // flight only a quick shallow whirr (flap "moth"), not a butterfly's wide beat
    moth: `<svg viewBox="-24 -18 48 36" width="44" height="33"><g class="wings" data-flap="moth">
      <path d="M0-9C-7-9-15 1-17 15L0 12Z" fill="#a8676c" stroke="#6e3f43" stroke-width=".7"/><path d="M0-9C7-9 15 1 17 15L0 12Z" fill="#9c5d63" stroke="#6e3f43" stroke-width=".7"/>
      <path d="M-3-7C-7-4-11 3-12 12M3-7C7-4 11 3 12 12" stroke="#d9a3a6" stroke-width="1.2" fill="none"/>
      <path d="M-4 0-13 4M-3 6-15 10M4 0 13 4M3 6 15 10" stroke="#6e3f43" stroke-width=".8"/>
      <g fill="#5c3236"><ellipse cx="-7" cy="2.5" rx="1.6" ry="2.4"/><ellipse cx="7" cy="2.5" rx="1.6" ry="2.4"/></g></g>
      <ellipse cx="0" cy="-8" rx="4.2" ry="4.5" fill="#7a4f45"/><circle cx="0" cy="-12.5" r="2.6" fill="#6a4238"/>
      <path d="M-1-14q-3-3-7-3M1-14q3-3 7-3" stroke="#6a4238" stroke-width=".8" fill="none"/><path d="M-1 12h2l-1 3Z" fill="#7a4f45"/></svg>`,
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const atGrid = (e, n) => { const ll = OSGB.gridToWgs84(e, n); return L.latLng(ll.lat, ll.lon); };
  const reserve = (code) => nnr.find((f) => f.properties.REF_CODE === code);
  const polysOf = (f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates);
  function inPoly(poly, lat, lng) {
    let n = 0;
    for (const r of poly)
      for (let i = 0, j = r.length - 1; i < r.length; j = i++)
        if ((r[i][1] > lat) !== (r[j][1] > lat) && lng < ((r[j][0] - r[i][0]) * (lat - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) n++;
    return n % 2 === 1;
  }
  const inside = (f, lat, lng) => polysOf(f).some((poly) => inPoly(poly, lat, lng));
  // Which piece of a reserve a spot is in (Roudsea is two blocks): -1 if none
  const pieceOf = (f, ll) => polysOf(f).findIndex((poly) => inPoly(poly, ll.lat, ll.lng));
  // Land or water? Walney's boundary takes in a lot of estuary, so the animals go only where
  // the map itself is drawn as land: the pixel under the spot, read from the loaded OS tile.
  // Blue is water, pale yellow is sand and mud; anything else (white, green) is land. On the
  // aerial photo, or before tiles load, it can't tell, so it says yes (null = can't tell).
  const pix = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  function rgbAt(ll) {
    if (current === "aerial") return null;
    const box = map.getContainer().getBoundingClientRect(), p = map.latLngToContainerPoint(ll), x = box.left + p.x, y = box.top + p.y;
    let img = null;
    for (const t of document.querySelectorAll(".leaflet-tile-pane img.leaflet-tile-loaded")) {
      const r = t.getBoundingClientRect();
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom && r.width > 150) img = t;
    }
    if (!img) return null;
    try {
      const r = img.getBoundingClientRect();
      pix.clearRect(0, 0, 1, 1);
      pix.drawImage(img, ((x - r.left) * img.naturalWidth) / r.width, ((y - r.top) * img.naturalHeight) / r.height, 1, 1, 0, 0, 1, 1);
      return pix.getImageData(0, 0, 1, 1).data;
    } catch { return null; }
  }
  function landAt(ll) {
    const c = rgbAt(ll);
    if (!c) return null;
    const [R, G, B] = c, water = B > R + 12 && B >= G - 4, sand = R > B + 18 && G > B + 8 && R > 200;
    return !water && !sand;
  }
  // Woodland is drawn green: dormice keep to it, the moss moths keep out of it
  const woodAt = (ll) => { const c = rgbAt(ll); return c ? c[1] > c[0] + 8 && c[1] > c[2] : null; };
  // n spots on land in the reserve (and passing `keep`, e.g. south of the start)
  function spotsIn(f, n, keep = () => true) {
    const [w, s, e, nn] = f.bbox, out = [];
    for (let tries = 0; out.length < n && tries < n * 120; tries++) {
      const ll = L.latLng(s + Math.random() * (nn - s), w + Math.random() * (e - w));
      if (keep(ll) && inside(f, ll.lat, ll.lng) && landAt(ll) !== false) out.push(ll);
    }
    return out;
  }
  const eggPins = L.layerGroup().addTo(map);
  const pinEgg = (ll, html, w, h) => {
    const m = L.marker(ll, { interactive: false, keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: "eggpin", html: `<div>${html}</div>`, iconSize: [w, h], iconAnchor: [w / 2, h] }) }).addTo(eggPins);
    return m.getElement().firstElementChild;
  };
  async function clearEggPins(ms = 600) {
    eggPins.eachLayer((m) => m.getElement() && m.getElement().animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: "forwards" }));
    await sleep(ms);
    eggPins.clearLayers();
  }
  const sized = (svg, w, h) => svg.replace(/width="\d+" height="\d+"/, `width="${w}" height="${h}"`);
  const flyTo = (ll, z) => new Promise((done) => { const t = setTimeout(done, 3000); map.once("moveend", () => { clearTimeout(t); done(); }); map.flyTo(ll, z, { duration: 1.2 }); });
  function holdSign(el, text) {
    const card = document.createElement("div");
    card.className = "eggsign";
    card.textContent = text;
    el.appendChild(card);
    card.animate([{ transform: "translateX(-50%) scale(0)" }, { transform: "translateX(-50%) scale(1.15)", offset: 0.7 }, { transform: "translateX(-50%) scale(1)" }], { duration: 450, easing: "ease-out", fill: "forwards" });
    haptic();
  }
  function flapping(el) { // wings beating from the body (butterfly, moth)
    const w = el.querySelector(".wings");
    w.style.transformOrigin = "0 0";
    w.style.transformBox = "view-box";
    return w.dataset.flap === "moth"
      ? w.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(.78)" }], { duration: 45 + Math.random() * 20, iterations: Infinity, direction: "alternate" })
      : w.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(.2)" }], { duration: 110 + Math.random() * 40, iterations: Infinity, direction: "alternate" });
  }
  // Mike's Timberwolf moment: reality glitches, the screen goes black with a huge wolf for two
  // quick blinks, a pause, then one last flicker, and everything's normal as if nothing happened
  // Our own wolf (the emoji differs by phone, and Apple's is too soft): a low-poly head in
  // greys, slit amber eyes that glow, heavy brows
  const WOLF_SVG = `<svg viewBox="0 0 200 200" aria-hidden="true"><defs><filter id="wglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <path d="M100 52 132 40 155 12 162 70 180 96 150 120 130 160 100 188 70 160 50 120 20 96 38 70 45 12 68 40Z" fill="#9a9a9a"/>
    <path d="M52 26 66 46 55 62Z" fill="#1c1c1c"/><path d="M148 26 134 46 145 62Z" fill="#1c1c1c"/>
    <path d="M100 52 68 40 55 66 74 92 100 88Z" fill="#e4e4e4"/><path d="M100 52 132 40 145 66 126 92 100 88Z" fill="#c9c9c9"/>
    <path d="M55 66 38 70 20 96 50 120 74 92Z" fill="#a8a8a8"/><path d="M145 66 162 70 180 96 150 120 126 92Z" fill="#8a8a8a"/>
    <path d="M74 92 50 120 70 160 86 150 84 100Z" fill="#b5b5b5"/><path d="M126 92 150 120 130 160 114 150 116 100Z" fill="#969696"/>
    <path d="M100 88 84 100 86 150 100 178 114 150 116 100Z" fill="#f2f2f2"/><path d="M100 52 92 68 100 86 108 68Z" fill="#fff"/>
    <path d="M56 74 92 86M144 74 108 86" stroke="#141414" stroke-width="6" stroke-linecap="round"/>
    <g fill="#ffb300" filter="url(#wglow)"><path d="M66 84 88 91 79 97Z"/><path d="M134 84 112 91 121 97Z"/></g>
    <path d="M89 150h22l-11 15Z" fill="#141414"/><path d="M100 165v8M91 176l9-3 9 3" stroke="#141414" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;
  async function wolfGlitch() {
    const g = document.createElement("div");
    g.className = "wolfglitch";
    g.innerHTML = WOLF_SVG;
    document.body.appendChild(g);
    const blink = async (ms, dx) => {
      g.style.setProperty("--dx", dx + "px");
      g.classList.add("on");
      haptic();
      await sleep(ms);
      g.classList.remove("on");
    };
    await blink(110, -6);
    await sleep(90);
    await blink(60, 9);
    await sleep(900); // long enough to think it's over
    await blink(45, -3); // so he knows he saw something
    g.remove();
  }
  const startEgg = () => { following = false; $("locBtn").classList.remove("on"); eggPins.clearLayers(); };

  // One theme for Joe, Mike, Tracy and Jim: close in on one animal at a spot on the reserve,
  // pull back to the whole reserve, and it multiplies, the young ones hopping, scurrying or
  // flying out from it until they're all over the land.
  //   how: "hop", "scurry" (low quick runs: natterjacks, which run rather than hop, and dormice), "fly" (butterflies, moths)
  //   habitat: "wood" (only the green woodland) or "open" (only outside it), as on the OS map
  async function spread({ code, start, svg, big, small, count, how, keep, sign, habitat, glitch }) {
    const f = reserve(code);
    if (!f) return;
    startEgg();
    if (!start) { // no spot given: anywhere on its land, picked from the whole-reserve view
      await fitClear(L.geoJSON(f).getBounds(), true);
      await sleep(400);
      [start] = spotsIn(f, 1);
      if (!start) return;
    }
    await flyTo(start, 16);
    const first = pinEgg(start, sized(svg, ...big), ...big);
    if (how === "fly") {
      flapping(first);
      await first.animate([{ transform: "translate(0,0)" }, { transform: "translate(-30px,-24px) rotate(-10deg)" }, { transform: "translate(18px,-38px) rotate(8deg)" }, { transform: "translate(28px,-10px)" }, { transform: "translate(0,0)" }], { duration: 1800, easing: "ease-in-out" }).finished;
    } else {
      const h = how === "scurry" ? 8 : 14;
      await first.animate([{ transform: "translateY(0)" }, { transform: `translateY(-${h}px)`, offset: 0.4 }, { transform: "translateY(0)" }], { duration: how === "scurry" ? 260 : 380, iterations: how === "scurry" ? 5 : 3, easing: "ease-in-out" }).finished;
    }
    await fitClear(L.geoJSON(f).getBounds(), true);
    await sleep(400); // tiles in, so land and water can be told apart
    const spots = spotsIn(f, count, (ll) => (!keep || keep(ll, start)) && (!habitat || woodAt(ll) !== (habitat === "open")));
    const S = map.latLngToLayerPoint(start), gap = how === "fly" ? 55 : 45;
    spots.forEach((ll, i) => {
      const b = map.latLngToLayerPoint(ll), dx = S.x - b.x, dy = S.y - b.y;
      const el = pinEgg(ll, sized(svg, ...small), ...small);
      let frames;
      if (how === "fly") {
        flapping(el);
        const wob = (k) => Math.sin(k * 2.1 + i) * 18;
        frames = [0, 0.25, 0.5, 0.75, 1].map((k) => ({ transform: `translate(${dx * (1 - k) + (k < 1 ? wob(k * 4) : 0)}px,${dy * (1 - k) - (k > 0 && k < 1 ? 30 + wob(k * 3) : 0)}px) scale(${0.4 + 0.6 * k})`, opacity: k ? 1 : 0 }));
      } else {
        const lift = how === "scurry" ? 14 : 40;
        frames = [
          { transform: `translate(${dx}px,${dy}px) scale(.3)`, opacity: 0 },
          { transform: `translate(${dx / 2}px,${dy / 2 - lift}px) scale(.8)`, opacity: 1, offset: 0.5 },
          { transform: "translate(0,0) scale(1)", opacity: 1 },
        ];
      }
      el.animate(frames, { duration: how === "fly" ? 1100 : how === "scurry" ? 500 : 650, delay: i * gap, easing: "ease-in-out", fill: "backwards" });
      if (how === "hop" && i % 12 === 0) setTimeout(haptic, i * gap + 650);
    });
    await sleep(spots.length * gap + 1100);
    if (glitch) { await sleep(500); await glitch(); await sleep(500); }
    if (sign) holdSign(first, sign);
    await sleep(4500);
    await clearEggPins();
  }

  // John: seven ringed plovers come in off the sea, fly along Walney's north shore and back,
  // then settle together on the shore near SD 1750 7340, and one holds up a sign
  async function plovers() {
    startEgg();
    const T = atGrid(317500, 473400);
    await flyTo(T, 15);
    await sleep(500); // tiles in, so the shore can be found
    // The shoreline: for each step east-west, the northernmost land (scanning down from the sea)
    const line = [];
    for (let k = -12; k <= 9; k++) {
      const lng = T.lng + k * 0.0011;
      for (let lat = T.lat + 0.006; lat > T.lat - 0.006; lat -= 0.00012) {
        const land = landAt(L.latLng(lat, lng));
        if (land) { line.push(L.latLng(lat + 0.0003, lng)); break; }
        if (land === null && lat < T.lat) break;
      }
    }
    // Landing spots: land within about 120 m of the grid ref
    const spots = [];
    for (let tries = 0; spots.length < 7 && tries < 600; tries++) {
      const ll = L.latLng(T.lat + (Math.random() - 0.5) * 0.0022, T.lng + (Math.random() - 0.5) * 0.0036);
      if (landAt(ll) !== false) spots.push(ll);
    }
    if (!spots.length) return;
    // The flock's route in layer px: in from the sea to the west end of the shore, east along
    // it just off the beach, a turn out over the water, back west along it, then down
    const px = (ll) => map.latLngToLayerPoint(ll);
    const C = px(L.latLngBounds(spots).getCenter());
    const shore = line.length >= 3 ? line.map(px) : [C.add([-200, -40]), C.add([0, -50]), C.add([200, -40])];
    const route = [shore[0].add([-240, -110]), ...shore.map((p) => p.add([0, -14])), shore[shore.length - 1].add([70, -60]),
      ...shore.slice().reverse().map((p) => p.add([0, -48])).filter((p) => p.x > C.x - 30), C.add([0, -40])];
    // Catmull-Rom through the route, then even steps by distance, so the flock flies at a steady speed
    const dense = [];
    for (let i = 0; i < route.length - 1; i++) {
      const p0 = route[Math.max(0, i - 1)], p1 = route[i], p2 = route[i + 1], p3 = route[Math.min(route.length - 1, i + 2)];
      for (let u = 0; u < 1; u += 0.1) {
        const u2 = u * u, u3 = u2 * u, c = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u2 + (-a + 3 * b - 3 * cc + d) * u3);
        dense.push(L.point(c(p0.x, p1.x, p2.x, p3.x), c(p0.y, p1.y, p2.y, p3.y)));
      }
    }
    dense.push(route[route.length - 1]);
    const lens = [0];
    for (let i = 1; i < dense.length; i++) lens.push(lens[i - 1] + dense[i].distanceTo(dense[i - 1]));
    const total = lens[lens.length - 1], at = (d) => { let i = lens.findIndex((l) => l >= d); if (i <= 0) return dense[0]; const k = (d - lens[i - 1]) / (lens[i] - lens[i - 1] || 1); return dense[i - 1].add(dense[i].subtract(dense[i - 1]).multiplyBy(k)); };
    const STEPS = 60, FLY = Math.min(9000, Math.max(5000, total * 6));
    const nearest = spots.reduce((a, b) => (T.distanceTo(b) < T.distanceTo(a) ? b : a));
    const flights = spots.map((ll, i) => {
      const el = pinEgg(ll, sized(EGG_SVG.plover, 34, 24), 34, 24);
      el.querySelectorAll(".l1, .l2").forEach((l) => (l.style.opacity = 0)); // legs tucked in flight
      const wing = el.querySelector(".wing");
      wing.style.transformOrigin = "37px 17px";
      const flap = wing.animate([{ transform: "rotate(0)" }, { transform: "rotate(-70deg)" }], { duration: 130, iterations: Infinity, direction: "alternate", delay: i * 30 });
      const B = px(ll), jit = L.point((Math.random() - 0.5) * 44, (Math.random() - 0.5) * 26), frames = [];
      let prev = null;
      for (let k = 0; k <= STEPS; k++) {
        const t = k / STEPS, land = t < 0.85 ? 0 : ((t - 0.85) / 0.15) ** 2;
        const pos = at(total * Math.min(1, t / 0.85)).add(jit).multiplyBy(1 - land).add(B.multiplyBy(land));
        const left = prev && pos.x < prev.x - 0.5; // face the way it's flying
        frames.push({ transform: `translate(${pos.x - B.x}px,${pos.y - B.y}px) scaleX(${left ? -1 : 1})` });
        prev = pos;
      }
      frames[frames.length - 1].transform = "translate(0,0) scaleX(1)";
      return el.animate(frames, { duration: FLY, delay: i * 70, easing: "linear", fill: "backwards" }).finished.then(() => {
        flap.cancel();
        el.querySelectorAll(".l1, .l2").forEach((l) => (l.style.opacity = ""));
        if (ll === nearest) holdSign(el, "Thanks John!");
      });
    });
    await Promise.all(flights);
    await sleep(4500);
    await clearEggPins();
  }
  const EGGS = {
    john: plovers,
    joe: () => spread({ code: "1006114", start: atGrid(317280, 473060), svg: EGG_SVG.toad, big: [44, 28], small: [20, 13], count: 70, how: "scurry", sign: "Can't wait to meet you, Joe!" }),
    mike: () => spread({ code: "1006058", start: atGrid(348130, 477310), svg: EGG_SVG.duke, big: [48, 36], small: [22, 17], count: 60, how: "fly", glitch: wolfGlitch, sign: "Thanks Mike!" }),
    tracy: () => spread({ code: "1006126", start: atGrid(333560, 481650), svg: EGG_SVG.dormouse, big: [44, 28], small: [20, 13], count: 45, how: "scurry", habitat: "wood", sign: "Thanks Tracy!",
      keep: (ll, s) => pieceOf(reserve("1006126"), ll) === pieceOf(reserve("1006126"), s) }), // the top block (Roudsea Wood) only
    jim: () => spread({ code: "1006126", start: atGrid(333570, 482630), svg: EGG_SVG.moth, big: [44, 33], small: [20, 15], count: 60, how: "fly", habitat: "open", sign: "Thanks Jim!", keep: (ll, s) => ll.lat < s.lat && ll.lng > s.lng - 0.001 }),
  };
  easterEgg = (text) => {
    const run = EGGS[text.toLowerCase()];
    if (!run) return false;
    run().catch((err) => { console.warn("easter egg", err); eggPins.clearLayers(); });
    return true;
  };
  // ---------- make a map: pick points, frame it, draw on it, send it as a picture ----------
  // For contractors and volunteers: a picture works on any phone, offline once received, and
  // prints. Grid lines and refs, a scale bar, north and the copyright lines go on every one.
  // OS-style map symbols for the maker: simple, bold, each on its own tile so it reads on any map
  const SYM_BG = '<rect x="1" y="1" width="22" height="22" rx="4" fill="#fff" stroke="#1b1a15" stroke-width="1.5"/>';
  const SYMBOLS = {
    parking: { name: "Parking", svg: '<rect x="1" y="1" width="22" height="22" rx="4" fill="#1c5fb4"/><path d="M8.5 18.5V5.5h4.3a3.7 3.7 0 0 1 0 7.4H8.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/>' },
    gate: { name: "Gate", svg: SYM_BG + '<path d="M5 5.5v13M19 5.5v13M5 8.5h14M5 12h14M5 15.5h14M5 15.5 19 8.5" stroke="#1b1a15" stroke-width="1.7" fill="none" stroke-linecap="round"/>' },
    stile: { name: "Stile", svg: SYM_BG + '<path d="M7 5v14M17 5v14M4 15h16M7 10h10" stroke="#1b1a15" stroke-width="2" fill="none" stroke-linecap="round"/>' },
    barn: { name: "Barn", svg: SYM_BG + '<path d="M4 19.5V10l8-5 8 5v9.5Z" fill="#5a574d"/><path d="M10 19.5v-5h4v5" fill="#fff"/>' },
    toilets: { name: "Toilets", svg: '<rect x="1" y="1" width="22" height="22" rx="4" fill="#1c5fb4"/><text x="12" y="16" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="10" fill="#fff">WC</text>' },
    meet: { name: "Meeting point", short: "Meet", svg: SYM_BG + '<path d="M7.5 19.5v-15" stroke="#1b1a15" stroke-width="2" stroke-linecap="round"/><path d="M8.5 4.5h10l-3 4 3 4h-10Z" fill="#2f9e44"/>' },
    hazard: { name: "Hazard", svg: '<path d="M12 1.8 22.8 21H1.2Z" fill="#fcc419" stroke="#1b1a15" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 8.5v6" stroke="#1b1a15" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.3" fill="#1b1a15"/>' },
    water: { name: "Water", svg: SYM_BG + '<path d="M12 4c3 4.5 5 7.3 5 10a5 5 0 0 1-10 0c0-2.7 2-5.5 5-10Z" fill="#1c7ed6"/>' },
    bridge: { name: "Bridge", svg: SYM_BG + '<path d="M3 10.5h18M3 16c3-4.5 15-4.5 18 0" stroke="#1b1a15" stroke-width="2" fill="none"/><path d="M6.5 10.5v3M17.5 10.5v3M12 10.5v1.5" stroke="#1b1a15" stroke-width="1.6"/>' },
    firstaid: { name: "First aid", svg: '<rect x="1" y="1" width="22" height="22" rx="4" fill="#2f9e44"/><path d="M12 6v12M6 12h12" stroke="#fff" stroke-width="3.4"/>' },
  };
  const symSvg = (k, size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24">${(SYMBOLS[k] || SYMBOLS.meet).svg}</svg>`;
  const MK = { portrait: [1200, 1600], landscape: [1600, 1200], head: 128, foot: 96 };
  const mkDrawLayer = L.layerGroup();
  function startMaker(list, reopening) {
    if (!list.length && !reopening) return toast("Pick at least one point");
    closeDrawer();
    maker = { keys: new Set(list.map(keyOf)), off: new Set(), orient: "portrait", tool: "move", colour: "#e03131", drawn: [], history: [], me: false, prevLayer: current, sym: "parking" };
    $("maker").hidden = false;
    document.body.classList.add("mapmaker");
    mkDrawLayer.clearLayers().addTo(map);
    setTool("move");
    $("mkMe").textContent = "Me: off";
    $("mkMe").classList.remove("on");
    $("mkOrient").textContent = "Landscape";
    placeFrame();
    mkSet = [];
    mkSendLabel();
    $("mkTitle").value = $("mkNote").value = "";
    if (!list.length) return drawPins();
    // Fit the picked points in the frame
    const b = L.latLngBounds(list.flatMap((p) => (p.pts ? p.pts : [[p.lat, p.lon]])));
    const f = frameRect(), box = map.getContainer().getBoundingClientRect(), m = 40;
    map.fitBounds(b, { paddingTopLeft: [f.left - box.left + m, f.top - box.top + m], paddingBottomRight: [box.right - f.right + m, box.bottom - f.bottom + m], maxZoom: 17, animate: false });
    drawPins();
  }
  function endMaker() {
    if (!maker) return;
    $("maker").hidden = true;
    document.body.classList.remove("mapmaker");
    map.removeLayer(mkDrawLayer);
    map.dragging.enable();
    maker = null;
    mkSet = [];
    mkCur = null;
    drawPins();
    layout();
  }
  // The frame: the picture's map area at the picture's shape, as big as fits between the top
  // bar and the tool bar
  function frameRect() { return $("mkFrame").getBoundingClientRect(); }
  function placeFrame() {
    const [W, H] = MK[maker.orient], aspect = W / (H - MK.head - MK.foot);
    const top = $("maker").querySelector(".mktop").getBoundingClientRect().bottom + 12;
    const bottom = $("maker").querySelector(".mkbar").getBoundingClientRect().top - 12;
    const availW = window.innerWidth - 24, availH = bottom - top;
    let w = availW, h = w / aspect;
    if (h > availH) { h = availH; w = h * aspect; }
    Object.assign($("mkFrame").style, { left: (window.innerWidth - w) / 2 + "px", top: top + (availH - h) / 2 + "px", width: w + "px", height: h + "px" });
  }
  window.addEventListener("resize", () => { if (maker) placeFrame(); });
  $("makeMapBtn").onclick = () => {
    fresh();
    if (!points.length) return toast("Nothing saved yet");
    // Pick in the notebook: nothing ticked, so you choose exactly what goes on the map
    selecting = "map";
    picked.clear();
    $("drawer").classList.add("selecting");
    openDrawer();
    toast("Tick what goes on the map, then Make map");
  };
  $("mkCancel").onclick = () => {
    const unsaved = mkSet.filter((m) => !m.saved).length;
    if (unsaved && !confirm(`Close without saving? ${unsaved} map${unsaved > 1 ? "s" : ""} not saved or sent will be lost.`)) return;
    endMaker();
  };
  $("mkOrient").onclick = () => {
    maker.orient = maker.orient === "portrait" ? "landscape" : "portrait";
    $("mkOrient").textContent = maker.orient === "portrait" ? "Landscape" : "Portrait";
    placeFrame();
  };
  $("mkMe").onclick = () => {
    maker.me = !maker.me;
    $("mkMe").textContent = maker.me ? "Me: on" : "Me: off";
    $("mkMe").classList.toggle("on", maker.me);
    if (maker.me && !here) startGps(false);
  };
  $("mkLayers").onclick = (e) => {
    e.stopPropagation();
    if (layersEl.style.display === "block") { layersEl.style.display = "none"; return; }
    drawLayerMenu();
    layersEl.style.display = "block";
    const r = $("mkLayers").getBoundingClientRect();
    Object.assign(layersEl.style, { right: Math.max(8, window.innerWidth - r.right) + "px", top: "auto", bottom: window.innerHeight - r.top + 8 + "px" });
  };
  $("mkCols").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    maker.colour = b.dataset.c;
    for (const x of $("mkCols").children) x.classList.toggle("on", x === b);
  };
  $("mkTools").onclick = (e) => { const b = e.target.closest("button[data-t]"); if (b) setTool(b.dataset.t); };
  function setTool(t) {
    maker.tool = t;
    for (const b of $("mkTools").querySelectorAll("button[data-t]")) b.classList.toggle("on", b.dataset.t === t);
    $("maker").classList.toggle("drawing", t !== "move");
    $("mkSyms").hidden = t !== "sym";
    placeFrame(); // the symbol palette makes the bar taller: keep the whole frame in view
    $("mkHint").textContent = { move: "Move and zoom the map to fill the frame. Tap a point to leave it off, or a drawing to remove it.", pen: "Draw with your finger. Move to pan the map again.", arrow: "Drag from the tail to the point of the arrow.", text: "Tap where the label goes.", sym: "Pick a symbol, then tap where it goes. They're listed in a key on the map." }[t];
  }
  $("mkSyms").innerHTML = Object.entries(SYMBOLS).map(([k, v]) => `<button type="button" data-s="${k}" class="${k === "parking" ? "on" : ""}">${symSvg(k, 26)}<span>${v.short || v.name}</span></button>`).join("");
  $("mkSyms").onclick = (e) => {
    const b = e.target.closest("button[data-s]");
    if (!b) return;
    maker.sym = b.dataset.s;
    for (const x of $("mkSyms").children) x.classList.toggle("on", x === b);
  };
  // Undo steps back through everything drawn and removed, so a drawing removed by mistake
  // comes back
  function addDrawn(d) { maker.drawn.push(d); maker.history.push({ op: "add", d }); }
  $("mkUndo").onclick = () => {
    const h = maker.history.pop();
    if (!h) return toast("Nothing to undo");
    if (h.op === "add") { mkDrawLayer.removeLayer(h.d.layer); maker.drawn = maker.drawn.filter((x) => x !== h.d); return; }
    mkDrawLayer.addLayer(h.d.layer);
    maker.drawn.splice(Math.min(h.at, maker.drawn.length), 0, h.d);
    if (h.d.type === "arrow") drawArrow(h.d);
  };
  // In Move, a tap on a drawing, arrow, label or symbol removes it (Undo brings it back)
  function mkTap(e) {
    if (maker.tool !== "move") return false;
    const p = e.containerPoint;
    let best = null, bestD = 16;
    for (const d of maker.drawn) {
      const pts = d.pts.map((q) => map.latLngToContainerPoint(q));
      let dist = Infinity;
      if (d.type === "sym") dist = pts[0].distanceTo(p) - 12;
      else if (d.type === "text") dist = Math.abs(p.x - pts[0].x) < d.text.length * 5 + 8 && Math.abs(p.y - pts[0].y) < 16 ? 0 : Infinity;
      else for (let i = 1; i < pts.length; i++) dist = Math.min(dist, L.LineUtil.pointToSegmentDistance(p, pts[i - 1], pts[i]));
      if (dist < bestD) { bestD = dist; best = d; }
    }
    if (!best) return false;
    const at = maker.drawn.indexOf(best);
    maker.drawn.splice(at, 1);
    mkDrawLayer.removeLayer(best.layer);
    maker.history.push({ op: "del", d: best, at });
    haptic();
    toast("Removed. Undo brings it back");
    return true;
  }

  // Drawing: kept as map positions, so it stays put as the map moves and is drawn again,
  // sharp, in the picture. Plain colour, no outline, so lines meet and join up neatly
  const ink = (ll, colour, weight) => L.polyline(ll, { color: colour, weight, lineCap: "round", lineJoin: "round", interactive: false });
  function arrowHead(a, b, size) { // in projected px at the current zoom: two barbs at b
    const pa = map.latLngToLayerPoint(a), pb = map.latLngToLayerPoint(b), ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
    const barb = (d) => map.layerPointToLatLng(L.point(pb.x - size * Math.cos(ang + d), pb.y - size * Math.sin(ang + d)));
    return [barb(0.45), b, barb(-0.45)];
  }
  function drawArrow(d) {
    d.layer.clearLayers();
    d.layer.addLayer(ink([d.pts[0], d.pts[1]], d.colour, 5));
    d.layer.addLayer(ink(arrowHead(d.pts[0], d.pts[1], 18), d.colour, 5));
  }
  map.on("zoomend", () => { if (maker) for (const d of maker.drawn) if (d.type === "arrow") drawArrow(d); });
  let stroke = null;
  const llAt = (e) => map.containerPointToLatLng(L.point(e.clientX - map.getContainer().getBoundingClientRect().left, e.clientY - map.getContainer().getBoundingClientRect().top));
  $("mkDraw").addEventListener("pointerdown", (e) => {
    if (!maker || maker.tool === "move") return;
    e.preventDefault();
    if (maker.tool === "sym") {
      const d = { type: "sym", sym: maker.sym, pts: [llAt(e)], layer: L.layerGroup().addTo(mkDrawLayer) };
      L.marker(d.pts[0], { interactive: false, icon: L.divIcon({ className: "mksym", iconSize: [28, 28], iconAnchor: [14, 14], html: symSvg(d.sym, 28) }) }).addTo(d.layer);
      addDrawn(d);
      return;
    }
    if (maker.tool === "text") { mkTextAt = llAt(e); $("mkTextIn").value = ""; $("mkTextModal").hidden = false; setTimeout(() => $("mkTextIn").focus(), 50); return; }
    $("mkDraw").setPointerCapture(e.pointerId);
    stroke = { type: maker.tool, colour: maker.colour, pts: [llAt(e)], layer: L.layerGroup().addTo(mkDrawLayer) };
    if (stroke.type === "arrow") stroke.pts.push(stroke.pts[0]);
  });
  $("mkDraw").addEventListener("pointermove", (e) => {
    if (!stroke) return;
    const ll = llAt(e);
    if (stroke.type === "pen") {
      const last = map.latLngToContainerPoint(stroke.pts[stroke.pts.length - 1]), p = map.latLngToContainerPoint(ll);
      if (last.distanceTo(p) < 3) return;
      stroke.pts.push(ll);
      stroke.layer.clearLayers().addLayer(ink(stroke.pts, stroke.colour, 5));
    } else { stroke.pts[1] = ll; drawArrow(stroke); }
  });
  const endStroke = () => {
    if (!stroke) return;
    const s = stroke;
    stroke = null;
    const big = s.pts.length > 1 && map.latLngToContainerPoint(s.pts[0]).distanceTo(map.latLngToContainerPoint(s.pts[s.pts.length - 1])) > 6;
    if (s.type === "pen" ? s.pts.length < 2 : !big) { mkDrawLayer.removeLayer(s.layer); return; }
    addDrawn(s);
  };
  $("mkDraw").addEventListener("pointerup", endStroke);
  $("mkDraw").addEventListener("pointercancel", endStroke);
  let mkTextAt = null;
  $("mkTextCancel").onclick = () => { $("mkTextModal").hidden = true; };
  $("mkTextForm").onsubmit = (e) => {
    e.preventDefault();
    const text = $("mkTextIn").value.trim();
    $("mkTextModal").hidden = true;
    $("mkTextIn").blur();
    if (!text || !mkTextAt) return;
    const d = { type: "text", colour: maker.colour, pts: [mkTextAt], text, layer: L.layerGroup().addTo(mkDrawLayer) };
    L.marker(mkTextAt, { interactive: false, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<span class="mklabel" style="color:${d.colour}">${esc(text)}</span>` }) }).addTo(d.layer);
    addDrawn(d);
  };

  // ---------- the picture ----------
  // A set of maps goes out together (e.g. roads to the reserve, then the paths on it): Add
  // another keeps this one and goes back to frame the next; Save keeps the set in the
  // notebook; Send sends the whole set at once, and saves it too
  let mkCur = null, mkSet = [];
  const mkSendLabel = () => { $("mkSend").textContent = mkSet.length ? `Make (${mkSet.length} ready)` : "Make"; };
  // Made: every map in the set side by side, swipe to review them, the newest showing
  function mkMode(made) {
    $("mkBtnsMake").hidden = made;
    $("mkBtnsDone").hidden = !made;
    $("mkBackMap").hidden = !made; // before a picture is made, the Back button does this
    const box = $("mkPreviews"), set = made ? theSet() : [];
    box.hidden = !made;
    box.innerHTML = set.map(() => '<img alt="A map in this set">').join("");
    set.forEach((m, i) => { m.url = m.url || URL.createObjectURL(m.blob); box.children[i].src = m.url; });
    $("mkCount").hidden = set.length < 2;
    $("mkShareSet").textContent = `Send (${set.length})`;
    mkSavedLabel();
    if (made) requestAnimationFrame(() => { box.scrollLeft = box.scrollWidth; mkWhich(); });
  }
  // Save says so on the button (a toast would sit behind the card)
  function mkSavedLabel() {
    const all = theSet().length && theSet().every((m) => m.saved);
    $("mkSaveSet").textContent = all ? "Saved ✓" : "Save";
    $("mkSaveSet").disabled = !!all;
  }
  function mkWhich() {
    const box = $("mkPreviews"), n = box.children.length, i = Math.round(box.scrollLeft / (box.clientWidth || 1));
    $("mkCount").textContent = `Map ${Math.min(n, i + 1)} of ${n} · swipe to review`;
  }
  $("mkPreviews").addEventListener("scroll", mkWhich, { passive: true });
  $("mkSend").onclick = () => {
    layersEl.style.display = "none";
    const res = viewedReserve(), d = new Date();
    if (!$("mkTitle").value) $("mkTitle").value = `${res || "Map"} · ${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
    mkCur = null;
    $("mkMake").textContent = "Make picture";
    mkMode(false);
    $("mkSendModal").hidden = false;
  };
  $("mkSendCancel").onclick = () => { $("mkSendModal").hidden = true; };
  $("mkTitle").oninput = $("mkNote").oninput = () => { if (mkCur) { mkCur = null; mkMode(false); } };
  // Everything needed to make this map again, or open it to change it
  function mapDef(title, note) {
    const f = frameRect(), box = map.getContainer().getBoundingClientRect();
    const nw = map.containerPointToLatLng([f.left - box.left, f.top - box.top]), se = map.containerPointToLatLng([f.right - box.left, f.bottom - box.top]);
    return {
      id: maker.editId || "map" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), title, note, orient: maker.orient,
      nw: [nw.lat, nw.lng], se: [se.lat, se.lng], layer: current, shade: shadeOn, me: maker.me,
      keys: [...maker.keys], off: [...maker.off], drawn: maker.drawn.map(({ type, colour, pts, text, sym }) => ({ type, colour, pts: pts.map((q) => [q.lat, q.lng]), text, sym })),
    };
  }
  $("mkSendForm").onsubmit = async (e) => {
    e.preventDefault();
    $("mkMake").textContent = "Making…";
    const title = $("mkTitle").value.trim(), note = $("mkNote").value.trim();
    try { mkCur = { blob: await renderMap(title, note), def: mapDef(title, note) }; }
    catch (err) { console.warn("map", err); $("mkMake").textContent = "Make picture"; return toast("Couldn't make the picture. Try again with signal"); }
    mkMode(true);
  };
  $("mkAnother").onclick = () => {
    mkSet.push(mkCur);
    mkCur = null;
    maker.editId = null; // the next map is a new one, even when this one was opened to change it
    $("mkSendModal").hidden = true;
    $("mkTitle").value = "";
    mkSendLabel();
    toast(`Map ${mkSet.length} kept. Frame the next one`);
  };
  const mapFile = (m, i) => new File([m.blob], `${String(i + 1).padStart(2, "0")}-${(m.def.title || "map").replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").slice(0, 40)}.jpg`, { type: "image/jpeg" });
  const theSet = () => mkSet.concat(mkCur ? [mkCur] : []);
  async function saveSet() {
    try { for (const m of theSet()) if (!m.saved) { await saveMap(m.def, m.blob); m.saved = true; } }
    catch { toast("Couldn't save: the phone may be out of space"); }
    mkSavedLabel();
  }
  $("mkShareSet").onclick = async () => {
    const files = theSet().map(mapFile);
    // Saved as well, so a sent map can always be found again. Not waited for: the share
    // sheet has to open straight from the tap or the iPhone refuses it
    saveSet();
    if (navigator.canShare && navigator.canShare({ files })) { try { await navigator.share({ files }); } catch {} return; }
    for (const f of files) { const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); }
  };
  $("mkSaveSet").onclick = saveSet;
  // Back from the picture to the map: this picture is dropped (you're going to change it);
  // maps already added to the set stay
  $("mkBackMap").onclick = () => { mkCur = null; $("mkSendModal").hidden = true; };

  // ---------- saved maps ----------
  // The picture is kept with the photos (on this phone); what made it, beside the notebook,
  // so a saved map can be sent again or opened to change it
  const savedMaps = () => store.get("maps", []);
  async function saveMap(def, blob) {
    await photoDB.put("map:" + def.id, blob);
    const maps = savedMaps().filter((m) => m.id !== def.id);
    maps.unshift(def);
    if (!store.set("maps", maps)) throw new Error("full");
  }
  function showDrawn(d) {
    d.layer = L.layerGroup().addTo(mkDrawLayer);
    if (d.type === "pen") d.layer.addLayer(ink(d.pts, d.colour, 5));
    if (d.type === "arrow") drawArrow(d);
    if (d.type === "text") L.marker(d.pts[0], { interactive: false, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<span class="mklabel" style="color:${d.colour}">${esc(d.text)}</span>` }) }).addTo(d.layer);
    if (d.type === "sym") L.marker(d.pts[0], { interactive: false, icon: L.divIcon({ className: "mksym", iconSize: [28, 28], iconAnchor: [14, 14], html: symSvg(d.sym, 28) }) }).addTo(d.layer);
  }
  function editMap(def) {
    $("mapsModal").hidden = true;
    const list = points.filter((p) => def.keys.includes(keyOf(p)));
    if (def.layer !== current && LAYERS[def.layer]) setBase(def.layer);
    startMaker(list, true);
    maker.editId = def.id;
    maker.orient = def.orient;
    $("mkOrient").textContent = def.orient === "portrait" ? "Landscape" : "Portrait";
    placeFrame();
    maker.off = new Set(def.off);
    maker.me = def.me;
    $("mkMe").textContent = def.me ? "Me: on" : "Me: off";
    $("mkMe").classList.toggle("on", !!def.me);
    for (const d of def.drawn) { const x = { ...d, pts: d.pts.map((q) => L.latLng(q[0], q[1])) }; showDrawn(x); maker.drawn.push(x); }
    const f = frameRect(), box = map.getContainer().getBoundingClientRect();
    map.fitBounds([def.nw, def.se], { paddingTopLeft: [f.left - box.left, f.top - box.top], paddingBottomRight: [box.right - f.right, box.bottom - f.bottom], animate: false });
    $("mkTitle").value = def.title;
    $("mkNote").value = def.note;
    drawPins();
  }
  async function showMaps() {
    const maps = savedMaps(), list = $("mapList");
    list.innerHTML = maps.length ? "" : '<p class="w3wnote">No saved maps.</p>';
    for (const def of maps) {
      const row = document.createElement("div");
      row.className = "mapitem";
      row.innerHTML = `<img alt=""><div><b></b><small></small><div class="mapacts"><button type="button" data-a="share">Share</button><button type="button" data-a="edit">Edit</button><button type="button" data-a="del" class="danger">Delete</button></div></div>`;
      row.querySelector("b").textContent = def.title || "Map";
      row.querySelector("small").textContent = `${dayLabel(def.at)} · ${def.orient}${def.note ? " · " + def.note : ""}`;
      photoDB.get("map:" + def.id).then((b) => { if (b) row.querySelector("img").src = URL.createObjectURL(b); }).catch(() => {});
      row.onclick = async (e) => {
        const a = e.target.closest("button[data-a]");
        if (!a) return;
        if (a.dataset.a === "edit") return editMap(def);
        if (a.dataset.a === "del") {
          if (!confirm(`Delete the map "${def.title || "Map"}"?`)) return;
          store.set("maps", savedMaps().filter((m) => m.id !== def.id));
          photoDB.del("map:" + def.id).catch(() => {});
          return showMaps();
        }
        const blob = await photoDB.get("map:" + def.id).catch(() => null);
        if (!blob) return toast("The picture's missing. Edit it to make it again");
        const files = [mapFile({ blob, def }, 0)];
        if (navigator.canShare && navigator.canShare({ files })) { try { await navigator.share({ files }); } catch {} }
      };
      list.appendChild(row);
    }
    $("mapsModal").hidden = false;
  }
  $("mapsClose").onclick = () => { $("mapsModal").hidden = true; if ($("drawer").classList.contains("open")) openDrawer(); };
  const loadImg = (src) => new Promise((ok) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  // Tiles for a layer at zoom z: our own fetch (not the screen's), so the picture is sharp at
  // its full size whatever the phone's screen
  function tileUrl(layer, x, y, z) {
    if (layer.wmsParams) {
      const ts = 256, nw = L.CRS.EPSG3857.pointToLatLng(L.point(x * ts, y * ts), z), se = L.CRS.EPSG3857.pointToLatLng(L.point((x + 1) * ts, (y + 1) * ts), z);
      const a = L.CRS.EPSG3857.project(nw), b = L.CRS.EPSG3857.project(se);
      return layer._url + L.Util.getParamString({ ...layer.wmsParams, width: ts, height: ts, crs: "EPSG:3857", srs: "EPSG:3857", bbox: [a.x, b.y, b.x, a.y].join(",") }, layer._url, true);
    }
    return L.Util.template(layer._url, { ...layer.options, x, y, z, s: (layer.options.subdomains || "abc")[Math.abs(x + y) % 3], r: "" });
  }
  async function drawTiles(ctx, layer, zE, origin, area, opts = {}) {
    const zt = Math.min(Math.ceil(zE), layer.options.maxNativeZoom || layer.options.maxZoom || 19), s = Math.pow(2, zE - zt), size = 256 * s;
    const x0 = Math.floor(origin.x / size), y0 = Math.floor(origin.y / size), x1 = Math.floor((origin.x + area.w) / size), y1 = Math.floor((origin.y + area.h) / size);
    const jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(loadImg(tileUrl(layer, x, y, zt)).then((img) => ({ img, x, y })));
    ctx.save();
    if (opts.blend) ctx.globalCompositeOperation = opts.blend;
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    if (opts.filter) ctx.filter = opts.filter;
    for (const { img, x, y } of await Promise.all(jobs)) if (img) ctx.drawImage(img, area.x + x * size - origin.x, area.y + y * size - origin.y, size + 0.5, size + 0.5);
    ctx.restore();
  }
  // Grid spacing: the finest of 100 m … 10 km that gives no more than 8 lines across
  const gridStep = (metres) => [100, 200, 500, 1000, 2000, 5000, 10000].find((s) => metres / s <= 8) || 10000;
  async function renderMap(title, note) {
    const [W, H] = MK[maker.orient], area = { x: 0, y: MK.head, w: W, h: H - MK.head - MK.foot };
    const f = frameRect(), box = map.getContainer().getBoundingClientRect();
    const nw = map.containerPointToLatLng([f.left - box.left, f.top - box.top]);
    const zE = map.getZoom() + Math.log2(area.w / f.width), origin = map.project(nw, zE);
    const P = (ll) => map.project(ll, zE).subtract(origin).add([area.x, area.y]);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip();
    ctx.fillStyle = "#eef0ea"; ctx.fillRect(area.x, area.y, area.w, area.h);
    // The map: the layer on screen (the offline OS map sits on OS Outdoor, as on screen),
    // then the LiDAR shading if it's on, blended the same way
    if (current === "os" && LAYERS.outdoor) await drawTiles(ctx, LAYERS.outdoor.layer, zE, origin, area);
    await drawTiles(ctx, LAYERS[current].layer, zE, origin, area);
    if (shadeOn) {
      const near = map.getZoom() >= 14 && nearReserve();
      await drawTiles(ctx, near ? reliefLayer : lidarShade, zE, origin, area, { blend: "hard-light", alpha: shadePct / 100, filter: near ? "" : "brightness(.72) contrast(1.35)" });
    }
    const line = (pts, colour, width, dash) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.lineCap = ctx.lineJoin = "round"; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); };
    const halo = (text, x, y, font, colour, align = "left") => { ctx.font = font; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 6; ctx.strokeText(text, x, y); ctx.fillStyle = colour; ctx.fillText(text, x, y); };
    // Reserve boundaries in view: the edge, with the band inside
    for (const fe of nnr) if (isTeam(fe)) {
      const polys = fe.geometry.type === "Polygon" ? [fe.geometry.coordinates] : fe.geometry.coordinates;
      const path = new Path2D();
      for (const poly of polys) for (const r of poly) r.forEach(([x, y], i) => { const p = P([y, x]); i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y); });
      ctx.save(); ctx.clip(path, "evenodd"); ctx.strokeStyle = "rgba(217,72,15,.3)"; ctx.lineWidth = 30; ctx.stroke(path); ctx.restore();
      ctx.strokeStyle = "#d9480f"; ctx.lineWidth = 3; ctx.stroke(path);
    }
    // OS grid: lines across the map, numbered along the top and left edges like an OS sheet
    const gNW = OSGB.wgs84ToGrid(nw.lat, nw.lng), seLL = map.unproject(origin.add([area.w, area.h]), zE), gSE = OSGB.wgs84ToGrid(seLL.lat, seLL.lng);
    const step = gridStep(gSE.e - gNW.e), labels = [];
    for (let e = Math.ceil(gNW.e / step) * step; e <= gSE.e; e += step) {
      const a = P(OSGB.gridToWgs84(e, gNW.n + 2000)), b = P(OSGB.gridToWgs84(e, gSE.n - 2000));
      line([{ x: a.x, y: a.y }, { x: b.x, y: b.y }], "rgba(29,79,143,.6)", step >= 1000 ? 2 : 1.4);
      labels.push(["e", e, a.x + (b.x - a.x) * ((area.y - a.y) / (b.y - a.y || 1))]);
    }
    for (let n = Math.ceil(gSE.n / step) * step; n <= gNW.n; n += step) {
      const a = P(OSGB.gridToWgs84(gNW.e - 2000, n)), b = P(OSGB.gridToWgs84(gSE.e + 2000, n));
      line([{ x: a.x, y: a.y }, { x: b.x, y: b.y }], "rgba(29,79,143,.6)", step >= 1000 ? 2 : 1.4);
      labels.push(["n", n, a.y + (b.y - a.y) * ((area.x - a.x) / (b.x - a.x || 1))]);
    }
    // Labels: whole km as two figures ("33"), finer lines as four ("3350"), as on a 1:25k map
    const fig = (v) => (step >= 1000 ? String(Math.floor((v % 100000) / 1000)).padStart(2, "0") : String(Math.floor((v % 100000) / 10)).padStart(4, "0"));
    for (const [k, v, at] of labels) {
      if (k === "e" && at > area.x + 70 && at < area.x + area.w - 20) halo(fig(v), at + 4, area.y + 16, "700 22px ui-monospace, Menlo, monospace", "#1d4f8f");
      if (k === "n" && at > area.y + 40 && at < area.y + area.h - 10) halo(fig(v), area.x + 6, at - 13, "700 22px ui-monospace, Menlo, monospace", "#1d4f8f");
    }
    const sq = OSGB.gridRef(gNW.e, gNW.n, 2).slice(0, 2);
    ctx.fillStyle = "#1d4f8f"; ctx.fillRect(area.x, area.y, 50, 34);
    ctx.font = "700 22px ui-monospace, Menlo, monospace"; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(sq, area.x + 25, area.y + 18);
    // Your marks: lines and areas, then points, each named with its 8-figure grid ref
    const chosen = points.filter((p) => maker.keys.has(keyOf(p)) && !maker.off.has(keyOf(p)));
    for (const p of chosen) if (p.pts) {
      const c = COLOURS[p.colour] || COLOURS.orange, pts = p.pts.map((q) => P(q)), area2 = p.kind === "area";
      if (area2) { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.fillStyle = c + "33"; ctx.fill(); }
      const ring = area2 ? pts.concat([pts[0]]) : pts;
      line(ring, p.colour === "white" ? "#2b2b2b" : "#fff", 9);
      line(ring, c, 5);
    }
    const svgImg = (svg) => loadImg("data:image/svg+xml," + encodeURIComponent(svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ')));
    // Lines and arrows first, so symbols and names sit on top of them
    for (const d of maker.drawn) {
      const pts = d.pts.map((q) => P(q));
      if (d.type === "pen") line(pts, d.colour, 8);
      if (d.type === "arrow") {
        const [a, b] = pts, ang = Math.atan2(b.y - a.y, b.x - a.x), s = 34;
        const head = [{ x: b.x - s * Math.cos(ang + 0.45), y: b.y - s * Math.sin(ang + 0.45) }, b, { x: b.x - s * Math.cos(ang - 0.45), y: b.y - s * Math.sin(ang - 0.45) }];
        line([a, b], d.colour, 8); line(head, d.colour, 8);
      }
    }
    // Names never sit on a point, a symbol, another name or the key: everything already on the
    // map is a box to keep clear of, and each name takes the first free spot of eight around
    // its point (right, left, above, below, then the corners), or the least crowded one
    const taken = [], hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const overlap = (a) => taken.reduce((t, b) => t + (hit(a, b) ? (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * (Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) : 0), 0);
    const inArea = (a) => a.x >= area.x + 4 && a.y >= area.y + 4 && a.x + a.w <= area.x + area.w - 4 && a.y + a.h <= area.y + area.h - 4;
    taken.push({ x: area.x, y: area.y, w: 54, h: 38 }); // the square letters
    const marks = chosen.map((p) => { const c = centreOf(p); return { p, c, at: P(p.kind === "line" ? midOf(p) : [c.lat, c.lon]) }; });
    for (const m of marks) if (!m.p.pts) taken.push({ x: m.at.x - 22, y: m.at.y - 22, w: 44, h: 44 });
    const syms = maker.drawn.filter((d) => d.type === "sym").map((d) => ({ d, at: P(d.pts[0]) }));
    for (const s of syms) taken.push({ x: s.at.x - 24, y: s.at.y - 24, w: 48, h: 48 });
    for (const d of maker.drawn) if (d.type === "text") {
      ctx.font = "800 30px -apple-system, system-ui, sans-serif";
      const at = P(d.pts[0]), w = ctx.measureText(d.text).width + 10;
      taken.push({ x: at.x - w / 2, y: at.y - 20, w, h: 40 });
    }
    // The key: every symbol used, in a white box in the bottom-left corner of the map
    const used = [...new Set(syms.map((s) => s.d.sym))];
    let key = null;
    if (used.length) {
      ctx.font = "600 20px -apple-system, system-ui, sans-serif";
      const items = used.map((k) => ({ k, w: 36 + ctx.measureText(SYMBOLS[k].name).width + 22 })), rows = [[]], maxW = area.w * 0.62;
      let rowW = 0;
      for (const it of items) { if (rowW + it.w > maxW && rows[rows.length - 1].length) { rows.push([]); rowW = 0; } rows[rows.length - 1].push(it); rowW += it.w; }
      const w = Math.max(...rows.map((r) => r.reduce((t, it) => t + it.w, 0))) + 14, h = rows.length * 42 + 12;
      key = { x: area.x + 10, y: area.y + area.h - h - 10, w, h, rows };
      taken.push(key);
    }
    for (const m of marks) {
      const name = m.p.name, ref = OSGB.gridRef(m.c.e, m.c.n, 8);
      ctx.font = "700 24px -apple-system, system-ui, sans-serif";
      const w1 = ctx.measureText(name).width;
      ctx.font = "600 20px ui-monospace, Menlo, monospace";
      const w = Math.max(w1, ctx.measureText(ref).width) + 10, h = 54, g = m.p.pts ? 8 : 24, { x, y } = m.at;
      const spots = [[x + g, y - h / 2], [x - g - w, y - h / 2], [x - w / 2, y - g - h], [x - w / 2, y + g], [x + g - 6, y - g - h + 6], [x + g - 6, y + g - 6], [x - g - w + 6, y - g - h + 6], [x - g - w + 6, y + g - 6]]
        .map(([bx, by]) => ({ x: bx, y: by, w, h }));
      const best = spots.find((b) => inArea(b) && !overlap(b)) || spots.filter(inArea).sort((a, b) => overlap(a) - overlap(b))[0] || spots[0];
      taken.push(best);
      halo(name, best.x + 5, best.y + 15, "700 24px -apple-system, system-ui, sans-serif", "#1b1a15");
      halo(ref, best.x + 5, best.y + 40, "600 20px ui-monospace, Menlo, monospace", "#1b1a15");
    }
    // Point markers and symbols on top, then the drawn labels
    for (const m of marks) if (!m.p.pts) { const img = await svgImg(shapeSvg(m.p.shape, m.p.colour, 40)); if (img) ctx.drawImage(img, m.at.x - 20, m.at.y - 20, 40, 40); }
    for (const s of syms) { const img = await svgImg(symSvg(s.d.sym, 44)); if (img) ctx.drawImage(img, s.at.x - 22, s.at.y - 22, 44, 44); }
    for (const d of maker.drawn) if (d.type === "text") { const at = P(d.pts[0]); halo(d.text, at.x, at.y, "800 30px -apple-system, system-ui, sans-serif", d.colour, "center"); }
    if (key) {
      ctx.fillStyle = "rgba(255,255,255,.93)"; ctx.strokeStyle = "#1b1a15"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(key.x, key.y, key.w, key.h, 8); ctx.fill(); ctx.stroke();
      let ky = key.y + 8;
      for (const row of key.rows) {
        let kx = key.x + 8;
        for (const it of row) {
          const img = await svgImg(symSvg(it.k, 30));
          if (img) ctx.drawImage(img, kx, ky + 3, 30, 30);
          ctx.font = "600 20px -apple-system, system-ui, sans-serif"; ctx.fillStyle = "#1b1a15"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
          ctx.fillText(SYMBOLS[it.k].name, kx + 36, ky + 19);
          kx += it.w;
        }
        ky += 42;
      }
    }
    if (maker.me && here) {
      const p = P([here.lat, here.lon]);
      ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, Math.PI * 2); ctx.fillStyle = "#1a73e8"; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = "#fff"; ctx.stroke();
      halo(`Me, ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`, p.x + 22, p.y, "700 22px -apple-system, system-ui, sans-serif", "#1a73e8");
    }
    ctx.restore();
    // Header: title and note
    ctx.fillStyle = "#1b1a15"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.font = "800 46px -apple-system, system-ui, sans-serif"; ctx.fillText(title || "Map", 28, 62, W - 56);
    ctx.font = "26px -apple-system, system-ui, sans-serif"; ctx.fillStyle = "#4a4a42";
    ctx.fillText(note || new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }), 28, 104, W - 56);
    // Footer: scale bar, copyright, north
    const fy = H - MK.foot, mpp = map.unproject(origin.add([0, area.h / 2]), zE).distanceTo(map.unproject(origin.add([100, area.h / 2]), zE)) / 100;
    const nice = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000].filter((m) => m / mpp <= W * 0.28).pop() || 10, bar = nice / mpp;
    ctx.fillStyle = "#1b1a15"; ctx.fillRect(28, fy + 34, bar, 10); ctx.fillStyle = "#fff"; ctx.fillRect(28 + bar / 2, fy + 36, bar / 2 - 2, 6);
    ctx.fillStyle = "#1b1a15"; ctx.font = "600 22px -apple-system, system-ui, sans-serif"; ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 28, fy + 74);
    ctx.font = "16px -apple-system, system-ui, sans-serif"; ctx.fillStyle = "#4a4a42"; ctx.textAlign = "center";
    const credit = current === "aerial" ? "Imagery © Esri, Maxar, Earthstar Geographics · OS grid © Crown copyright" : "Contains OS data © Crown copyright and database rights 2026";
    ctx.fillText(credit, W / 2, fy + 40, W - 400);
    ctx.fillText(`Reserve boundaries © Natural England · ${new Date().toLocaleDateString("en-GB")}`, W / 2, fy + 64, W - 400);
    const nx = W - 60, ny = fy + 48;
    ctx.beginPath(); ctx.moveTo(nx, ny - 30); ctx.lineTo(nx + 14, ny + 10); ctx.lineTo(nx, ny + 2); ctx.lineTo(nx - 14, ny + 10); ctx.closePath(); ctx.fillStyle = "#1b1a15"; ctx.fill();
    ctx.font = "800 22px -apple-system, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("N", nx, ny + 34);
    ctx.strokeStyle = "#1b1a15"; ctx.lineWidth = 2; ctx.strokeRect(area.x + 1, area.y + 1, area.w - 2, area.h - 2);
    return new Promise((ok, bad) => cv.toBlob((b) => (b ? ok(b) : bad(new Error("no picture"))), "image/jpeg", 0.9));
  }
  function drawChips() {
    const keepScroll = $("chips").scrollLeft;
    $("chips").innerHTML = "";
    for (const [code, name] of TEAM) {
      const f = nnr.find((x) => x.properties.REF_CODE === code);
      if (!f) continue;
      const b = document.createElement("button");
      b.textContent = name;
      b.onclick = () => goReserve(f);
      $("chips").appendChild(b);
    }
    $("chips").scrollLeft = keepScroll;
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
    bandLayer.clearLayers().addData(gj);
    drawMask();
    closeUp();
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
    // (walked points are a few metres apart: just the line, no dots, apart from the first)
    pts.forEach((p, i) => (i && p.walked) || L.circleMarker(p, { radius: i ? 6 : 8, color: "#fff", weight: 3, fillColor: "#c0392b", fillOpacity: 1, interactive: false }).addTo(mDots));
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
  // Walk it: the line follows you, a point every few metres as GPS moves. Only while the
  // screen is on: an iPhone web app gets no GPS when locked or in the background, so the
  // screen is kept awake, and a gap (if it locks anyway) is joined with a straight line.
  let walkLock = null;
  async function keepAwake() { try { walkLock = await navigator.wakeLock.request("screen"); } catch {} }
  function walkStep() {
    if (!here || here.acc > 20) return; // a poor fix would put a zigzag in the line
    const ll = L.latLng(here.lat, here.lon), last = measure.pts[measure.pts.length - 1];
    ll.walked = true;
    if (last && last.distanceTo(ll) < Math.max(4, here.acc * 0.6)) return;
    measure.pts.push(ll);
    drawMeasure();
  }
  function setWalk(on) {
    if (!measure || !!measure.walking === on) return;
    measure.walking = on;
    const b = $("mWalk");
    b.classList.toggle("walking", on);
    b.lastChild.textContent = on ? "Stop" : "Walk it";
    if (on) {
      startGps(true);
      keepAwake();
      walkStep();
      toast("Walking: points add as you go. Keep the screen on");
    } else {
      try { walkLock && walkLock.release(); } catch {}
      walkLock = null;
      toast(`Walk stopped: ${measure.pts.length} points, ${fmtDist(mStats(measure.pts).d)}`);
    }
  }
  $("mWalk").onclick = () => setWalk(!(measure && measure.walking));
  document.addEventListener("visibilitychange", () => {
    if (!(measure && measure.walking)) return;
    if (document.visibilityState === "visible") { keepAwake(); toast("Back: the line joins straight across the gap"); }
  });
  $("mUndo").onclick = () => { if (!measure.pts.length) return; measure.pts.pop(); drawMeasure(); toast(measure.pts.length ? `Back to ${measure.pts.length} point${measure.pts.length > 1 ? "s" : ""}` : "No points"); };
  $("mSave").onclick = () => {
    setWalk(false);
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
    setWalk(false);
    measure = null;
    for (const l of [mLine, mLive, mDots]) map.removeLayer(l);
    keepTarget(() => document.body.classList.remove("measuring", "area-mode"));
  };
  for (const id of ["mDist", "mArea", "mHa"]) $(id).parentElement.onclick = () => { const v = $(id).textContent; if (v !== "—") copy(v, $(id).parentElement); };
  map.on("move", () => { if (measure) drawMeasure(); });

  // ---------- the + button, and photos with the grid ref stamped on ----------
  // One + button: tap it for Point, Line and Area; tap again (or pick one, or leave it 10 s
  // without touching anything) and they tuck away. Moving the map keeps them open, so you can
  // line up the crosshair and then pick. Photos are added in the Save popup of any of them.
  let addTimer = null;
  const HOLD_MS = 900;
  function setAdding(on) {
    document.body.classList.toggle("adding", on);
    $("addBtn").setAttribute("aria-expanded", on);
    clearTimeout(addTimer);
    if (on) addTimer = setTimeout(() => setAdding(false), 10000);
  }
  // Hold + for "photograph it and keep walking": the camera opens at once, and the photo is
  // saved as a pin where you're standing (GPS, else the crosshair) with an automatic name.
  // Three arcs fan out from the button, up and right (clear of the screen edge and a right
  // thumb), lighting one at a time (with a tick each where the phone allows); let go after the
  // third. It acts as the finger lifts: an iPhone sends no click after a long press.
  let holdAt = 0, holdTimers = [], skipClick = 0;
  const addBtn = $("addBtn");
  addBtn.insertAdjacentHTML("beforeend", '<svg class="holdring" viewBox="0 0 100 100" aria-hidden="true">' +
    [33, 43, 53].map((r, i) => `<circle class="h${i + 1}" cx="50" cy="50" r="${r}" pathLength="360" stroke-dasharray="56 304" transform="rotate(-73 50 50)"/>`).join("") + "</svg>");
  addBtn.addEventListener("pointerdown", () => {
    holdAt = Date.now();
    skipClick = 0; // a new press: its own click counts
    unhold();
    holdTimers = [1, 2, 3].map((n) => setTimeout(() => {
      addBtn.classList.add("h" + n);
      if (n === 3) addBtn.classList.add("held"); // "let go now"
      haptic();
    }, (HOLD_MS * n) / 3));
    holdTimers.push(setTimeout(() => { holdAt = 0; unhold(); }, HOLD_MS + 5000)); // never left stuck if the lift goes missing
  });
  const unhold = () => { holdTimers.forEach(clearTimeout); addBtn.classList.remove("held", "h1", "h2", "h3"); };
  // (not pointerleave: on a touch screen it fires as the finger lifts, before the click)
  // The finger lifting ends the hold; so does iOS cancelling a long touch, which it may do.
  // Either way a full hold opens the camera
  const endHold = () => {
    const held = holdAt && Date.now() - holdAt >= HOLD_MS;
    holdAt = 0;
    unhold();
    if (!held) return; // a tap: the click that follows opens the menu
    skipClick = Date.now(); // in case a click does follow (desktop, Android), it mustn't open the menu
    setAdding(false);
    haptic();
    quickPhoto();
  };
  addBtn.addEventListener("pointerup", endHold);
  addBtn.addEventListener("pointercancel", endHold);
  addBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  addBtn.onclick = () => {
    if (Date.now() - skipClick < 800) return; // the end of a hold, already handled
    setAdding(!document.body.classList.contains("adding"));
  };
  function quickPhoto() {
    if (!last || !last.ref) return toast("Outside the GB grid: move the crosshair onto Britain");
    photoFor = "quick";
    $("photoIn").click();
  }
  map.on("move", () => { if (document.body.classList.contains("adding")) setAdding(true); });
  for (const id of ["saveBtn", "measureBtn", "areaBtn"]) $(id).addEventListener("click", () => setAdding(false));
  $("photoIn").onchange = (e) => stampPhoto(e, false);
  $("photoPick").onchange = (e) => stampPhoto(e, true);
  // The stamp says where you were standing when you took it: GPS, or for one chosen from the
  // phone, where the photo says it was taken. Without either, the place of the thing it's of.
  async function stampPhoto(e, fromPhone) {
    const file = e.target.files[0];
    e.target.value = "";
    const mode = photoFor;
    photoFor = null;
    if (!file || !mode || (mode === "draft" && !draft)) return;
    toast("Stamping the photo…");
    const ex = fromPhone ? await EXIF.read(file) : {};
    const thing = mode === "draft" ? centreOf(saving) : { lat: last.lat, lon: last.lon };
    const where = ex.lat != null ? { lat: ex.lat, lon: ex.lon, src: "Photo's location" }
      : here && !fromPhone ? { lat: here.lat, lon: here.lon, src: `GPS ±${Math.round(here.acc)} m` }
      : { lat: thing.lat, lon: thing.lon, src: "" };
    if (fromPhone && ex.lat == null) toast("No location in that photo: stamped with this " + ({ line: "line", area: "area" }[saving.kind] || "point") + "'s");
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
    stampJob = { line: "", base, name: `${ref.replace(/\s+/g, "")}_${stamp}.jpg`, ref, ll: `${where.lat.toFixed(5)}, ${where.lon.toFixed(5)}`,
      when: `${when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} ${timeOf(when.toISOString())}`,
      reserve: reserve.replace(/ \(NNR\)$/, ""), src: where.src };
    photoNew = { lat: where.lat, lon: where.lon, acc: where.src.startsWith("GPS") ? Math.round(here.acc) : null, mode };
    viewing = null;
    // Hold +: no screen in between, stamped your usual way and saved
    if (mode === "quick") { await restamp(); return keepPhoto(); }
    $("photoSave").hidden = false;
    if ($("photoStrip")) $("photoStrip").hidden = true;
    drawStampOpts();
    await restamp();
    // Sharing needs a fresh tap (the camera one has expired by now), so show it with a button.
    // On iPhone the share sheet has "Save Image" for the Photos library.
    $("photoModal").hidden = false;
  }
  // What goes on the stamp: tick and it redraws. Remembered for next time.
  // Where the position came from (GPS ±m, the photo's own) always rides along with the
  // location, so nobody trusts a guess as a GPS fix
  const STAMP_OPTS = [["ref", "Grid ref"], ["ll", "Lat/long"], ["when", "Date & time"], ["reserve", "Reserve"], ["line", "Add notes"]];
  let stampJob = null, stampOn = new Set(store.get("stampOpts", ["ref", "when", "reserve"]));
  function drawStampOpts() {
    $("stampOpts").hidden = false;
    $("stampOpts").innerHTML = STAMP_OPTS.filter(([k]) => k !== "reserve" || stampJob.reserve)
      .map(([k, l]) => `<button type="button" data-k="${k}" class="${stampOn.has(k) ? "on" : ""}">${l}</button>`).join("");
    // "Add notes": a line typed for this photo only. Never remembered: last week's note on
    // today's photo would be worse than nothing
    $("stampLine").hidden = !stampOn.has("line");
    $("stampLine").value = stampJob.line || "";
  }
  let lineTimer = null;
  $("stampLine").addEventListener("input", () => {
    if (stampJob) stampJob.line = $("stampLine").value.trim();
    clearTimeout(lineTimer);
    lineTimer = setTimeout(restamp, 300);
  });
  $("stampLine").addEventListener("keydown", (e) => { if (e.key === "Enter") $("stampLine").blur(); });
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
    const sub = [head ? j.src : "", stampOn.has("ll") && stampOn.has("ref") ? j.ll : "", stampOn.has("when") ? j.when : ""].filter(Boolean).join(" · ");
    if (sub) lines.push({ t: sub, f: small });
    if (stampOn.has("reserve") && j.reserve) lines.push({ t: j.reserve, f: small });
    const mine = stampOn.has("line") && j.line;
    if (mine) lines.push({ t: mine, f: `700 ${u}px -apple-system, sans-serif` });
    if (lines.length) {
      // The team's stamp: a "FIELD NOTES" mark over the details and a spruce bar down the
      // side, so a stamped photo is recognisable wherever it's been sent
      const mark = { t: "FIELD NOTES", f: `800 ${Math.round(u * 0.72)}px -apple-system, sans-serif`, c: "#8cc2b8", sp: Math.round(u * 0.18) };
      lines.unshift(mark);
      const pad = Math.round(u * 0.6), m = Math.round(u * 0.8), bar = Math.round(u * 0.32), lh = (l) => parseInt(l.f.match(/(\d+)px/)[1]) * 1.28;
      const wide = (l) => { ctx.font = l.f; return ctx.measureText(l.t).width + (l.sp ? l.sp * l.t.length : 0); };
      const w = Math.max(...lines.map(wide)) + pad * 2 + bar;
      const h = lines.reduce((s, l) => s + lh(l), 0) + pad * 2 - u * 0.2, top = c.height - m - h;
      ctx.fillStyle = "rgba(0,0,0,.58)";
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(m, top, w, h, u * 0.5) : ctx.rect(m, top, w, h);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "#2e6560";
      ctx.fillRect(m, top, bar, h);
      ctx.restore();
      ctx.textBaseline = "top";
      let y = top + pad;
      for (const l of lines) {
        ctx.font = l.f;
        ctx.fillStyle = l.c || "#fff";
        if (l.sp && "letterSpacing" in ctx) { ctx.letterSpacing = l.sp + "px"; ctx.fillText(l.t, m + bar + pad, y); ctx.letterSpacing = "0px"; }
        else ctx.fillText(l.t, m + bar + pad, y);
        y += lh(l);
      }
    }
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
    photoFile = new File([blob], j.name, { type: "image/jpeg" });
    if ($("photoOut").src.startsWith("blob:")) URL.revokeObjectURL($("photoOut").src);
    $("photoOut").src = URL.createObjectURL(photoFile);
  }
  let photoFile = null, photoNew = null, viewing = null;
  // Add: into the popup's photos, or (hold +) straight into the notebook as a pin
  async function keepPhoto() {
    const ph = photoNew;
    if (!photoFile || !ph) return;
    const id = "ph" + Date.now();
    try { await photoDB.put(id, photoFile); } catch { return toast("Couldn't save the photo on this phone"); }
    const rec = { id, lat: +ph.lat.toFixed(6), lon: +ph.lon.toFixed(6), acc: ph.acc };
    closePhoto();
    if (ph.mode === "draft") {
      if (!draft) { photoDB.del(id).catch(() => {}); return; }
      draft.photos.push(rec);
      draft.added.add(id);
      return drawDraft();
    }
    fresh();
    const g = OSGB.wgs84ToGrid(ph.lat, ph.lon), name = autoName("point", ph.lat, ph.lon);
    points.unshift({ name, notes: "", colour: store.get("ptColour", "magenta"), shape: store.get("ptShape", "circle"), kind: "point",
      lat: ph.lat, lon: ph.lon, e: Math.round(g.e), n: Math.round(g.n), acc: ph.acc, photos: [rec], at: new Date().toISOString() });
    persist();
    if (savePoints()) toast("📷 Stamped and pinned: " + name);
  }
  $("photoSave").onclick = keepPhoto;
  // A thing's photos: one big, the rest as a strip to tap through. Share sends the one showing.
  async function viewPhotos(pt, i = 0) {
    const phs = photosOf(pt);
    if (!phs.length) return;
    viewing = { pt, i };
    stampJob = null;
    photoNew = null;
    $("stampOpts").hidden = true;
    $("stampLine").hidden = true;
    $("photoSave").hidden = true;
    const strip = $("photoStrip");
    if (strip) {
      for (const im of strip.querySelectorAll("img")) if (im.src.startsWith("blob:")) URL.revokeObjectURL(im.src);
      strip.innerHTML = "";
      strip.hidden = phs.length < 2;
      if (phs.length > 1) phs.forEach((ph, k) => {
        const im = document.createElement("img");
        im.alt = "Photo " + (k + 1);
        im.onclick = () => showPhoto(k);
        photoDB.get(ph.id).then((b) => { if (b) im.src = URL.createObjectURL(b); }).catch(() => {});
        strip.appendChild(im);
      });
    }
    $("photoModal").hidden = false;
    await showPhoto(i);
  }
  async function showPhoto(k) {
    if (!viewing) return;
    const phs = photosOf(viewing.pt), ph = phs[k];
    if (!ph) return;
    viewing.i = k;
    if ($("photoStrip")) [...$("photoStrip").children].forEach((im, n) => im.classList.toggle("on", n === k));
    let blob;
    try { blob = await photoDB.get(ph.id); } catch {}
    if (!blob) { photoFile = null; return toast("That photo isn't on this phone any more"); }
    const base = (viewing.pt.name || "photo").replace(/[^\w-]+/g, "_");
    photoFile = new File([blob], `${base}${phs.length > 1 ? "_" + (k + 1) : ""}.jpg`, { type: "image/jpeg" });
    if ($("photoOut").src.startsWith("blob:")) URL.revokeObjectURL($("photoOut").src);
    $("photoOut").src = URL.createObjectURL(blob);
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
  function closePhoto() { $("photoModal").hidden = true; URL.revokeObjectURL($("photoOut").src); photoFile = null; photoNew = null; viewing = null; }
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
  // Every launch opens on the team's patch: all seven reserves, Hallsenna to Gait Barrows and
  // Walney to Blelham, in the clear space between the reserve chips and the panel. It starts
  // over the whole of Cumbria and glides down onto them. A touch stops the glide where it is;
  // if the phone won't animate (Low Power Mode can stop it) it simply lands after 3 s.
  const RESERVES = L.latLngBounds([[54.1229, -3.4460], [54.3983, -2.7904]]);
  const openOnPatch = () => {
    layout();
    const pad = { paddingTopLeft: [52, 136], paddingBottomRight: [52, sheet.offsetHeight + 24] };
    if (launchQ) return map.fitBounds(RESERVES, { ...pad, animate: false });
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return map.fitBounds(RESERVES, { ...pad, animate: false });
    map.fitBounds([[54.0, -3.65], [55.15, -2.25]], { ...pad, animate: false });
    // Reserve outlines and pins stay hidden until the map settles, then fade in
    const box = map.getContainer();
    box.classList.add("gliding");
    const settle = () => box.classList.remove("gliding");
    setTimeout(() => box.classList.remove("gliding"), 7000); // never left hidden
    let touched = false;
    box.addEventListener("pointerdown", () => { touched = true; box.classList.remove("gliding"); }, { once: true });
    // Fly onto a drawn map: wait for the Cumbria view to load, and fetch the tiles of the
    // landing view in the background meanwhile (2.5 s at most, so a slow signal never stalls it)
    const base = LAYERS[current].layer;
    const startLoaded = new Promise((r) => { if (!base._loading) r(); else base.once("load", r); });
    const end = map._getBoundsCenterZoom(RESERVES, pad);
    const landingLoaded = Promise.all(landingTiles(base, end.center, end.zoom).map((src) => new Promise((r) => {
      const im = new Image();
      im.crossOrigin = "anonymous"; // same as the map's own requests, so the browser reuses them
      im.onload = im.onerror = r;
      im.src = src;
    })));
    Promise.race([Promise.all([startLoaded, landingLoaded]), new Promise((r) => setTimeout(r, 2500))]).then(() => {
      if (touched) return settle();
      map.flyToBounds(RESERVES, { ...pad, duration: 1.8, easeLinearity: 0.2 });
      setTimeout(settle, 1900); // once it has landed
      setTimeout(() => { if (!touched && Math.abs(map.getZoom() - end.zoom) > 0.2) map.fitBounds(RESERVES, { ...pad, animate: false }); }, 3000);
    });
  };
  // The tile addresses a layer will need to show `center` at zoom `z` on this screen
  function landingTiles(layer, center, z) {
    const tz = Math.min(Math.round(z), layer.options.maxNativeZoom ?? layer.options.maxZoom ?? 19);
    const half = map.getSize().multiplyBy(Math.pow(2, tz - z) / 2), c = map.project(center, tz), ts = 256;
    const out = [];
    for (let x = Math.floor((c.x - half.x) / ts); x <= Math.floor((c.x + half.x) / ts); x++)
      for (let y = Math.floor((c.y - half.y) / ts); y <= Math.floor((c.y + half.y) / ts); y++)
        out.push(L.Util.template(layer._url, { ...layer.options, x, y, z: tz, s: "a", r: "" }));
    return out.slice(0, 60);
  }
  for (const step of [() => setPrec(digits), openOnPatch, drawPins, drawGrid, loadOSTN, loadNNR, () => { if (!navigator.onLine) goOffline(); }]) {
    try { step(); } catch (e) { console.error(e); }
  }
  setTimeout(() => { if (navigator.onLine) downloadPack(); }, 4000);
  layout();
  update();
  // Any browser (Edge and Chrome on iPhone have no service worker): ask GitHub which
  // version is current and, if this page is older, load the new one. The ?v= makes the
  // browser fetch a fresh page instead of reusing its cached copy.
  // Only one reload per update, whichever notices first (two at once could freeze an iPhone app)
  let reloading = false;
  async function checkVersion() {
    try {
      const j = await (await fetch("version.json", { cache: "no-store" })).json();
      if (j.v && j.v !== VERSION && !location.search.includes("v=" + j.v) && !reloading) {
        reloading = true;
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
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && !reloading) { reloading = true; location.reload(); }
    });
    navigator.serviceWorker.register("sw.js").then((r) => r.update()).catch(() => {});
    // Check for a new version whenever the app comes back to the front
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
    });
  }
})();
