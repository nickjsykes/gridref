# Grid Ref

A phone-first OS grid reference finder (a better gridreferencefinder.com for field use).

- Drag the map under the crosshair, or tap GPS to read your own position (with ± accuracy).
- Grid ref (6/8/10-figure), E/N, lat/long, deg-min-sec and what3words, each its own tap-to-copy row. Share all, Save.
- Saved points list with names and timestamps, shared out as CSV.
- Search takes anything: grid refs, E/N, decimal or DMS lat/long (any order, letters or signs), postcodes and districts (postcodes.io), ///what3words, pasted Google/Apple/OSM/OS Maps links and geo: URIs, and place names as you type (Photon). `node test/parse.test.js` lists every format.
- what3words: paste an API key into `config.js` to show the words in-app; without one the row and searches open what3words.
- OS grid lines (100 km / 10 km / 1 km by zoom). Topo, street and aerial base maps.
- Add to Home Screen on iPhone for a full-screen app.
- Offline: the app, grid refs/E-N/lat-long, GPS, and place + postcode search for the SD and NY squares (OS Open Names and Code-Point Open, `data/`) all work with no signal. Map tiles you've viewed are kept (up to 5,000); "Save this area for offline" in the layers menu loads one reserve. Aerial photos and what3words need signal.
- Large text (layers menu) for small phones; the grid ref always sizes itself to fit.

Offline data: download OS Open Names and Code-Point Open (CSV) into `build/src/` as `opname.zip` and `codepo.zip`, then `python build/build_offline.py`. Contains OS data © Crown copyright and database right 2026 (Open Government Licence v3.0).

Accuracy: Helmert datum shift, good to ~3–5 m. Fine for 8-figure refs; 10-figure is precise but not that accurate.

Static files only — no build step. `osgb.js` holds the conversions.
