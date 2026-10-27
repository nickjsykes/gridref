// Reads where and when a JPEG was taken from its EXIF, for photos picked from the phone.
// Returns { lat, lon, when } with whatever it finds (any of them may be missing).
// iPhone may strip the location when a web page picks a photo; callers fall back to the crosshair.
const EXIF = (() => {
  function read(buf) {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return {};
    let o = 2;
    while (o + 4 <= v.byteLength) {
      const marker = v.getUint16(o), size = v.getUint16(o + 2);
      if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) return tiff(v, o + 10); // "Exif"
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break; // start of image data: no EXIF
      o += 2 + size;
    }
    return {};
  }
  function tiff(v, t) {
    const le = v.getUint16(t) === 0x4949;
    const u16 = (p) => v.getUint16(p, le), u32 = (p) => v.getUint32(p, le);
    const entries = (ifd) => {
      const out = {}, n = u16(t + ifd);
      for (let i = 0; i < n; i++) {
        const e = t + ifd + 2 + i * 12;
        out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 };
      }
      return out;
    };
    const ptr = (e) => t + u32(e.at); // offsets are from the TIFF header
    const ascii = (e) => { const p = e.count > 4 ? ptr(e) : e.at; let s = ""; for (let i = 0; i < e.count - 1; i++) s += String.fromCharCode(v.getUint8(p + i)); return s; };
    const rationals = (e) => { const p = ptr(e), r = []; for (let i = 0; i < e.count; i++) r.push(u32(p + i * 8) / u32(p + i * 8 + 4)); return r; };
    const res = {};
    try {
      const ifd0 = entries(u32(t + 4));
      if (ifd0[0x8769]) {
        const ex = entries(u32(ifd0[0x8769].at));
        const d = ex[0x9003] || ex[0x9004];
        const m = d && ascii(d).match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
        if (m) res.when = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      }
      if (ifd0[0x8825]) {
        const g = entries(u32(ifd0[0x8825].at));
        if (g[2] && g[4]) {
          const dms = (e) => { const [d, mi, s] = rationals(e); return d + mi / 60 + s / 3600; };
          let lat = dms(g[2]), lon = dms(g[4]);
          if (g[1] && ascii(g[1]) === "S") lat = -lat;
          if (g[3] && ascii(g[3]) === "W") lon = -lon;
          if (isFinite(lat) && isFinite(lon) && (lat || lon)) { res.lat = lat; res.lon = lon; }
        }
      }
    } catch {}
    return res;
  }
  return { read: async (file) => { try { return read(await file.slice(0, 256 * 1024).arrayBuffer()); } catch { return {}; } } };
})();
