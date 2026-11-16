// Bakes the terrain the page ships with from Copernicus DEM GLO-30 tiles, and the
// South Col route from OpenStreetMap.
//
//   raw/dem/N27_00_E086.tif ...  four GLO-30 tiles (see README, "Rebuild the mountain")
//   raw/route-osm.json           the "Everest South Col" route relation and named nodes
//
// Output:
//   public/data/khumbu.dem       1024 x 1024 samples, 1 arc-second, around the route
//   public/data/himal.dem        512 x 512 samples, 5 arc-seconds, the far horizon
//   src/data/route.json          the route, with heights sampled from the same DEM
//
// File format (.dem): a gzip stream holding two byte planes (low bytes, then high
// bytes) of zigzag-coded prediction residuals of uint16 heights in quarter metres.
import { fromFile } from "geotiff";
import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const TILES = ["N27_00_E086", "N27_00_E087", "N28_00_E086", "N28_00_E087"];

export const INNER = { n: 1024, step: 1 / 3600, west: 86.77, north: 28.125 };
export const OUTER = { n: 512, step: 5 / 3600, west: 86.555, north: 28.34 };

const tiles = [];
for (const name of TILES) {
  const tiff = await fromFile(`raw/dem/${name}.tif`);
  const img = await tiff.getImage();
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  const w = img.getWidth();
  const h = img.getHeight();
  const [data] = await img.readRasters();
  tiles.push({ ox, oy, rx, ry, w, h, data });
  console.log(name, w, h, "origin", ox.toFixed(6), oy.toFixed(6), "res", rx.toExponential(4), ry.toExponential(4));
}

/** Nearest stored sample, or NaN outside every tile. */
function texel(lon, lat) {
  for (const t of tiles) {
    const c = Math.floor((lon - t.ox) / t.rx);
    const r = Math.floor((lat - t.oy) / t.ry);
    if (c >= 0 && c < t.w && r >= 0 && r < t.h) return t.data[r * t.w + c];
  }
  return NaN;
}

/** Bilinear height in metres. GLO-30 pixels are centred on the arc-second grid. */
function rawHeight(lon, lat) {
  const t = tiles[0];
  const rx = t.rx;
  const ry = -t.ry;
  const fx = lon / rx - 0.5;
  const fy = lat / ry - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const ax = fx - x0;
  const ay = fy - y0;
  const s = (i, j) => {
    const v = texel((x0 + i + 0.5) * rx, (y0 + j + 0.5) * ry);
    return Number.isNaN(v) ? texel((x0 + 0.5) * rx, (y0 + 0.5) * ry) : v;
  };
  return (s(0, 0) * (1 - ax) + s(1, 0) * ax) * (1 - ay) + (s(0, 1) * (1 - ax) + s(1, 1) * ax) * ay;
}

