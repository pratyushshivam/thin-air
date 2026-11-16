// Small tiling noise textures, made once at start-up so nothing has to be downloaded.
import * as THREE from "three";

function lattice(seed: number) {
  return (x: number, y: number, z: number): number => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
}
const fade = (t: number) => t * t * (3 - 2 * t);

function tile2(size: number, period: number, seed: number): Float32Array {
  const rnd = lattice(seed);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period;
      const fy = (y / size) * period;
      const xi = Math.floor(fx);
      const yi = Math.floor(fy);
      const u = fade(fx - xi);
      const v = fade(fy - yi);
      const a = rnd(xi % period, yi % period, 0);
      const b = rnd((xi + 1) % period, yi % period, 0);
      const c = rnd(xi % period, (yi + 1) % period, 0);
      const d = rnd((xi + 1) % period, (yi + 1) % period, 0);
      out[y * size + x] = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
  }
  return out;
}

function fbm2(size: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < 6; o++) {
    const layer = tile2(size, 4 << o, seed + o * 17);
    for (let i = 0; i < out.length; i++) out[i]! += layer[i]! * amp;
    total += amp;
    amp *= 0.55;
  }
  for (let i = 0; i < out.length; i++) out[i]! /= total;
  return out;
}

/** R: height. G, B: its slope east and south. A: a second, unrelated height. */
export function noiseTexture(size = 256): THREE.DataTexture {
  const a = fbm2(size, 11);
  const b = fbm2(size, 97);
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => a[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const gx = (at(x + 1, y) - at(x - 1, y)) * 9;
      const gy = (at(x, y + 1) - at(x, y - 1)) * 9;
      data[i] = Math.round(Math.max(0, Math.min(1, (at(x, y) - 0.5) * 1.9 + 0.5)) * 255);
      data[i + 1] = Math.round(Math.max(0, Math.min(1, gx + 0.5)) * 255);
      data[i + 2] = Math.round(Math.max(0, Math.min(1, gy + 0.5)) * 255);
      data[i + 3] = Math.round(Math.max(0, Math.min(1, (b[y * size + x]! - 0.5) * 1.9 + 0.5)) * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Tiling 3D cloud noise. */
export function noiseTexture3D(size = 48): THREE.Data3DTexture {
  const data = new Uint8Array(size * size * size);
  const acc = new Float32Array(size * size * size);
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < 4; o++) {
    const period = 3 << o;
    const rnd = lattice(1000 + o * 31);
    for (let z = 0; z < size; z++) {
      const fz = (z / size) * period;
      const zi = Math.floor(fz);
      const w = fade(fz - zi);
      for (let y = 0; y < size; y++) {
        const fy = (y / size) * period;
        const yi = Math.floor(fy);
        const v = fade(fy - yi);
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * period;
          const xi = Math.floor(fx);
          const u = fade(fx - xi);
          const g = (i: number, j: number, k: number) => rnd((xi + i) % period, (yi + j) % period, (zi + k) % period);
          const x00 = g(0, 0, 0) + (g(1, 0, 0) - g(0, 0, 0)) * u;
          const x10 = g(0, 1, 0) + (g(1, 1, 0) - g(0, 1, 0)) * u;
          const x01 = g(0, 0, 1) + (g(1, 0, 1) - g(0, 0, 1)) * u;
          const x11 = g(0, 1, 1) + (g(1, 1, 1) - g(0, 1, 1)) * u;
          const y0 = x00 + (x10 - x00) * v;
          const y1 = x01 + (x11 - x01) * v;
          acc[(z * size + y) * size + x]! += (y0 + (y1 - y0) * w) * amp;
        }
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < acc.length; i++) data[i] = Math.round(Math.max(0, Math.min(1, (acc[i]! / total - 0.5) * 1.7 + 0.5)) * 255);
  const t = new THREE.Data3DTexture(data, size, size, size);
  t.format = THREE.RedFormat;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}
