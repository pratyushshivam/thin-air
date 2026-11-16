// The expedition: one deterministic state machine. Nothing in here touches the
// screen, the clock on the wall or Math.random; the same seed and the same
// inputs give the same climb, which is what tests/game.test.ts leans on.
import { DEATH_ZONE_M, frostbiteMinutes, pressureMmHg, windChillC } from "./air";
import { blood, breathedFiO2, ventilationBTPS, vo2maxFraction } from "./body";
import { PLACES, ROUTE_LENGTH, altitudeAt, gradeAt, place, terrainAt, type PlaceId } from "./route";
import { MONSOON_DAY, Season, dateLabel, hash } from "./weather";

/** Game minutes that pass in one real second of climbing. */
export const TIMESCALE = 3.5;
/** Fixed simulation step, real seconds. */
export const TICK = 1 / 30;
/** Litres of oxygen in one cylinder: 4 litres of water volume filled to 260 bar. */
export const BOTTLE_L = 1040;
export const FLOWS = [0, 1, 2, 3, 4] as const;

export type LegId = "icefall" | "cwm" | "face" | "spur" | "summit" | "descent";
export type Ending = "summit" | "turned" | "lost" | "evacuated" | "season";
export type Cause = "hypoxia" | "cold" | "fall" | "serac" | "hape" | "monsoon" | "choice";

export interface Option {
  id: string;
  label: string;
  note?: string;
}
export interface ForecastRow {
  day: number;
  wind: number;
  temp: number;
  stormRisk: number;
  crowd: number;
}
export interface Decision {
  id: string;
  place: PlaceId;
  title: string;
  lines: string[];
  options: Option[];
  forecast?: ForecastRow[];
}
export interface Climb {
  kind: "climb";
  leg: LegId;
  from: number;
  to: number;
  /** +1 up the route, -1 down it. */
  dir: 1 | -1;
  /** True on the summit push, where turning round ends the expedition. */
  push: boolean;
}
export type Scene =
  | { kind: "decision"; decision: Decision; resume?: Climb }
  | Climb
  | { kind: "summit" }
  | { kind: "end"; ending: Ending; cause: Cause };

export type GameEvent =
  | { type: "log"; id: string }
  | { type: "place"; id: PlaceId }
  | { type: "lapse"; from: number; to: number; days: number; text: string }
  | { type: "serac"; distance: number }
  | { type: "gust"; phase: "warn" | "hit" | "stumble" }
  | { type: "gasp" }
  | { type: "bottle"; left: number }
  | { type: "o2out" }
  | { type: "storm" }
  | { type: "queue"; minutes: number }
  | { type: "heat" };

export interface Input {
  /** The one control: held to climb, released to breathe. */
  climb: boolean;
}

export interface Stats {
  maxAlt: number;
  minSpo2: number;
  minWindChill: number;
  maxWind: number;
  o2Used: number;
  deathZoneMin: number;
  summitTime: number | null;
  leftCol: number | null;
  turnedAt: number | null;
  gasps: number;
}

export interface Live {
  alt: number;
  pressure: number;
  /** Oxygen in a breath of ambient air, relative to sea level. */
  o2Fraction: number;
  wind: number;
  temp: number;
  windChill: number;
  frostbiteMin: number;
  fio2: number;
  capacity: number;
  moving: boolean;
  storm: number;
  heat: boolean;
  /** 0..1 how clearly you are thinking. */
  clarity: number;
  /** 0 none, 0..1 warning, 1..2 the gust itself. */
  gust: number;
  queued: boolean;
  /** Metres a minute along the route when moving. */
  speed: number;
}

const START_DAY = 6; // 18 April
const ACCLIM_START = 0.5;
const ACCLIM_NIGHT: Partial<Record<PlaceId, number>> = { bc: 0.66, c1: 0.78, c2: 0.88, c3: 1, c4: 1 };
const ENERGY_CAP: Partial<Record<PlaceId, number>> = { bc: 1, c1: 0.95, c2: 0.92, c3: 0.84, c4: 0.76 };

const SPEED_C = 0.62;
const TERRAIN_COST = { moraine: 1, icefall: 1.25, cwm: 0.9, face: 1.1, rock: 1.2, ridge: 1.65 } as const;

