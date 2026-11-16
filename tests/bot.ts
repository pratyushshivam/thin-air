// A climber made of rules, for the tests: holds until out of breath, rests,
// stands still in gusts, and answers decisions from a table.
import { Game, TICK } from "../src/sim/game";

export interface Plan {
  icefall?: string;
  rotations?: 1 | 2;
  /** Only go when the forecast for summit day is at or under this, km/h. */
  maxWind?: number;
  leave?: string;
  turn?: string;
  flow?: number;
  keepGoing?: boolean;
  /** Seconds to stand on the summit. */
  linger?: number;
}

export interface Run {
  game: Game;
  seconds: number;
  legs: { leg: string; hours: number; seconds: number }[];
}

export function play(seed: number, plan: Plan = {}): Run {
  const g = new Game(seed);
  const legs: Run["legs"] = [];
  let seconds = 0;
  let holding = true;
  let legStart = 0;
  let legT = 0;
  let last = "";
  let summitTicks = 0;
  for (let i = 0; i < 30 * 60 * 60 && g.scene.kind !== "end"; i++) {
    const sc = g.scene;
    if (sc.kind === "decision") {
      const d = sc.decision;
      let pick = d.options[0]!.id;
      if (d.id === "bc-first") pick = plan.icefall ?? "t02";
      else if (d.id === "bc-plan") {
        if ((plan.rotations ?? 2) === 2 && !g.rot2) pick = "rot2";
        else {
          const f = d.forecast![3]!;
          pick = f.wind <= (plan.maxWind ?? 35) ? "push" : "rest1";
        }
      } else if (d.id === "c2-push") pick = "go";
      else if (d.id === "c3-push") pick = "go";
      else if (d.id === "c4") pick = plan.leave ?? "leave22";
      else if (d.id === "c4-turn") pick = plan.turn ?? "t12";
      else if (d.id === "turnaround") pick = plan.keepGoing ? "on" : "turn";
      g.choose(pick);
      if (g.scene.kind === "climb" && plan.flow !== undefined && g.bottles.length) g.setFlow(plan.flow);
      continue;
    }
    if (sc.kind === "summit") {
      if (++summitTicks > (plan.linger ?? 8) * 30) g.choose("descend");
      g.step({ climb: false });
      seconds += TICK;
      continue;
    }
    if (sc.kind === "climb") {
      const key = sc.leg + sc.from;
      if (key !== last) {
        last = key;
        legStart = g.time;
        legT = seconds;
        legs.push({ leg: sc.leg, hours: 0, seconds: 0 });
      }
      if (holding && g.debt > 0.82) holding = false;
      else if (!holding && g.debt < 0.2) holding = true;
      g.step({ climb: holding && g.live.gust === 0 });
      seconds += TICK;
      const l = legs[legs.length - 1]!;
      l.hours = (g.time - legStart) / 60;
      l.seconds = seconds - legT;
    }
  }
  return { game: g, seconds, legs };
}
