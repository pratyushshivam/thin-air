// The ground close to the climber. The elevation data has one sample every thirty
// metres, which is the mountain but not the icefall's towers or the ridge's steps.
// Within a couple of hundred metres of the climber this adds invented detail of
// the right kind for where you are, and fades it out at the edge so it sits on
// the real surface. See "what is real and what is not" in the README.
import * as THREE from "three";
import { ROUTE_POINTS, type TerrainKind } from "../sim/route";
import type { Dem } from "./dem";

export const PATCH_N = 121;
export const PATCH_STEP = 3.2;
export const PATCH_HALF = ((PATCH_N - 1) * PATCH_STEP) / 2;

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, oct: number): number {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x, y);
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.7;
    a *= 0.5;
  }
  return s;
}
/** Distance to the nearest cell centre and a random value for that cell. */
function cells(x: number, y: number): [number, number] {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i + hash2(xi + i, yi + j);
      const cy = yi + j + hash2(yi + j + 91, xi + i - 37);
      const d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
      if (d < best) {
        best = d;
        id = hash2(xi + i + 311, yi + j + 127);
      }
    }
  }
  return [Math.sqrt(best), id];
}

/** Invented relief in metres at a world position, for a kind of ground. */
export function detail(kind: TerrainKind, x: number, z: number): number {
  switch (kind) {
    case "icefall": {
      // towers and blocks, with slots between them
      const [d, id] = cells(x / 26, z / 26);
      const [d2, id2] = cells(x / 9 + 40, z / 9);
      const tower = (id - 0.35) * 16 * (1 - Math.min(1, d * 1.5) ** 4);
      const block = (id2 - 0.5) * 4 * (1 - Math.min(1, d2 * 1.6) ** 6);
      const slot = Math.abs(fbm(x / 60, z / 60, 3) - 0.5);
      return tower + block - 14 * Math.max(0, 1 - slot / 0.018) + (fbm(x / 5, z / 5, 2) - 0.5) * 1.2;
    }
    case "cwm": {
      // wind-packed snow, and long crevasses across the valley
      const wave = Math.sin((x * 0.6 - z * 0.8) / 46 + fbm(x / 120, z / 120, 2) * 9);
      const crack = Math.max(0, 1 - Math.abs(wave) / 0.03);
      return (fbm(x / 22, z / 22, 3) - 0.5) * 2.4 - crack * 10 * (fbm(x / 200, z / 200, 2) > 0.5 ? 1 : 0);
    }
    case "face":
      return (fbm(x / 30, z / 30, 4) - 0.5) * 5 + (fbm(x / 6, z / 6, 2) - 0.5) * 1;
    case "rock": {
      const r = 1 - Math.abs(2 * fbm(x / 16, z / 16, 4) - 1);
      return r * r * 3 - 1.2 + (vnoise(x / 2.5, z / 2.5) - 0.5) * 0.5;
    }
    case "ridge": {
      const r = 1 - Math.abs(2 * fbm(x / 12, z / 12, 4) - 1);
      return r * r * 2.4 - 1 + (vnoise(x / 2.2, z / 2.2) - 0.5) * 0.4;
    }
    default:
      return (fbm(x / 7, z / 7, 3) - 0.5) * 3 + (vnoise(x / 1.8, z / 1.8) - 0.5) * 0.8;
  }
}

/** Distance in metres from a point to the line of the route. */
export function distanceToTrack(x: number, z: number, hint: number): number {
  let best = Infinity;
  const lo = Math.max(1, hint - 30);
  const hi = Math.min(ROUTE_POINTS.length - 1, hint + 30);
  for (let i = lo; i <= hi; i++) {
    const a = ROUTE_POINTS[i - 1]!;
    const b = ROUTE_POINTS[i]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
    if (d < best) best = d;
  }
  return best;
}