export class Game {
  readonly season: Season;
  /** Absolute minutes since midnight on day 0 (12 April). */
  time = START_DAY * 1440 + 20 * 60;
  s = 0;
  scene: Scene;
  acclim = ACCLIM_START;
  energy = 1;
  warmth = 1;
  spo2 = 0.85;
  /** Breathlessness, 0..1. At 1 you stop whether you want to or not. */
  debt = 0;
  gasp = 0;
  hyp = 0;
  frost = 0;
  coldMin = 0;
  bottles: number[] = [];
  flow = 0;
  turnaround: number | null = null;
  private turnaroundAsked = false;
  rot1 = false;
  rot2 = false;
  private facePlayed = false;
  private pushing = false;
  summited = false;
  private blockedUntil = 0;
  private queued = false;
  private gustAt = 0;
  private gustTicks = 0;
  private gustMoved = 0;
  private gustCount = 0;
  private seracDone = -1;
  private stormDay = -1;
  private heatSaid = false;
  private colWaits = 0;
  readonly log: string[] = [];
  readonly visited = new Set<PlaceId>(["bc"]);
  events: GameEvent[] = [];
  stats: Stats = {
    maxAlt: 0,
    minSpo2: 1,
    minWindChill: 0,
    maxWind: 0,
    o2Used: 0,
    deathZoneMin: 0,
    summitTime: null,
    leftCol: null,
    turnedAt: null,
    gasps: 0,
  };
  live: Live;

  constructor(readonly seed: number) {
    this.season = new Season(seed);
    this.scene = { kind: "decision", decision: this.bcFirst() };
    this.live = this.measure(false, 0);
    this.spo2 = this.bloodNow(0).sao2;
    this.note("bc");
    this.note("air");
  }

  // ---- clock ---------------------------------------------------------------
  get day(): number {
    return Math.floor(this.time / 1440);
  }
  get hour(): number {
    return (this.time % 1440) / 60;
  }
  get alt(): number {
    return altitudeAt(this.s);
  }
  private setClock(day: number, hour: number): void {
    this.time = day * 1440 + hour * 60;
  }
  /** Move the clock on to the next time it is `hour` o'clock. */
  private nextHour(hour: number): void {
    const d = this.hour < hour ? this.day : this.day + 1;
    this.setClock(d, hour);
  }

  private note(id: string): void {
    if (this.log.includes(id)) return;
    this.log.push(id);
    this.events.push({ type: "log", id });
  }

  // ---- the body --------------------------------------------------------------
  get oxygenOn(): boolean {
    return this.flow > 0 && this.bottles.length > 0 && this.bottles[0]! > 0;
  }

  private bloodNow(effort: number) {
    const p = pressureMmHg(this.alt);
    const fio2 = breathedFiO2(this.oxygenOn ? this.flow : 0, p, ventilationBTPS(effort));
    return { ...blood(p, fio2, this.acclim, effort), fio2 };
  }

  private measure(moving: boolean, gust: number): Live {
    const alt = this.alt;
    const p = pressureMmHg(alt);
    const effort = moving ? 0.75 : this.gasp > 0 ? 0.9 : 0.15;
    const b = this.bloodNow(effort);
    const wind = this.season.wind(alt, this.day, this.hour) * (gust > 1 ? 1.7 : 1);
    const temp = this.season.temperature(alt, this.day, this.hour);
    const wc = windChillC(temp, wind);
    const hour = this.hour;
    const storm = this.season.stormFactor(this.day, hour);
    const heat = terrainAt(this.s) === "cwm" && hour > 9.5 && hour < 15.5 && storm === 1 && this.scene.kind === "climb";
    const cold = 0.6 + 0.4 * Math.min(1, this.warmth / 0.3);
    const capacity =
      vo2maxFraction(b.pio2) * (0.75 + 0.25 * this.acclim) * (0.45 + 0.55 * this.energy) * cold * (heat ? 0.85 : 1);
    const clarity = Math.max(0, Math.min(1, (this.spo2 - 0.36) / 0.3)) * (1 - 0.5 * this.hyp);
    return {
      alt,
      pressure: p,
      o2Fraction: ((p - 47) * 0.2093) / 149.2,
      wind,
      temp,
      windChill: wc,
      frostbiteMin: frostbiteMinutes(wc),
      fio2: b.fio2,
      capacity,
      moving,
      storm,
      heat,
      clarity,
      gust,
      queued: this.queued && this.time < this.blockedUntil,
      speed: 0,
    };
  }

