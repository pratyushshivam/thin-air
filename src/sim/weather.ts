// One spring season on Everest, grown from a seed. The shapes are the real ones:
// the jet stream sits on the summit through April, lifts for a few short windows
// in the second half of May, and the monsoon closes the mountain in early June.
import { SUMMIT_M } from "./air";

/** Day 0 of the season is 12 April. */
export const SEASON_START_DOY = 102;
export const SEASON_YEAR = 2027;
/** The monsoon arrives: day 51 is 2 June. */
export const MONSOON_DAY = 51;

const MONTHS = ["January", "February", "March", "April", "May", "June"];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30];

export function dateLabel(day: number): string {
  let d = SEASON_START_DOY + day;
  for (let m = 0; m < MONTHS.length; m++) {
    if (d <= MONTH_DAYS[m]!) return `${d} ${MONTHS[m]}`;
    d -= MONTH_DAYS[m]!;
  }
  return "June";
}

export function dayOfYear(day: number): number {
  return SEASON_START_DOY + day;
}

/** Deterministic hash of a few integers to 0..1. */
export function hash(seed: number, a: number, b = 0): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (a + 0x7f4a7c15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13) ^ (b + 0x165667b1), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x27d4eb2f) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function smoothNoise(seed: number, tag: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(seed, tag, i) * (1 - u) + hash(seed, tag, i + 1) * u;
}

export interface Window {
  start: number;
  length: number;
}

export interface Day {
  /** Mean wind at the summit, km/h. */
  wind: number;
  /** Mean air temperature at the summit, deg C. */
  temp: number;
  /** Hour at which an afternoon storm arrives, or null. */
  storm: number | null;
  /** 0..1: how many other teams chose this day. */
  crowd: number;
  /** Hour a serac comes down in the icefall, and where (0..1 along it). */
  seracHour: number;
  seracAt: number;
}

export class Season {
  readonly windows: Window[];
  private days: Day[] = [];

  constructor(readonly seed: number) {
    // Two or three windows between 12 May and 27 May.
    const count = 2 + (hash(seed, 11) < 0.45 ? 1 : 0);
    const windows: Window[] = [];
    const span = 15 / count;
    for (let k = 0; k < count; k++) {
      const start = Math.floor(30 + k * span + hash(seed, 12, k) * (span - 2.5));
      const length = 2 + Math.floor(hash(seed, 13, k) * 3);
      windows.push({ start, length: k === count - 1 ? Math.max(3, length) : length });
    }
    this.windows = windows;
    for (let d = 0; d <= 70; d++) this.days.push(this.make(d));
  }

  private make(d: number): Day {
    const seed = this.seed;
    const win = this.windows.find((w) => d >= w.start && d < w.start + w.length);
    // Jet stream: about 120 km/h in mid April, easing through May.
    let wind = 125 - 1.1 * Math.min(d, 45) + (smoothNoise(seed, 21, d / 2.3) - 0.5) * 60;
    if (d > 26) wind -= 18;
    wind = Math.max(48, wind);
    if (win) {
      const edge = d === win.start || d === win.start + win.length - 1;
      wind = 12 + hash(seed, 22, d) * 16 + (edge ? 10 : 0);
    }
    if (d >= MONSOON_DAY) wind = 35 + hash(seed, 23, d) * 30;
    // Summit air warms from about -31 in mid April to about -25 at the end of May.
    const temp = -31 + 6 * Math.min(1, d / 45) + (smoothNoise(seed, 24, d / 3.1) - 0.5) * 7;
    let storm: number | null = null;
    const stormChance = d >= MONSOON_DAY ? 1 : win ? (d === win.start + win.length - 1 ? 0.55 : 0.12) : 0.35;
    if (hash(seed, 25, d) < stormChance) storm = 12.5 + hash(seed, 26, d) * 4.5;
    let crowd = 0;
    if (win) {
      const best = d === win.start + (win.length > 2 ? 1 : 0);
      crowd = best ? 0.7 + hash(seed, 27, d) * 0.3 : d === win.start ? 0.35 : 0.15;
    }
    return {
      wind,
      temp,
      storm,
      crowd,
      seracHour: 10.5 + hash(seed, 28, d) * 4,
      seracAt: 0.3 + hash(seed, 29, d) * 0.5,
    };
  }

  day(d: number): Day {
    return this.days[Math.max(0, Math.min(this.days.length - 1, Math.floor(d)))]!;
  }

  /** Wind in km/h at a height, on a day at an hour, gusts included. */
  wind(heightM: number, d: number, hour: number): number {
    const day = this.day(d);
    const exposure = Math.pow(Math.max(0, Math.min(1, (heightM - 4800) / (SUMMIT_M - 4800))), 1.35);
    let w = day.wind * (0.06 + 0.94 * exposure);
    w *= 0.72 + 0.56 * smoothNoise(this.seed, 31 + d, hour * 9); // gusts over minutes
    return w * this.stormFactor(d, hour) + (this.stormFactor(d, hour) - 1) * 14;
  }

  /** 1 in fair weather, rising to about 2.6 once a storm has arrived. */
  stormFactor(d: number, hour: number): number {
    const s = this.day(d).storm;
    if (s === null || hour < s) return 1;
    return 1 + 1.6 * Math.min(1, (hour - s) / 0.75);
  }

  /** Air temperature in deg C at a height, on a day at an hour. */
  temperature(heightM: number, d: number, hour: number): number {
    const day = this.day(d);
    const lapse = 6.5 * ((SUMMIT_M - heightM) / 1000);
    // Coldest before dawn, warmest mid afternoon; the swing is larger low down.
    const swing = 3 + 4 * Math.max(0, Math.min(1, (SUMMIT_M - heightM) / 3500));
    const diurnal = -Math.cos(((hour - 14.5) / 24) * 2 * Math.PI) * -swing;
    return day.temp + lapse + diurnal - (this.stormFactor(d, hour) - 1) * 4;
  }

  /**
   * What the forecasters say about `target` when asked on `today`. The error
   * grows with every day of lead time, as it does.
   */
  forecast(today: number, target: number): { wind: number; temp: number; stormRisk: number; crowd: number } {
    const lead = Math.max(0, target - today);
    const day = this.day(target);
    const err = (hash(this.seed, 41 + today, target) - 0.5) * 2;
    const wind = Math.max(5, day.wind + err * lead * 7);
    const risk = day.storm !== null ? 0.75 - 0.08 * lead : 0.12 + 0.05 * lead;
    const riskErr = (hash(this.seed, 43 + today, target) - 0.5) * 0.1 * lead;
    return {
      wind: Math.round(wind / 5) * 5,
      temp: Math.round(day.temp + err * lead * 0.6),
      stormRisk: Math.max(0.05, Math.min(0.95, risk + riskErr)),
      crowd: day.crowd,
    };
  }
}
