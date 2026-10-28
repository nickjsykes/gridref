// Field Notes OS map proxy (Cloudflare Worker).
// The OS Data Hub key lives here as a secret, never in the public repo: the app asks
// /outdoor/{z}/{x}/{y}.png and this fetches OS Outdoor with the key added. On the Premium
// plan that goes to zoom 20 with OS MasterMap detail (zoom 17 up is premium; 16 and below
// is open data and free either way).
//
// Guard rails, since anyone can see this address in the app:
// - only answers pages from ALLOWED (Field Notes on GitHub Pages, and the local preview)
// - LIMITER: requests per minute per phone (wrangler.toml), so nobody can drain the allowance
// - tiles are cached at Cloudflare for 24 hours (the most OS allows for premium data), so a
//   tile is paid for at most once a day
const OS = "https://api.os.uk/maps/raster/v1/zxy/Outdoor_3857";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/outdoor\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.png$/);
    if (req.method !== "GET" || !m) return new Response("Not found", { status: 404 });
    const [z, x, y] = m.slice(1).map(Number);
    if (z < 7 || z > 20) return new Response("Not found", { status: 404 });

    // Map tiles are fetched with crossOrigin, so the browser sends Origin; Referer as a fallback
    const allowed = (env.ALLOWED || "").split(",").map((s) => s.trim()).filter(Boolean);
    const from = req.headers.get("Origin") || req.headers.get("Referer") || "";
    const origin = allowed.find((a) => from === a || from.startsWith(a + "/"));
    if (!origin) return new Response("Forbidden", { status: 403 });

    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: req.headers.get("CF-Connecting-IP") || "unknown" });
      if (!success) return new Response("Slow down", { status: 429, headers: cors(origin) });
    }

    const cache = caches.default;
    const key = new Request(`https://fieldnotes-tiles.cache/24h/outdoor/${z}/${x}/${y}.png`);
    let res = await cache.match(key);
    if (!res) {
      const up = await fetch(`${OS}/${z}/${x}/${y}.png?key=${env.OS_KEY}`);
      if (!up.ok) return new Response(null, { status: up.status, headers: cors(origin) });
      res = new Response(up.body, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors(origin))) out.headers.set(k, v);
    return out;
  },
};

function cors(origin) {
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}