  /** Change the regulator. */
  setFlow(flow: number): void {
    this.flow = this.bottles.length ? Math.max(0, Math.min(4, Math.round(flow))) : 0;
  }

  // ---- stepping -------------------------------------------------------------
  /** Advance by one fixed tick. */
  step(input: Input): void {
    const scene = this.scene;
    if (scene.kind === "climb") this.climbTick(scene, input.climb);
    else if (scene.kind === "summit") this.bodyTick(TICK * TIMESCALE * 0.5, false, 0);
    this.live.clarity = Math.max(0, Math.min(1, (this.spo2 - 0.36) / 0.3)) * (1 - 0.5 * this.hyp);
  }

  private climbTick(c: Climb, hold: boolean): void {
    const dtm = TICK * TIMESCALE;
    const terrain = terrainAt(this.s);
    const exposed = terrain === "face" || terrain === "rock" || terrain === "ridge";

    // gusts: a second of warning, then the blast
    let gust = 0;
    if (this.gustTicks > 0) {
      this.gustTicks--;
      gust = this.gustTicks > 54 ? (90 - this.gustTicks) / 36 : 1.5;
      if (this.gustTicks === 54) this.events.push({ type: "gust", phase: "hit" });
    } else if (exposed && this.time >= this.gustAt) {
      const w = this.season.wind(this.alt, this.day, this.hour);
      const gap = (28 + 40 * hash(this.seed, 71, this.gustCount++)) * Math.max(0.6, Math.min(2, 45 / Math.max(15, w)));
      if (this.gustAt > 0 && w > 22) {
        this.gustTicks = 90;
        this.gustMoved = 0;
        this.events.push({ type: "gust", phase: "warn" });
      }
      this.gustAt = this.time + gap;
    }

    const blocked = this.time < this.blockedUntil;
    let moving = hold && this.gasp <= 0 && !blocked;
    const live = this.measure(moving, gust);

    if (gust > 1 && moving) {
      this.gustMoved++;
      if (this.gustMoved === 14) {
        // caught walking in the blast
        this.events.push({ type: "gust", phase: "stumble" });
        this.debt = 1;
        this.warmth = Math.max(0, this.warmth - 0.02);
        this.energy = Math.max(0, this.energy - 0.012);
        if (terrain === "ridge" && live.clarity < 0.3 && this.energy < 0.1) return this.end("lost", "fall");
      }
    }

    // breath
    if (moving) {
      const k = c.dir > 0 ? 1 : 0.4;
      this.debt += TICK * k * (0.04 + 0.6 * Math.pow(Math.max(0, 1 - live.capacity), 2.5)) * (live.heat ? 1.3 : 1);
      if (this.debt >= 1) {
        this.debt = 1;
        this.gasp = 3;
        this.stats.gasps++;
        this.energy = Math.max(0, this.energy - 0.008);
        this.events.push({ type: "gasp" });
        moving = false;
      }
    } else {
      this.debt = Math.max(0, this.debt - TICK * 0.5 * (0.35 + 0.65 * this.spo2));
      if (this.gasp > 0) this.gasp -= TICK;
    }

    // feet
    if (moving) {
      const grade = gradeAt(this.s) * c.dir;
      const perMetre =
        c.dir > 0
          ? (SPEED_C * (0.012 + 0.1 * Math.max(0, grade) + 0.02 * Math.max(0, -grade)) * TERRAIN_COST[terrain]) /
            Math.max(0.05, live.capacity)
          : (SPEED_C * (0.02 + 0.035 * Math.abs(grade)) * TERRAIN_COST[terrain]) / (0.3 + 0.7 * live.capacity);
      const crawl = this.energy <= 0 ? 0.3 : 1;
      live.speed = crawl / perMetre;
      this.s = Math.max(0, Math.min(ROUTE_LENGTH, this.s + c.dir * live.speed * dtm));
    }
    this.live = live;
    this.bodyTick(dtm, moving, c.dir);
    if (this.scene !== c) return; // the body gave out

    this.landmarks(c);
    if (this.scene !== c) return;

    // the icefall moves when the sun is on it
    if (c.leg === "icefall" || (c.leg === "descent" && terrain === "icefall")) {
      const d = this.season.day(this.day);
      if (this.seracDone !== this.day && this.hour >= d.seracHour && this.hour < d.seracHour + 1) {
        this.seracDone = this.day;
        const at = place("icefall").s + d.seracAt * (place("c1").s - place("icefall").s);
        const distance = Math.abs(this.s - at);
        this.events.push({ type: "serac", distance });
        this.note("serac");
        if (distance < 330) return this.end("evacuated", "serac");
      }
    }
    if (live.storm > 1 && this.stormDay !== this.day) {
      this.stormDay = this.day;
      this.events.push({ type: "storm" });
      this.note("storm");
    }
    if (live.heat && !this.heatSaid) {
      this.heatSaid = true;
      this.events.push({ type: "heat" });
      this.note("heat");
    }

    // the turnaround time you set yourself
    if (c.leg === "summit" && this.turnaround !== null && !this.turnaroundAsked && this.time >= this.turnaround) {
      this.turnaroundAsked = true;
      this.scene = { kind: "decision", decision: this.turnaroundDecision(), resume: c };
      return;
    }

    // arrival
    if ((c.dir > 0 && this.s >= c.to - 0.5) || (c.dir < 0 && this.s <= c.to + 0.5)) this.arrive(c);
  }

