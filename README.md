# Grid Ref

A phone-first OS grid reference finder (a better gridreferencefinder.com for field use).

- Drag the map under the crosshair, or tap GPS to read your own position (with ± accuracy).
- Grid ref (6 or 8-figure: phone GPS can't honestly support 10), E/N, lat/long and what3words, each tap-to-copy. Swipe the panel down for just the grid ref, up for the rest.
- Navigate: map with you, the flag and a line, plus a compass arrow to the target, distance and bearing (iPhone asks for compass permission on the first tap; screen kept awake).
- Notebook: points, lines, areas and photos by day, filter by type and reserve; imported CSVs go into folders; export CSV or GeoJSON.
- Search takes anything: grid refs, E/N, decimal or DMS lat/long (any order, letters or signs), postcodes and districts (postcodes.io), ///what3words, pasted Google/Apple/OSM/OS Maps links and geo: URIs, and place names as you type (Photon). `node test/parse.test.js` lists every format.
- what3words: paste an API key into `config.js` to show the words in-app; without one the row and searches open what3words.
- OS grid lines (100 km / 10 km / 1 km by zoom). Topo, street and aerial base maps.
- Add to Home Screen on iPhone for a full-screen app.
- Offline: the app, grid refs/E-N/lat-long, GPS, and place + postcode search for the SD and NY squares (OS Open Names and Code-Point Open, `data/`) all work with no signal. Map tiles you've viewed are kept (up to 5,000); "Save this area for offline" in the layers menu loads one reserve. Aerial photos and what3words need signal.
- Large text (layers menu) for small phones; the grid ref always sizes itself to fit.

Offline data: download OS Open Names and Code-Point Open (CSV) into `build/src/` as `opname.zip` and `codepo.zip`, then `python build/build_offline.py`. Contains OS data © Crown copyright and database right 2026 (Open Government Licence v3.0).

Accuracy: Helmert datum shift, good to ~3–5 m, and phone GPS is ~5 m in the open and worse under trees, so the app gives 6 or 8 figures. 10-figure refs can still be searched.

Static files only, no build step: `index.html` (layout), `app.css` (styles, light/dark tokens), `app.js` (the app), `osgb.js` (grid conversions), `parse.js` (search parsing), `local.js` (offline place/postcode search), `zip.js` (backup zips), `sw.js` (offline).

**Releasing:** `python build/release.py` bumps VERSION, the script ?v= tags, version.json and the sw.js CACHE together. Open copies (any browser) see the new version.json and reload onto it.

## Offline maps and reserve boundaries

- **OS map pack** (`maps/`): tiles cut from OS OpenMap Local (Full Colour Raster, OGL) for the six reserves in `PACK` in `build/build_tiles.py` (Roudsea, Blelham Bog, Duddon Mosses, Hallsenna Moor, North Walney, Gait Barrows), zoom 11-17, about 9 MB. The app downloads the whole pack by itself when it has signal (progress in the layers menu), and when map tiles stop loading it lays the OS map over the screen with a "Switching to offline maps" message.
  Rebuild: download `omlras_gtfc_sd.zip` / `omlras_gtfc_ny.zip` (OS Downloads API, OpenMapLocal, GeoTIFF Full Colour) into `build/src/`, then `C:/Dev/Terra/.venv/Scripts/python.exe build/build_tiles.py` (needs rasterio + Pillow). Add a reserve by adding its NNR `REF_CODE` to `PACK`.
- **NNR boundaries**: live from Natural England's National Nature Reserves (England) feature service every time the app has signal; `data/nnr.geojson` is the copy shipped for first use offline (refresh it with the query URL in `index.html`, `NNR_LIVE`).
- **Tools**: Measure (points at the crosshair; distance, perimeter, area on the OS grid) and Photo (stamps grid ref, time, GPS accuracy and reserve name; shares or saves the JPEG).
