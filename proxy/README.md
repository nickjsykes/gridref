# OS map proxy (Cloudflare Worker)

Gives Field Notes the full-detail OS Outdoor map (OS MasterMap detail, zoom 17–20) without
putting a Premium OS key in this public repo. The app asks this Worker for tiles; the Worker
adds the key (a Cloudflare secret) and fetches them from OS.

- Only answers pages listed in `ALLOWED` (`wrangler.toml`): the live app and the local preview.
- 600 tiles a minute per phone at most.
- Tiles cached at Cloudflare for 24 hours: the OS API terms allow premium data to be cached
  for up to 24 hours, no longer. So no premium offline pack.
- Zoom 16 and below is OS open data (free). Zoom 17–20 is premium, within the Premium plan's
  free monthly allowance for a small team. Usage shows in the OS Data Hub dashboard.

## Setting it up (once)

1. **OS Data Hub** (osdatahub.os.uk): upgrade the account to the **Premium plan** (card on file).
   Make a **new project**, add **OS Maps API**, and copy its key. Keep it out of chat and git.
2. **Cloudflare**: make a free account at dash.cloudflare.com.
3. In this folder:
   ```
   npx wrangler login
   npx wrangler secret put OS_KEY      (paste the new key when asked)
   npx wrangler deploy
   ```
   Deploy prints the address, e.g. `https://fieldnotes-tiles.<you>.workers.dev`.
4. In `config.js`: set `osProxy` to that address, and set `osKey` to `""`.
5. In the OS Data Hub, **delete the old project** whose key was in `config.js`. On a Premium
   account it would unlock premium tiles for anyone who copied it from GitHub.
6. Release (`python build/release.py`), commit and push.

## Testing locally

Put a key in `.dev.vars` (`OS_KEY=...`, gitignored), run `npx wrangler dev --port 8787`, and
set `osProxy: "http://127.0.0.1:8787"` in `config.js` (don't commit that).