  /** Blood, warmth, energy and the oxygen bottle, for `dtm` game minutes. */
  private bodyTick(dtm: number, moving: boolean, dir: number): void {
    this.time += dtm;
    const live = this.scene.kind === "climb" ? this.live : (this.live = this.measure(false, 0));
    const effort = moving ? 0.75 : this.gasp > 0 ? 0.9 : 0.15;
    const target = this.bloodNow(effort).sao2;
    this.spo2 += (target - this.spo2) * Math.min(1, dtm / 4);

    // oxygen bottle
    if (this.oxygenOn) {
      const used = this.flow * dtm;
      this.bottles[0]! -= used;
      this.stats.o2Used += used;
      if (this.bottles[0]! <= 0) {
        this.bottles.shift();
        if (this.bottles.length) this.events.push({ type: "bottle", left: this.bottles.length });
        else {
          this.flow = 0;
          this.events.push({ type: "o2out" });
          this.note("o2out");
        }
      }
    }

    // warmth: work makes heat, wind takes it
    const need = Math.max(0, Math.min(1.7, (-live.windChill - 5) / 45)) * 1.3;
    const made = (moving ? 0.9 : 0.3) + 0.25 + (this.oxygenOn ? 0.1 : 0);
    this.warmth = Math.max(0, Math.min(1, this.warmth + ((made - need) * dtm) / 120));
    if (this.warmth < 0.3 && Number.isFinite(live.frostbiteMin)) this.frost = Math.min(1, this.frost + dtm / (live.frostbiteMin * 10));
    if (this.warmth <= 0) this.coldMin += dtm;
    else this.coldMin = Math.max(0, this.coldMin - dtm * 0.5);

    // energy
    const high = live.alt >= DEATH_ZONE_M;
    const drain = (moving ? (dir > 0 ? 1 / 960 : 1 / 1600) : 1 / 3600) * (high ? 1.3 : 1) * (live.heat ? 1.6 : 1);
    this.energy = Math.max(0, this.energy - drain * dtm);
    if (high) this.stats.deathZoneMin += dtm;

    // the brain
    if (this.spo2 < 0.44) this.hyp += ((0.44 - this.spo2) * dtm) / 18;
    else if (this.spo2 > 0.6) this.hyp = Math.max(0, this.hyp - dtm / 120);

    const st = this.stats;
    st.maxAlt = Math.max(st.maxAlt, live.alt);
    st.minSpo2 = Math.min(st.minSpo2, this.spo2);
    st.minWindChill = Math.min(st.minWindChill, live.windChill);
    st.maxWind = Math.max(st.maxWind, live.wind);

    if (this.hyp >= 1) this.end("lost", "hypoxia");
    else if (this.coldMin > 25) this.end("lost", "cold");
  }

