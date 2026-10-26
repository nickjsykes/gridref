# Grid Ref

A phone-first OS grid reference finder (a better gridreferencefinder.com for field use).

- Drag the map under the crosshair, or tap GPS to read your own position (with ± accuracy).
- 6 / 8 / 10-figure refs, easting/northing, lat/long. Copy, Share (with an Apple Maps link), Save.
- Saved points list with names and timestamps, shared out as CSV.
- Search: grid ref (`SD 339 836`), easting/northing, lat/long, postcode (postcodes.io), place (Nominatim).
- OS grid lines (100 km / 10 km / 1 km by zoom). Topo, street and aerial base maps.
- Add to Home Screen on iPhone for a full-screen app; the shell works offline (map tiles need signal).

Accuracy: Helmert datum shift, good to ~3–5 m. Fine for 8-figure refs; 10-figure is precise but not that accurate.

Static files only — no build step. `osgb.js` holds the conversions.