export function routeIndex(s: number): number {
  let lo = 0;
  let hi = ROUTE_POINTS.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ROUTE_POINTS[mid]!.s <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

export class Patch {
  readonly geometry = new THREE.BufferGeometry();
  private pos = new Float32Array(PATCH_N * PATCH_N * 3);
  private nor = new Float32Array(PATCH_N * PATCH_N * 3);
  private det = new Float32Array(PATCH_N * PATCH_N);
  private hgt = new Float32Array(PATCH_N * PATCH_N);
  cx = 1e9;
  cz = 1e9;
  private kind: TerrainKind = "moraine";
  private hint = 0;

  constructor(private dem: Dem) {
    const idx: number[] = [];
    for (let j = 0; j < PATCH_N - 1; j++) {
      for (let i = 0; i < PATCH_N - 1; i++) {
        const a = j * PATCH_N + i;
        idx.push(a, a + PATCH_N, a + 1, a + 1, a + PATCH_N, a + PATCH_N + 1);
      }
    }
    this.geometry.setIndex(idx);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute("normal", new THREE.BufferAttribute(this.nor, 3));
    this.geometry.setAttribute("aDetail", new THREE.BufferAttribute(this.det, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  }

  /** Height of the detailed ground at a point (falls back to the DEM outside the patch). */
  height(x: number, z: number): number {
    const fx = (x - (this.cx - PATCH_HALF)) / PATCH_STEP;
    const fz = (z - (this.cz - PATCH_HALF)) / PATCH_STEP;
    if (fx < 0 || fz < 0 || fx >= PATCH_N - 1 || fz >= PATCH_N - 1) return this.dem.surface(x, z);
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const u = fx - c;
    const v = fz - r;
    const h = this.hgt;
    const i = r * PATCH_N + c;
    return (h[i]! * (1 - u) + h[i + 1]! * u) * (1 - v) + (h[i + PATCH_N]! * (1 - u) + h[i + PATCH_N + 1]! * u) * v;
  }

  /** Rebuild around a point if the climber has walked far enough. Returns true if it did. */
  update(x: number, z: number, kind: TerrainKind, s: number, force = false): boolean {
    const snap = PATCH_STEP * 8;
    const nx = Math.round(x / snap) * snap;
    const nz = Math.round(z / snap) * snap;
    if (!force && nx === this.cx && nz === this.cz && kind === this.kind) return false;
    this.cx = nx;
    this.cz = nz;
    this.kind = kind;
    this.hint = routeIndex(s);
    const { pos, det, hgt, dem } = this;
    const N = PATCH_N;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const wx = nx - PATCH_HALF + i * PATCH_STEP;
        const wz = nz - PATCH_HALF + j * PATCH_STEP;
        // 1 in the middle, 0 at the rim
        const rim = Math.min(i, j, N - 1 - i, N - 1 - j) / 14;
        const w = rim >= 1 ? 1 : rim * rim * (3 - 2 * rim);
        const base = dem.surface(wx, wz);
        const track = distanceToTrack(wx, wz, this.hint);
        const tw = track < 2.5 ? 0 : track > 14 ? 1 : (track - 2.5) / 11.5;
        const d = detail(kind, wx, wz) * tw * tw * w;
        const h = base + (dem.smooth(wx, wz) - base) * w + d;
        const k = j * N + i;
        hgt[k] = h;
        det[k] = d;
        pos[k * 3] = wx;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = wz;
      }
    }
    const nor = this.nor;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const l = hgt[j * N + Math.max(0, i - 1)]!;
        const r = hgt[j * N + Math.min(N - 1, i + 1)]!;
        const u = hgt[Math.max(0, j - 1) * N + i]!;
        const dn = hgt[Math.min(N - 1, j + 1) * N + i]!;
        const sx = (r - l) / (2 * PATCH_STEP);
        const sz = (dn - u) / (2 * PATCH_STEP);
        const inv = 1 / Math.hypot(sx, 1, sz);
        nor[k * 3] = -sx * inv;
        nor[k * 3 + 1] = inv;
        nor[k * 3 + 2] = -sz * inv;
      }
    }
    this.geometry.attributes.position!.needsUpdate = true;
    this.geometry.attributes.normal!.needsUpdate = true;
    this.geometry.attributes.aDetail!.needsUpdate = true;
    return true;
  }
}