  private landmarks(c: Climb): void {
    for (const p of PLACES) {
      if (this.visited.has(p.id) || this.s < p.s - 2) continue;
      this.visited.add(p.id);
      this.events.push({ type: "place", id: p.id });
      this.note(p.id);
      if (p.id === "balcony" && c.dir > 0) {
        this.bottles.push(BOTTLE_L);
        this.note("cache");
      }
      if (p.id === "step" && c.dir > 0) {
        const crowd = this.season.day(this.day).crowd;
        if (crowd > 0.3) {
          const minutes = Math.round(15 + 60 * crowd);
          this.blockedUntil = this.time + minutes;
          this.queued = true;
          this.events.push({ type: "queue", minutes });
          this.note("queue");
        }
      }
    }
    if (this.alt >= DEATH_ZONE_M) this.note("deathzone");
  }

  private end(ending: Ending, cause: Cause): void {
    if (ending !== "summit" && this.stats.turnedAt === null) this.stats.turnedAt = this.stats.maxAlt;
    this.scene = { kind: "end", ending, cause };
  }

  // ---- nights ------------------------------------------------------------------
  private night(at: PlaceId, nights = 1): void {
    for (let i = 0; i < nights; i++) {
      const target = ACCLIM_NIGHT[at] ?? 0.66;
      if (this.acclim < target) this.acclim += (target - this.acclim) * 0.3;
    }
    this.energy = Math.max(this.energy, Math.min(ENERGY_CAP[at] ?? 1, this.energy + 0.55));
    this.warmth = 1;
    this.debt = 0;
    this.gasp = 0;
    this.hyp = Math.max(0, this.hyp - 0.5);
    this.spo2 = this.bloodNow(0).sao2;
  }

  private startClimb(leg: LegId, from: number, to: number, push: boolean): void {
    this.s = from;
    this.gustAt = 0;
    this.blockedUntil = 0;
    this.queued = false;
    this.scene = { kind: "climb", leg, from, to, dir: to >= from ? 1 : -1, push };
    this.live = this.measure(false, 0);
    this.spo2 = this.bloodNow(0).sao2;
  }

  /** Give up the day and go down. Always allowed while climbing. */
  turnBack(): void {
    const c = this.scene.kind === "climb" ? this.scene : this.scene.kind === "decision" ? this.scene.resume : undefined;
    if (!c || c.dir < 0) return;
    this.stats.turnedAt = this.alt;
    this.note("turned");
    this.scene = { kind: "climb", leg: "descent", from: this.s, to: c.from, dir: -1, push: c.push };
  }

  private arrive(c: Climb): void {
    this.s = c.to;
    if (c.leg === "descent") {
      if (this.summited) return this.end("summit", "choice");
      if (c.push) return this.end("turned", "choice");
      // a rotation cut short: back to Base Camp, a day lost
      this.lapse(this.s, 0, 1, "Down to Base Camp");
      this.s = 0;
      this.setClock(this.day + 1, 15);
      this.night("bc");
      this.scene = { kind: "decision", decision: this.rot1 ? this.bcPlan() : this.bcFirst() };
      return;
    }
    switch (c.leg) {
      case "icefall":
        this.scene = { kind: "decision", decision: this.c1Decision() };
        break;
      case "cwm":
        this.scene = { kind: "decision", decision: this.c2First() };
        break;
      case "face":
        this.facePlayed = true;
        this.scene = { kind: "decision", decision: c.push ? this.c3Push() : this.c3Touch() };
        break;
      case "spur":
        this.scene = { kind: "decision", decision: this.c4Decision() };
        break;
      case "summit":
        this.summited = true;
        this.stats.summitTime = this.time;
        this.note("summit");
        this.scene = { kind: "summit" };
        break;
    }
  }

  private lapse(from: number, to: number, days: number, text: string): void {
    this.events.push({ type: "lapse", from, to, days, text });
  }

  // ---- decisions ----------------------------------------------------------
  private forecastRows(from: number, count: number): ForecastRow[] {
    const rows: ForecastRow[] = [];
    for (let d = from; d < from + count; d++) rows.push({ day: d, ...this.season.forecast(this.day, d) });
    return rows;
  }

