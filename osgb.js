// WGS84 (GPS) <-> OSGB36 British National Grid.
// Helmert datum shift (good to ~3-5 m) + Transverse Mercator, after Chris Veness / OS
// "A Guide to Coordinate Systems in Great Britain". No OSTN15 grid, so 10-figure refs
// are precise to the metre but only accurate to a few metres.
(function (root) {
  const RAD = Math.PI / 180;
  const WGS84 = { a: 6378137, b: 6356752.314245 };
  const AIRY = { a: 6377563.396, b: 6356256.909 };
  // WGS84 -> OSGB36
  const HELMERT = { tx: -446.448, ty: 125.157, tz: -542.06, s: 20.4894, rx: -0.1502, ry: -0.247, rz: -0.8421 };

  function toCartesian(lat, lon, ell) {
    const φ = lat * RAD, λ = lon * RAD;
    const e2 = 1 - (ell.b * ell.b) / (ell.a * ell.a);
    const ν = ell.a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
    return [ν * Math.cos(φ) * Math.cos(λ), ν * Math.cos(φ) * Math.sin(λ), ν * (1 - e2) * Math.sin(φ)];
  }

  function fromCartesian([x, y, z], ell) {
    const { a, b } = ell;
    const e2 = 1 - (b * b) / (a * a), ε2 = e2 / (1 - e2);
    const p = Math.hypot(x, y), R = Math.hypot(p, z);
    const tanβ = ((b * z) / (a * p)) * (1 + (ε2 * b) / R);
    const sinβ = tanβ / Math.sqrt(1 + tanβ * tanβ), cosβ = sinβ / tanβ;
    const φ = Math.atan2(z + ε2 * b * sinβ ** 3, p - e2 * a * cosβ ** 3);
    return { lat: φ / RAD, lon: Math.atan2(y, x) / RAD };
  }

  function helmert([x, y, z], t, sign) {
    const s1 = 1 + (sign * t.s) / 1e6;
    const rx = (sign * t.rx / 3600) * RAD, ry = (sign * t.ry / 3600) * RAD, rz = (sign * t.rz / 3600) * RAD;
    return [
      sign * t.tx + x * s1 - y * rz + z * ry,
      sign * t.ty + x * rz + y * s1 - z * rx,
      sign * t.tz - x * ry + y * rx + z * s1,
    ];
  }

  // Transverse Mercator constants for the National Grid
  const F0 = 0.9996012717, φ0 = 49 * RAD, λ0 = -2 * RAD, N0 = -100000, E0 = 400000;
  const { a, b } = AIRY;
  const e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n;

  function meridional(φ) {
    const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (φ - φ0);
    const Mb = (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(φ - φ0) * Math.cos(φ + φ0);
    const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (φ - φ0)) * Math.cos(2 * (φ + φ0));
    const Md = (35 / 24) * n3 * Math.sin(3 * (φ - φ0)) * Math.cos(3 * (φ + φ0));
    return b * F0 * (Ma - Mb + Mc - Md);
  }

  // OSGB36 lat/lon -> easting/northing
  function project(lat, lon) {
    const φ = lat * RAD, λ = lon * RAD;
    const sin = Math.sin(φ), cos = Math.cos(φ), tan = Math.tan(φ), t2 = tan * tan, t4 = t2 * t2;
    const ν = (a * F0) / Math.sqrt(1 - e2 * sin * sin);
    const ρ = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sin * sin, 1.5);
    const η2 = ν / ρ - 1;
    const I = meridional(φ) + N0;
    const II = (ν / 2) * sin * cos;
    const III = (ν / 24) * sin * cos ** 3 * (5 - t2 + 9 * η2);
    const IIIA = (ν / 720) * sin * cos ** 5 * (61 - 58 * t2 + t4);
    const IV = ν * cos;
    const V = (ν / 6) * cos ** 3 * (ν / ρ - t2);
    const VI = (ν / 120) * cos ** 5 * (5 - 18 * t2 + t4 + 14 * η2 - 58 * t2 * η2);
    const d = λ - λ0;
    return {
      e: E0 + IV * d + V * d ** 3 + VI * d ** 5,
      n: I + II * d ** 2 + III * d ** 4 + IIIA * d ** 6,
    };
  }

  // easting/northing -> OSGB36 lat/lon
  function unproject(E, N) {
    let φ = φ0, M = 0;
    do {
      φ = (N - N0 - M) / (a * F0) + φ;
      M = meridional(φ);
    } while (Math.abs(N - N0 - M) >= 0.00001);
    const sin = Math.sin(φ), cos = Math.cos(φ), tan = Math.tan(φ), sec = 1 / cos;
    const t2 = tan * tan, t4 = t2 * t2, t6 = t4 * t2;
    const ν = (a * F0) / Math.sqrt(1 - e2 * sin * sin);
    const ρ = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sin * sin, 1.5);
    const η2 = ν / ρ - 1;
    const VII = tan / (2 * ρ * ν);
    const VIII = (tan / (24 * ρ * ν ** 3)) * (5 + 3 * t2 + η2 - 9 * t2 * η2);
    const IX = (tan / (720 * ρ * ν ** 5)) * (61 + 90 * t2 + 45 * t4);
    const X = sec / ν;
    const XI = (sec / (6 * ν ** 3)) * (ν / ρ + 2 * t2);
    const XII = (sec / (120 * ν ** 5)) * (5 + 28 * t2 + 24 * t4);
    const XIIA = (sec / (5040 * ν ** 7)) * (61 + 662 * t2 + 1320 * t4 + 720 * t6);
    const d = E - E0;
    return {
      lat: (φ - VII * d ** 2 + VIII * d ** 4 - IX * d ** 6) / RAD,
      lon: (λ0 + X * d - XI * d ** 3 + XII * d ** 5 - XIIA * d ** 7) / RAD,
    };
  }

  function wgs84ToGrid(lat, lon) {
    const osgb = fromCartesian(helmert(toCartesian(lat, lon, WGS84), HELMERT, 1), AIRY);
    return project(osgb.lat, osgb.lon);
  }

  function gridToWgs84(e, n) {
    const osgb = unproject(e, n);
    return fromCartesian(helmert(toCartesian(osgb.lat, osgb.lon, AIRY), HELMERT, -1), WGS84);
  }

  function inGrid(e, n) {
    return e >= 0 && e < 700000 && n >= 0 && n < 1300000;
  }

  // easting/northing -> "SD 3456 8123" (digits = 6, 8 or 10)
  function gridRef(e, n, digits) {
    if (!inGrid(e, n)) return null;
    const e100k = Math.floor(e / 100000), n100k = Math.floor(n / 100000);
    let l1 = 19 - n100k - ((19 - n100k) % 5) + Math.floor((e100k + 10) / 5);
    let l2 = (((19 - n100k) * 5) % 25) + (e100k % 5);
    if (l1 > 7) l1++; // no letter I
    if (l2 > 7) l2++;
    const half = digits / 2, div = Math.pow(10, 5 - half);
    const pad = (v) => String(Math.floor((v % 100000) / div)).padStart(half, "0");
    return String.fromCharCode(l1 + 65, l2 + 65) + " " + pad(e) + " " + pad(n);
  }

  // "SD 34 81", "sd3456781234", "SD 34567 81234" -> centre of that square
  function parseGridRef(text) {
    const m = String(text).toUpperCase().replace(/[\s,]/g, "").match(/^([A-HJ-Z])([A-HJ-Z])(\d*)$/);
    if (!m || m[3].length % 2 || m[3].length > 10) return null;
    let l1 = m[1].charCodeAt(0) - 65, l2 = m[2].charCodeAt(0) - 65;
    if (l1 > 7) l1--;
    if (l2 > 7) l2--;
    const e100k = ((l1 - 2) % 5) * 5 + (l2 % 5);
    const n100k = 19 - Math.floor(l1 / 5) * 5 - Math.floor(l2 / 5);
    if (e100k < 0 || e100k > 6 || n100k < 0 || n100k > 12) return null;
    const half = m[3].length / 2;
    const size = Math.pow(10, 5 - half);
    const de = half ? parseInt(m[3].slice(0, half), 10) * size : 0;
    const dn = half ? parseInt(m[3].slice(half), 10) * size : 0;
    return { e: e100k * 100000 + de + size / 2, n: n100k * 100000 + dn + size / 2, size };
  }

  root.OSGB = { wgs84ToGrid, gridToWgs84, gridRef, parseGridRef, inGrid, project, unproject };
})(typeof window !== "undefined" ? window : globalThis);