// ---- surveyed corrections --------------------------------------------------
// Thirty-metre models round off knife-edges. GLO-30 reads 8,724 m at the surveyed
// summit position (8,848.86 m) and is 50 to 170 m low along the whole Southeast
// Ridge; ALOS AW3D30 is low there too. The ridge the route climbs, and the named
// summits around it, are raised to their surveyed heights, tapering to nothing a
// few hundred metres away. Everything else is the DEM as published.
const R = 6371008.8;
const rad = Math.PI / 180;
function metres(a, b) {
  const x = (b[1] - a[1]) * rad * Math.cos(((a[0] + b[0]) / 2) * rad);
  const y = (b[0] - a[0]) * rad;
  return Math.hypot(x, y) * R;
}
const osm = JSON.parse(readFileSync("raw/route-osm.json", "utf8"));
const node = (name) => osm.nodes.find((n) => n.name === name);
const chain = chainRoute(osm.ways.map((w) => w.pts));
const chainage = [0];
for (let i = 1; i < chain.length; i++) chainage.push(chainage[i - 1] + metres(chain[i - 1], chain[i]));
function nearestOnRoute(lat, lon) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < chain.length; i++) {
    const d = metres(chain[i], [lat, lon]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
// [route index, surveyed height]
const RIDGE = [
  [nearestOnRoute(node("Camp 4S South Col").lat, node("Camp 4S South Col").lon), 7906],
  [nearestOnRoute(node("The Balcony").lat, node("The Balcony").lon), 8430],
  [nearestOnRoute(node("Everest South Peak").lat, node("Everest South Peak").lon), 8749],
  [chain.length - 1, 8848.86],
].map(([i, h]) => ({ i, s: chainage[i], lift: h - rawHeight(chain[i][1], chain[i][0]) }));
const RIDGE_FADE = 500; // metres of route below the South Col over which the lift fades in
const RIDGE_R = 380;
function ridgeLiftAt(s) {
  const first = RIDGE[0];
  if (s <= first.s) return first.lift * Math.max(0, 1 - (first.s - s) / RIDGE_FADE);
  for (let k = 1; k < RIDGE.length; k++) {
    const a = RIDGE[k - 1];
    const b = RIDGE[k];
    if (s <= b.s) return a.lift + ((b.lift - a.lift) * (s - a.s)) / (b.s - a.s);
  }
  return RIDGE.at(-1).lift;
}
const ridgeFrom = RIDGE[0].i - 40 < 0 ? 0 : RIDGE[0].i - 40;
const PEAKS = osm.nodes
  .filter((n) => n.kind === "peak" && n.ele && !/Everest/.test(n.name))
  .map((n) => ({ lat: n.lat, lon: n.lon, lift: +n.ele - rawHeight(n.lon, n.lat), name: n.name }))
  .filter((p) => p.lift > 20 && p.lift <= 150);
const PEAK_R = 320;
const kernel = (d, r) => (d >= r ? 0 : (1 - (d / r) ** 2) ** 2);

export function height(lon, lat) {
  let h = rawHeight(lon, lat);
  const p = [lat, lon];
  if (lat > 27.965 && lat < 27.993 && lon > 86.918 && lon < 86.937) {
    // distance to the ridge polyline
    let bd = Infinity;
    let bs = 0;
    for (let i = Math.max(1, ridgeFrom); i < chain.length; i++) {
      const a = chain[i - 1];
      const b = chain[i];
      const kx = Math.cos(lat * rad) * rad * R;
      const ky = rad * R;
      const ax = (a[1] - lon) * kx, ay = (a[0] - lat) * ky;
      const bx = (b[1] - lon) * kx, by = (b[0] - lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
      const d = Math.hypot(ax + dx * t, ay + dy * t);
      if (d < bd) { bd = d; bs = chainage[i - 1] + (chainage[i] - chainage[i - 1]) * t; }
    }
    h += ridgeLiftAt(bs) * kernel(bd, RIDGE_R);
  }
  let peak = 0;
  for (const pk of PEAKS) {
    if (Math.abs(pk.lat - lat) > 0.004 || Math.abs(pk.lon - lon) > 0.0045) continue;
    peak = Math.max(peak, pk.lift * kernel(metres(p, [pk.lat, pk.lon]), PEAK_R));
  }
  return Math.min(h + peak, 8848.86);
}
console.log("ridge lifts", RIDGE.map((r) => r.lift.toFixed(0)).join(", "), "| peaks", PEAKS.map((p) => p.name + " +" + p.lift.toFixed(0)).join(", "));

function chainRoute(ways) {
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const summitKey = key([27.9880614, 86.92521]);
  let c = ways.find((w) => key(w.at(-1)) === summitKey || key(w[0]) === summitKey);
  let rest = ways.filter((w) => w !== c);
  if (key(c[0]) === summitKey) c = c.slice().reverse();
  while (rest.length) {
    const head = key(c[0]);
    const i = rest.findIndex((w) => key(w[0]) === head || key(w.at(-1)) === head);
    if (i < 0) throw new Error("route does not chain");
    let w = rest.splice(i, 1)[0];
    if (key(w[0]) === head) w = w.slice().reverse();
    c = w.slice(0, -1).concat(c);
  }
  return c;
}

function bake(grid, file) {
  const { n, step, west, north } = grid;
  const q = new Uint16Array(n * n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const h = height(west + c * step, north - r * step);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
      q[r * n + c] = Math.max(0, Math.min(65535, Math.round(h * 4)));
    }
  }
  const low = new Uint8Array(n * n);
  const high = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const a = c > 0 ? q[i - 1] : 0;
      const b = r > 0 ? q[i - n] : 0;
      const d = c > 0 && r > 0 ? q[i - n - 1] : 0;
      const pred = c > 0 && r > 0 ? a + b - d : c > 0 ? a : b;
      const res = (q[i] - pred) | 0;
      const zz = ((res << 1) ^ (res >> 31)) & 0xffff;
      low[i] = zz & 255;
      high[i] = zz >> 8;
    }
  }
  const raw = new Uint8Array(n * n * 2);
  raw.set(low, 0);
  raw.set(high, n * n);
  const gz = gzipSync(raw, { level: 9 });
  writeFileSync(file, gz);
  console.log(file, `${n}x${n}`, `${lo.toFixed(1)}..${hi.toFixed(1)} m`, `${(gz.length / 1024).toFixed(0)} kB`);
}

mkdirSync("public/data", { recursive: true });
mkdirSync("src/data", { recursive: true });
bake(INNER, "public/data/khumbu.dem");
bake(OUTER, "public/data/himal.dem");

// ---- the route -------------------------------------------------------------
let dist = 0;
const pts = chain.map((p, i) => {
  if (i > 0) dist += metres(chain[i - 1], p);
  return [+p[0].toFixed(7), +p[1].toFixed(7), +height(p[1], p[0]).toFixed(1), +dist.toFixed(1)];
});
const nodes = osm.nodes.map((n) => ({
  name: n.name,
  kind: n.kind,
  osmEle: n.ele ? +n.ele : null,
  lat: n.lat,
  lon: n.lon,
  dem: +height(n.lon, n.lat).toFixed(1),
}));
writeFileSync(
  "src/data/route.json",
  JSON.stringify({
    source: "OpenStreetMap relation 17822898 'Everest South Col' (ODbL); heights from Copernicus DEM GLO-30",
    inner: INNER,
    outer: OUTER,
    points: pts,
    nodes,
  }),
);
console.log("route", pts.length, "points", (dist / 1000).toFixed(2), "km", "from", pts[0], "to", pts.at(-1));
for (const n of nodes) console.log(" ", n.name, n.kind, "osm", n.osmEle, "dem", n.dem);
// profile every ~500 m
let next = 0;
for (const p of pts) if (p[3] >= next) { console.log("  ", (p[3] / 1000).toFixed(2), "km", p[2], "m", p[0], p[1]); next += 500; }
// highest sample near the summit
let best = 0, bl = 0, bo = 0;
for (let la = 27.985; la < 27.991; la += 1 / 7200) for (let lo2 = 86.922; lo2 < 86.928; lo2 += 1 / 7200) { const h = height(lo2, la); if (h > best) { best = h; bl = la; bo = lo2; } }
console.log("highest DEM sample near summit", best.toFixed(1), bl.toFixed(5), bo.toFixed(5));