  private bcFirst(): Decision {
    return {
      id: "bc-first",
      place: "bc",
      title: "Base Camp",
      lines: [
        "Above the tents the glacier falls 600 metres in a frozen cataract, and it moves about a metre a day. The way to Camp I goes through it.",
        "The ice holds best while it is frozen hard. When do you leave?",
      ],
      options: [
        { id: "t02", label: "Leave at 02:00", note: "By headlamp, in the coldest hours" },
        { id: "t05", label: "Leave at 05:00", note: "First light on the way up" },
        { id: "t08", label: "Leave at 08:00", note: "After breakfast, in the sun" },
      ],
    };
  }

  private c1Decision(): Decision {
    return {
      id: "c1",
      place: "c1",
      title: "Camp I",
      lines: [
        "You are through the icefall. Tonight you sleep higher than any mountain in Europe, Africa or the Americas, and your head knows it.",
        "Tomorrow the Western Cwm: a flat white valley walled by Everest, Lhotse and Nuptse. By midday it is a mirror.",
      ],
      options: [
        { id: "early", label: "Leave at 06:00", note: "Cold fingers, firm snow" },
        { id: "late", label: "Leave at 09:30", note: "A slow morning" },
      ],
    };
  }

  private c2First(): Decision {
    return {
      id: "c2-first",
      place: "c2",
      title: "Camp II",
      lines: [
        "Two nights here at 6,400 metres. You will not sleep much. Your body is making red cells and learning to breathe harder; that is the whole point of coming up.",
        "Then down to Base Camp to recover. Climb high, sleep low.",
      ],
      options: [{ id: "down", label: "Two nights, then down" }],
    };
  }

  private bcPlan(): Decision {
    const options: Option[] = [];
    if (!this.rot2) options.push({ id: "rot2", label: "Second rotation, to Camp III", note: "Six days. Sleep at 7,100 m" });
    options.push({ id: "push", label: "Go for the summit", note: "Summit day would be " + dateLabel(this.day + 4) });
    options.push({ id: "rest1", label: "Wait a day" });
    options.push({ id: "rest3", label: "Wait three days" });
    const left = MONSOON_DAY - this.day;
    return {
      id: "bc-plan",
      place: "bc",
      title: "Base Camp",
      lines: [
        this.rot2
          ? "You are as acclimatised as you are going to get. Now it is the wind's turn to decide."
          : "One rotation done. Most climbers go up once more, to sleep on the Lhotse Face, before they try for the top.",
        left > 12
          ? "The forecast is for the summit, 3,500 metres above you. Nobody climbs in more than about 50 km/h."
          : `The monsoon is about ${left} days away. When it comes the season is over.`,
      ],
      options,
      forecast: this.forecastRows(this.day + 1, 8),
    };
  }

  private c3Touch(): Decision {
    return {
      id: "c3-touch",
      place: "c3",
      title: "Camp III",
      lines: [
        "Tents chopped into a wall of blue ice. Nobody walks between them unclipped.",
        "One bad night here, without bottled oxygen, teaches your body what it needs to know. Then all the way down.",
      ],
      options: [{ id: "down", label: "One night, then down" }],
    };
  }

  private c2Push(): Decision {
    return {
      id: "c2-push",
      place: "c2",
      title: "Camp II",
      lines: [
        "The summit push. From here it is three days up: the Lhotse Face, the South Col, the top.",
        "The forecast has been updated. Summit day would be the third row.",
      ],
      options: [
        { id: "go", label: "Go up" },
        { id: "wait", label: "Wait a day here" },
        { id: "down", label: "Go back to Base Camp" },
      ],
      forecast: this.forecastRows(this.day + 1, 5),
    };
  }

  private c3Push(): Decision {
    const sick = this.acclim < 0.8 && hash(this.seed, 81) < 0.65;
    if (sick) {
      this.note("hape");
      return {
        id: "c3-sick",
        place: "c3",
        title: "Camp III",
        lines: [
          "In the night you wake unable to get your breath lying down, with a wet cough that will not stop. Fluid in the lungs: high-altitude pulmonary oedema.",
          "You came up before your body was ready. There is one treatment that always works, and it is down.",
        ],
        options: [{ id: "evacuate", label: "Go down, now" }],
      };
    }
    return {
      id: "c3-push",
      place: "c3",
      title: "Camp III",
      lines: [
        "From here you breathe bottled oxygen. It does not bring you down to sea level; at two litres a minute it makes the summit feel like 7,000 metres instead of 8,849.",
        "Tomorrow: the Yellow Band, the Geneva Spur, and the South Col.",
      ],
      options: [
        { id: "go", label: "Go on to the South Col" },
        { id: "down", label: "Turn back" },
      ],
      forecast: this.forecastRows(this.day + 1, 3),
    };
  }

