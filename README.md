# Grid Ref

A phone-first OS grid reference finder (a better gridreferencefinder.com for field use).

- Drag the map under the crosshair, or tap GPS to read your own position (with ± accuracy).
- Grid ref (6/8/10-figure), E/N, lat/long, deg-min-sec and what3words, each its own tap-to-copy row. Share all, Save.
- Saved points list with names and timestamps, shared out as CSV.
- Search takes anything: grid refs, E/N, decimal or DMS lat/long (any order, letters or signs), postcodes and districts (postcodes.io), ///what3words, pasted Google/Apple/OSM/OS Maps links and geo: URIs, and place names as you type (Photon). `node test/parse.test.js` lists every format.
- what3words: paste an API key into `config.js` to show the words in-app; without one the row and searches open what3words.
- OS grid lines (100 km / 10 km / 1 km by zoom). Topo, street and aerial base maps.
- Add to Home Screen on iPhone for a full-screen app; the shell works offline (map tiles need signal).

Accuracy: Helmert datum shift, good to ~3–5 m. Fine for 8-figure refs; 10-figure is precise but not that accurate.

Static files only — no build step. `osgb.js` holds the conversions.
