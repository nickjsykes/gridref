# Field Notes

A pocket map and notebook for rangers, built by Nick for the South Cumbria NNR team (iPhone first). Live at https://nickjsykes.github.io/gridref/ (install guide: `install.html`).

- **Find and convert**: the crosshair reads out the OS grid ref (8 figures), lat/long, E/N and what3words; tap any to copy. Grid refs and E/N match OS's own OSTN15 conversion to within centimetres (`data/ostn15.json`).
- **Search anything**: grid refs, E/N, lat/long (decimal or DMS), postcodes, plus codes, ///what3words, map links, place names (offline for SD/NY, online elsewhere), your own notebook and the reserves, with typo tolerance, and locations pulled out of a pasted message. `node test/parse.test.js`.
- **Notebook** (on the phone only): points, lines and areas by day, each with up to 6 stamped photos (hold + = photo pinned where you stand), filtered by reserve, each tagged with its reserve; CSV imports go into folders; export CSV (E/N in EPSG:27700) or GeoJSON, with photos as a zip.
- **Share**: grid ref, lat/long, E/N, Apple/Google Maps links, name and notes, and a picture of the current map. Photos are stamped with the location, date, reserve and your own line.
- **Navigate** to anything with a compass arrow, distance and bearing; arriving turns the panel green with a buzz and a chime.
- **OS Outdoor** comes through `proxy/` (Cloudflare Worker `fieldnotes-tiles.nickjsykes.workers.dev`, Premium key held as a secret): full OS MasterMap detail to zoom 20.
- **Reserve chips** jump to each reserve (Gait Barrows has a hand-picked view). Official tides (ADMIRALTY) are still fetched daily by `.github/workflows/tides.yml` into `data/tides.json` and shown when you type "tide" in search (build 150).
- **Maps**: OS Outdoor (OS Maps API, OpenData), aerial, and an offline OS map for the seven reserves; the LiDAR tick adds a 1 m relief layer with a strength slider (offline near the reserves, EA shading elsewhere).
- **Big text** (Aa): bigger, high contrast, nothing taken away.

Offline data: download OS Open Names and Code-Point Open (CSV) into `build/src/` as `opname.zip` and `codepo.zip`, then `python build/build_offline.py`. Contains OS data © Crown copyright and database right 2026 (Open Government Licence v3.0).

Accuracy: OSTN15 (via a 5 km correction table over a Helmert shift), within a few cm of OS. Phone GPS is ~5 m in the open and worse under trees, so the app gives 8 figures; 10-figure refs can still be searched.

Static files only, no build step: `index.html` (layout), `app.css` (styles, light/dark tokens), `app.js` (the app), `osgb.js` (grid conversions), `parse.js` (search parsing), `local.js` (offline place/postcode search), `zip.js` (backup zips), `sw.js` (offline).

**Releasing:** `python build/release.py` bumps VERSION, the script ?v= tags, version.json and the sw.js CACHE together. Open copies (any browser) see the new version.json and reload onto it.

## Offline maps and reserve boundaries

- **OS map pack** (`maps/`): tiles cut from OS OpenMap Local (Full Colour Raster, OGL) for the seven reserves in `PACK` in `build/build_tiles.py`, zoom 11-17, plus the LiDAR relief layer (`maps/relief`, from `build/build_relief.py`), about 31 MB. The app downloads the whole pack by itself when it has signal (progress in the layers menu), and when map tiles stop loading it lays the OS map over the screen with a "Switching to offline maps" message.
  Rebuild: download `omlras_gtfc_sd.zip` / `omlras_gtfc_ny.zip` (OS Downloads API, OpenMapLocal, GeoTIFF Full Colour) into `build/src/`, then `C:/Dev/Terra/.venv/Scripts/python.exe build/build_tiles.py` (needs rasterio + Pillow). Add a reserve by adding its NNR `REF_CODE` to `PACK`.
- **NNR boundaries**: live from Natural England's National Nature Reserves (England) feature service every time the app has signal; `data/nnr.geojson` is the copy shipped for first use offline (refresh it with the query URL in `index.html`, `NNR_LIVE`).
- **Other build scripts**: `build_ostn15.py` (OSTN15 table), `fetch_tides.py` (tides, run by the workflow), `draw_icon.py` (home-screen icon), `draw_art.py` (empty-notebook contour texture).