  private c4Decision(): Decision {
    const f = this.season.forecast(this.day, this.day + 1);
    const options: Option[] = [
      { id: "leave20", label: "Leave at 20:00", note: "Early. Summit near dawn, long cold dark" },
      { id: "leave22", label: "Leave at 22:00", note: "The usual hour" },
      { id: "leave00", label: "Leave at midnight", note: "More rest, less margin" },
    ];
    if (this.colWaits < 2) options.push({ id: "wait", label: "Wait a day on the Col", note: "Costs a bottle of oxygen and some of you" });
    options.push({ id: "down", label: "Go down" });
    return {
      id: "c4",
      place: "c4",
      title: "South Col",
      lines: [
        "7,906 metres. A plain of stones between Everest and Lhotse, scoured by wind. You are in the death zone: no one acclimatises here, and every hour takes something from you.",
        `Tomorrow on the summit: wind about ${f.wind} km/h, ${f.temp} °C. ${
          f.stormRisk > 0.5 ? "Cloud is expected to build in the afternoon." : "The afternoon looks settled."
        }${f.crowd > 0.6 ? " Many teams are going tonight." : ""}`,
      ],
      options,
      forecast: this.forecastRows(this.day + 1, 2),
    };
  }

  private c4Turn(): Decision {
    return {
      id: "c4-turn",
      place: "c4",
      title: "Turnaround time",
      lines: [
        "Before you leave, decide when you will turn round, summit or no summit. Up there you will not be thinking clearly enough to decide well.",
        "Most of those who die high on Everest die on the way down, late in the day.",
      ],
      options: [
        { id: "t10", label: "10:00", note: "Strict" },
        { id: "t12", label: "12:00", note: "Common" },
        { id: "t14", label: "14:00", note: "The 1996 teams' agreed time" },
      ],
    };
  }

  private turnaroundDecision(): Decision {
    const left = Math.round(8848.86 - this.alt);
    return {
      id: "turnaround",
      place: "summit",
      title: "Your turnaround time",
      lines: [
        `It is ${clock(this.hour)}. This is the time you set. The summit is ${left} metres above you.`,
        "You told yourself you would turn round now.",
      ],
      options: [
        { id: "turn", label: "Turn around" },
        { id: "on", label: "Keep going" },
      ],
    };
  }

