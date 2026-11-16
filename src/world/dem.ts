// Reads a baked .dem file (see scripts/build-terrain.mjs) into heights in metres.
import { ORIGIN_LAT, ORIGIN_LON, type Grid } from "../sim/route";

const RAD = Math.PI / 180;
const EARTH_R = 6371008.8;

export class Dem {
  readonly n: number;
  /** World x of column 0 and z of row 0, metres from the summit. */
  readonly x0: number;
  readonly z0: number;
  /** Spacing between columns (east) and rows (south), metres. */
  readonly dx: number;
  readonly dz: number;

  constructor(
    readonly grid: Grid,
    readonly h: Float32Array,
  ) {
    this.n = grid.n;
    this.dx = grid.step * RAD * Math.cos(ORIGIN_LAT * RAD) * EARTH_R;
    this.dz = grid.step * RAD * EARTH_R;
    this.x0 = (grid.west - ORIGIN_LON) * RAD * Math.cos(ORIGIN_LAT * RAD) * EARTH_R;
    this.z0 = -(grid.north - ORIGIN_LAT) * RAD * EARTH_R;
  }

  get width(): number {
    return (this.n - 1) * this.dx;
  }
  get depth(): number {
    return (this.n - 1) * this.dz;
  }

  at(c: number, r: number): number {
    const n = this.n;
    const cc = c < 0 ? 0 : c >= n ? n - 1 : c;
    const rr = r < 0 ? 0 : r >= n ? n - 1 : r;
    return this.h[rr * n + cc]!;
  }

  /** Height on the triangles the mesh is drawn with. */
  surface(x: number, z: number): number {
    const fx = (x - this.x0) / this.dx;
    const fz = (z - this.z0) / this.dz;
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const u = fx - c;
    const v = fz - r;
    const h00 = this.at(c, r);
    const h10 = this.at(c + 1, r);
    const h01 = this.at(c, r + 1);
    const h11 = this.at(c + 1, r + 1);
    return u + v < 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  /** Smooth (Catmull-Rom) height, for the close-up ground under the climber. */
  smooth(x: number, z: number): number {
    const fx = (x - this.x0) / this.dx;
    const fz = (z - this.z0) / this.dz;
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const u = fx - c;
    const v = fz - r;
    const cr = (a: number, b: number, d: number, e: number, t: number) =>
      b + 0.5 * t * (d - a + t * (2 * a - 5 * b + 4 * d - e + t * (3 * (b - d) + e - a)));
    const row = (rr: number) => cr(this.at(c - 1, rr), this.at(c, rr), this.at(c + 1, rr), this.at(c + 2, rr), u);
    return cr(row(r - 1), row(r), row(r + 1), row(r + 2), v);
  }

  contains(x: number, z: number, margin = 0): boolean {
    return x > this.x0 + margin && x < this.x0 + this.width - margin && z > this.z0 + margin && z < this.z0 + this.depth - margin;
  }
}

async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const bytes = new Uint8Array(buf);
  // Some hosts send .dem already decoded; a gzip stream starts 1f 8b.
  if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return bytes;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function decode(raw: Uint8Array, n: number): Float32Array {
  const q = new Int32Array(n * n);
  const h = new Float32Array(n * n);
  const hi = n * n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const zz = raw[i]! | (raw[hi + i]! << 8);
      const res = (zz >>> 1) ^ -(zz & 1);
      const a = c > 0 ? q[i - 1]! : 0;
      const b = r > 0 ? q[i - n]! : 0;
      const d = c > 0 && r > 0 ? q[i - n - 1]! : 0;
      const pred = c > 0 && r > 0 ? a + b - d : c > 0 ? a : b;
      q[i] = (pred + res) & 0xffff;
      h[i] = q[i]! / 4;
    }
  }
  return h;
}

export async function loadDem(url: string, grid: Grid): Promise<Dem> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const raw = await gunzip(await res.arrayBuffer());
  return new Dem(grid, decode(raw, grid.n));
}
