// Turns the height grids into what the graphics card draws: a mesh that is finest
// along the route, a texture of surface normals, and a texture of sun shadow that
// is swept across the real relief whenever the sun moves.
import * as THREE from "three";
import { ROUTE_POINTS } from "../sim/route";
import type { Dem } from "./dem";

/** Mesh for a DEM. `lod(cx, cz)` gives the sample stride (1, 2, 4...) for a chunk centre. */
export function buildMesh(dem: Dem, chunk: number, lod: (x: number, z: number) => number, skirt: number): THREE.BufferGeometry {
  const n = dem.n;
  const pos: number[] = [];
  const idx: number[] = [];
  const chunks = Math.ceil((n - 1) / chunk);
  for (let cz = 0; cz < chunks; cz++) {
    for (let cx = 0; cx < chunks; cx++) {
      const c0 = cx * chunk;
      const r0 = cz * chunk;
      const c1 = Math.min(n - 1, c0 + chunk);
      const r1 = Math.min(n - 1, r0 + chunk);
      const step = lod(dem.x0 + ((c0 + c1) / 2) * dem.dx, dem.z0 + ((r0 + r1) / 2) * dem.dz);
      const cols: number[] = [];
      const rows: number[] = [];
      for (let c = c0; c < c1; c += step) cols.push(c);
      cols.push(c1);
      for (let r = r0; r < r1; r += step) rows.push(r);
      rows.push(r1);
      const base = pos.length / 3;
      const w = cols.length;
      const hgt = rows.length;
      for (const r of rows) for (const c of cols) pos.push(dem.x0 + c * dem.dx, dem.h[r * n + c]!, dem.z0 + r * dem.dz);
      for (let j = 0; j < hgt - 1; j++) {
        for (let i = 0; i < w - 1; i++) {
          const a = base + j * w + i;
          const b = a + 1;
          const d = a + w;
          const e = d + 1;
          idx.push(a, d, b, b, d, e);
        }
      }
      // skirt: a curtain round the chunk so different strides never show a crack
      const edge: number[] = [];
      for (let i = 0; i < w; i++) edge.push(base + i);
      for (let j = 1; j < hgt; j++) edge.push(base + j * w + w - 1);
      for (let i = w - 2; i >= 0; i--) edge.push(base + (hgt - 1) * w + i);
      for (let j = hgt - 2; j >= 1; j--) edge.push(base + j * w);
      const sb = pos.length / 3;
      for (const v of edge) pos.push(pos[v * 3]!, pos[v * 3 + 1]! - skirt, pos[v * 3 + 2]!);
      for (let k = 0; k < edge.length; k++) {
        const a = edge[k]!;
        const b = edge[(k + 1) % edge.length]!;
        const a2 = sb + k;
        const b2 = sb + ((k + 1) % edge.length);
        idx.push(a, b, a2, b, b2, a2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  g.computeBoundingSphere();
  return g;
}

/** Distance in metres from a point to the nearest mapped point of the route. */
export function distanceToRoute(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < ROUTE_POINTS.length; i += 4) {
    const p = ROUTE_POINTS[i]!;
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** RG: surface normal x and z. B: how open the spot is to the sky. */
export function normalTexture(dem: Dem): THREE.DataTexture {
  const n = dem.n;
  const data = new Uint8Array(n * n * 4);
  // box blur of height for the openness term
  const blur = new Float32Array(n * n);
  const tmp = new Float32Array(n * n);
  const R = 6;
  for (let r = 0; r < n; r++) {
    let sum = 0;
    for (let c = -R; c <= R; c++) sum += dem.at(c, r);
    for (let c = 0; c < n; c++) {
      tmp[r * n + c] = sum / (2 * R + 1);
      sum += dem.at(c + R + 1, r) - dem.at(c - R, r);
    }
  }
  for (let c = 0; c < n; c++) {
    let sum = 0;
    const t = (rr: number) => tmp[Math.max(0, Math.min(n - 1, rr)) * n + c]!;
    for (let r = -R; r <= R; r++) sum += t(r);
    for (let r = 0; r < n; r++) {
      blur[r * n + c] = sum / (2 * R + 1);
      sum += t(r + R + 1) - t(r - R);
    }
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const sx = (dem.at(c + 1, r) - dem.at(c - 1, r)) / (2 * dem.dx);
      const sz = (dem.at(c, r + 1) - dem.at(c, r - 1)) / (2 * dem.dz);
      const inv = 1 / Math.hypot(sx, 1, sz);
      const i = (r * n + c) * 4;
      data[i] = Math.round((-sx * inv * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((-sz * inv * 0.5 + 0.5) * 255);
      const open = 0.62 + (dem.h[r * n + c]! - blur[r * n + c]!) / (dem.dx * 5);
      data[i + 2] = Math.round(Math.max(0, Math.min(1, open)) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Sun shadow over a height grid. One pass: every cell asks the cell next to it,
 * towards the sun, how high the shadow line is there, and lets it fall by the
 * sun's slope on the way across.
 */
export class ShadowMap {
  readonly texture: THREE.DataTexture;
  private data: Uint8Array;
  private line: Float32Array;

  constructor(private dem: Dem) {
    const n = dem.n;
    this.data = new Uint8Array(n * n).fill(255);
    this.line = new Float32Array(n * n);
    this.texture = new THREE.DataTexture(this.data, n, n, THREE.RedFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }

  /** `sx, sy, sz` is the unit vector towards the sun (x east, y up, z south). */
  update(sx: number, sy: number, sz: number): void {
    const { dem, data, line } = this;
    const n = dem.n;
    const h = dem.h;
    const hyp = Math.hypot(sx, sz);
    if (sy < -0.06 || hyp < 1e-4) {
      data.fill(sy > 0.5 ? 255 : 0);
      this.texture.needsUpdate = true;
      return;
    }
    const ux = sx / hyp;
    const uz = sz / hyp;
    const tan = sy / hyp;
    const soft = 1 / 14;
    if (Math.abs(uz / dem.dz) >= Math.abs(ux / dem.dx)) {
      // walk row by row, starting at the edge nearest the sun
      const dir = uz > 0 ? -1 : 1;
      const t = dem.dz / Math.abs(uz);
      const off = (ux * t) / dem.dx;
      const drop = t * tan;
      for (let k = 0; k < n; k++) {
        const r = dir > 0 ? k : n - 1 - k;
        const up = r - dir;
        for (let c = 0; c < n; c++) {
          const i = r * n + c;
          let s = h[i]!;
          if (up >= 0 && up < n) {
            const f = c + off;
            const c0 = Math.floor(f);
            if (c0 >= 0 && c0 < n - 1) {
              const a = f - c0;
              const prev = line[up * n + c0]! * (1 - a) + line[up * n + c0 + 1]! * a - drop;
              if (prev > s) s = prev;
            }
          }
          line[i] = s;
          const v = 1 - (s - h[i]!) * soft;
          data[i] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255) | 0;
        }
      }
    } else {
      const dir = ux > 0 ? -1 : 1;
      const t = dem.dx / Math.abs(ux);
      const off = (uz * t) / dem.dz;
      const drop = t * tan;
      for (let k = 0; k < n; k++) {
        const c = dir > 0 ? k : n - 1 - k;
        const up = c - dir;
        for (let r = 0; r < n; r++) {
          const i = r * n + c;
          let s = h[i]!;
          if (up >= 0 && up < n) {
            const f = r + off;
            const r0 = Math.floor(f);
            if (r0 >= 0 && r0 < n - 1) {
              const a = f - r0;
              const prev = line[r0 * n + up]! * (1 - a) + line[(r0 + 1) * n + up]! * a - drop;
              if (prev > s) s = prev;
            }
          }
          line[i] = s;
          const v = 1 - (s - h[i]!) * soft;
          data[i] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255) | 0;
        }
      }
    }
    this.texture.needsUpdate = true;
  }
}