  /** Pick an option of the decision on screen. */
  choose(id: string): void {
    const scene = this.scene;
    if (scene.kind === "summit") {
      if (id === "descend") this.scene = { kind: "climb", leg: "descent", from: this.s, to: place("c4").s, dir: -1, push: true };
      return;
    }
    if (scene.kind !== "decision") return;
    const d = scene.decision;
    if (!d.options.some((o) => o.id === id)) return;
    const P = (pid: PlaceId) => place(pid).s;
    switch (d.id) {
      case "bc-first": {
        const hour = id === "t02" ? 2 : id === "t05" ? 5 : 8;
        this.nextHour(hour);
        this.startClimb("icefall", 0, P("c1"), false);
        break;
      }
      case "c1":
        this.night("c1");
        this.nextHour(id === "early" ? 6 : 9.5);
        this.startClimb("cwm", P("c1"), P("c2"), false);
        break;
      case "c2-first":
        this.night("c2", 2);
        this.rot1 = true;
        this.lapse(P("c2"), 0, 3, "Two nights at Camp II, then down");
        this.s = 0;
        this.setClock(this.day + 3, 15);
        this.night("bc");
        this.note("acclim");
        this.scene = { kind: "decision", decision: this.bcPlan() };
        break;
      case "bc-plan":
        if (id === "rest1" || id === "rest3") {
          const n = id === "rest1" ? 1 : 3;
          this.setClock(this.day + n, 15);
          this.night("bc", n);
          this.energy = 1;
          this.afterWait();
        } else if (id === "rot2") {
          this.lapse(0, P("c2"), 2, "Up through the icefall to Camp II");
          this.setClock(this.day + 2, 6);
          this.night("c2", 2);
          this.s = P("c2");
          this.startClimb("face", P("c2"), P("c3"), false);
        } else if (id === "push") {
          this.pushing = true;
          this.lapse(0, P("c2"), 1, "Base Camp to Camp II in a day");
          this.setClock(this.day + 1, 15);
          this.s = P("c2");
          this.night("c2");
          this.scene = { kind: "decision", decision: this.c2Push() };
        }
        break;
      case "c3-touch":
        this.night("c3");
        this.rot2 = true;
        this.lapse(P("c3"), 0, 4, "A night at Camp III, then down to rest");
        this.s = 0;
        this.setClock(this.day + 4, 15);
        this.night("bc", 3);
        this.energy = 1;
        this.afterWait();
        break;
      case "c2-push":
        if (id === "wait") {
          this.setClock(this.day + 1, 15);
          this.night("c2");
          this.scene = { kind: "decision", decision: this.c2Push() };
        } else if (id === "down") {
          this.pushing = false;
          this.lapse(P("c2"), 0, 1, "Down to Base Camp");
          this.s = 0;
          this.setClock(this.day + 1, 15);
          this.night("bc");
          this.afterWait();
        } else {
          this.nextHour(6);
          if (!this.facePlayed) this.startClimb("face", P("c2"), P("c3"), true);
          else {
            this.lapse(P("c2"), P("c3"), 0, "Up the Lhotse Face to Camp III");
            this.s = P("c3");
            this.setClock(this.day, 12);
            this.energy = Math.max(0, this.energy - 0.25);
            this.scene = { kind: "decision", decision: this.c3Push() };
          }
        }
        break;
      case "c3-sick":
        this.end("evacuated", "hape");
        break;
      case "c3-push":
        if (id === "down") {
          this.stats.turnedAt = this.alt;
          this.end("turned", "choice");
          break;
        }
        this.night("c3");
        this.bottles = [BOTTLE_L - 240]; // a night on half a litre a minute
        this.stats.o2Used += 240;
        this.flow = 2;
        this.note("oxygen");
        this.nextHour(6);
        this.startClimb("spur", P("c3"), P("c4"), true);
        break;
      case "c4":
        if (id === "down") {
          this.stats.turnedAt = this.alt;
          this.end("turned", "choice");
        } else if (id === "wait") {
          this.colWaits++;
          this.setClock(this.day + 1, 15);
          this.energy = Math.max(0.2, this.energy - 0.12);
          this.stats.o2Used += BOTTLE_L;
          this.stats.deathZoneMin += 1440;
          this.note("colwait");
          this.scene = { kind: "decision", decision: this.c4Decision() };
        } else {
          const hour = id === "leave20" ? 20 : id === "leave22" ? 22 : 24;
          this.night("c4");
          this.energy = Math.min(this.energy, (ENERGY_CAP.c4 ?? 0.76) - 0.1 * this.colWaits);
          if (hour === 24) this.setClock(this.day + 1, 0);
          else this.setClock(this.day, hour);
          this.bottles = this.colWaits > 0 ? [BOTTLE_L] : [BOTTLE_L, BOTTLE_L];
          this.flow = 2;
          this.scene = { kind: "decision", decision: this.c4Turn() };
        }
        break;
      case "c4-turn": {
        const hour = id === "t10" ? 10 : id === "t12" ? 12 : 14;
        // the next time the clock reads that hour is tomorrow morning
        const base = this.hour >= 12 ? this.day + 1 : this.day;
        this.turnaround = base * 1440 + hour * 60;
        this.turnaroundAsked = false;
        this.stats.leftCol = this.time;
        this.startClimb("summit", P("c4"), ROUTE_LENGTH, true);
        break;
      }
      case "turnaround":
        if (scene.resume) this.scene = scene.resume;
        if (id === "turn") this.turnBack();
        else this.note("fever");
        break;
    }
  }

  private afterWait(): void {
    if (this.day >= MONSOON_DAY) this.end("season", "monsoon");
    else this.scene = { kind: "decision", decision: this.bcPlan() };
  }

  get isPushing(): boolean {
    return this.pushing;
  }
}

export function clock(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
