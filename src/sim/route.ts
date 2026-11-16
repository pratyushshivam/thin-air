// The South Col route, as mapped in OpenStreetMap, with heights from the baked DEM.
import data from "../data/route.json";

const RAD = Math.PI / 180;
const EARTH_R = 6371008.8;
export const ORIGIN_LAT = 27.9880614;
export const ORIGIN_LON = 86.92521;

/** Local metres: x east, z south, from the summit. */
export function toLocal(lat: number, lon: number): [number, number] {
  return [(lon - ORIGIN_LON) * RAD * Math.cos(ORIGIN_LAT * RAD) * EARTH_R, -(lat - ORIGIN_LAT) * RAD * EARTH_R];
}

export interface Grid {
  n: number;
  step: number;
  west: number;
  north: number;
}
export const INNER = data.inner as Grid;
export const OUTER = data.outer as Grid;

interface Pt {
  x: number;
  z: number;
  h: number;
  s: number;
}

const raw = data.points as number[][];
// The mapped line is hand-drawn; smooth the sampled heights a little so a stray
// vertex on a serac does not read as a cliff.
const pts: Pt[] = raw.map((p) => {
  const [x, z] = toLocal(p[0]!, p[1]!);
  return { x, z, h: p[2]!, s: p[3]! };
});
{
  const h = pts.map((p) => p.h);
  for (let i = 1; i < pts.length - 1; i++) pts[i]!.h = (h[i - 1]! + 2 * h[i]! + h[i + 1]!) / 4;
}

export const ROUTE_LENGTH = pts[pts.length - 1]!.s;
export const ROUTE_POINTS: readonly Pt[] = pts;

function segment(s: number): [Pt, Pt, number] {
  const c = Math.max(0, Math.min(ROUTE_LENGTH, s));
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.s <= c) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[hi]!;
  const t = b.s > a.s ? (c - a.s) / (b.s - a.s) : 0;
  return [a, b, t];
}

/** Height of the route in metres at a distance along it. */
export function altitudeAt(s: number): number {
  const [a, b, t] = segment(s);
  return a.h + (b.h - a.h) * t;
}

/** Position on the map at a distance along the route. */
export function positionAt(s: number): { x: number; z: number } {
  const [a, b, t] = segment(s);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** Rise over run of the route, averaged over a rope length ahead. */
export function gradeAt(s: number): number {
  const a = Math.max(0, s - 30);
  const b = Math.min(ROUTE_LENGTH, s + 30);
  return b > a ? (altitudeAt(b) - altitudeAt(a)) / (b - a) : 0;
}

function nearest(name: string): number {
  const n = (data.nodes as { name: string; lat: number; lon: number }[]).find((q) => q.name === name);
  if (!n) throw new Error(`no node ${name}`);
  const [x, z] = toLocal(n.lat, n.lon);
  let best = 0;
  let bd = Infinity;
  for (const p of pts) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) {
      bd = d;
      best = p.s;
    }
  }
  return best;
}

function firstAbove(h: number, from: number): number {
  for (const p of pts) if (p.s >= from && p.h >= h) return p.s;
  return ROUTE_LENGTH;
}

const c1 = nearest("Camp 1S");
const c2 = nearest("Camp 2S");
const c3 = nearest("Camp 3S");
const c4 = nearest("Camp 4S South Col");
const balcony = nearest("The Balcony");
const southSummit = nearest("Everest South Peak");

export type PlaceId =
  | "bc"
  | "icefall"
  | "c1"
  | "cwm"
  | "c2"
  | "bergschrund"
  | "c3"
  | "yellow"
  | "geneva"
  | "c4"
  | "balcony"
  | "south"
  | "step"
  | "summit";

export interface Place {
  id: PlaceId;
  name: string;
  /** Distance along the route, metres. */
  s: number;
  /** The height usually quoted for it, metres. */
  quoted: number;
  camp?: boolean;
}

/** Landmarks in climbing order. `quoted` heights are the published ones; see README. */
export const PLACES: Place[] = [
  { id: "bc", name: "Base Camp", s: 0, quoted: 5364, camp: true },
  { id: "icefall", name: "Khumbu Icefall", s: firstAbove(5450, 0), quoted: 5486 },
  { id: "c1", name: "Camp I", s: c1, quoted: 6065, camp: true },
  { id: "cwm", name: "Western Cwm", s: (c1 + c2) / 2, quoted: 6200 },
  { id: "c2", name: "Camp II", s: c2, quoted: 6400, camp: true },
  { id: "bergschrund", name: "Lhotse Face", s: firstAbove(6750, c2), quoted: 6700 },
  { id: "c3", name: "Camp III", s: c3, quoted: 7200, camp: true },
  { id: "yellow", name: "Yellow Band", s: firstAbove(7500, c3), quoted: 7600 },
  { id: "geneva", name: "Geneva Spur", s: firstAbove(7750, c3), quoted: 7900 },
  { id: "c4", name: "South Col", s: c4, quoted: 7906, camp: true },
  { id: "balcony", name: "The Balcony", s: balcony, quoted: 8430 },
  { id: "south", name: "South Summit", s: southSummit, quoted: 8749 },
  { id: "step", name: "Hillary Step", s: firstAbove(8790, southSummit), quoted: 8790 },
  { id: "summit", name: "Summit", s: ROUTE_LENGTH, quoted: 8848.86 },
];

export function place(id: PlaceId): Place {
  const p = PLACES.find((q) => q.id === id);
  if (!p) throw new Error(id);
  return p;
}

/** The last landmark at or below a distance along the route. */
export function placeBelow(s: number): Place {
  let best = PLACES[0]!;
  for (const p of PLACES) if (p.s <= s + 1) best = p;
  return best;
}

export type TerrainKind = "moraine" | "icefall" | "cwm" | "face" | "rock" | "ridge";

/** What is underfoot, which sets how hard the going is and what it sounds like. */
export function terrainAt(s: number): TerrainKind {
  if (s < place("icefall").s) return "moraine";
  if (s < c1) return "icefall";
  if (s < place("bergschrund").s) return "cwm";
  if (s < place("yellow").s) return "face";
  if (s < c4) return "rock";
  if (s < balcony) return "face";
  return "ridge";
}
