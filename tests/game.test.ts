import { describe, expect, it } from "vitest";
import { SUMMIT_M } from "../src/sim/air";
import { PLACES, ROUTE_LENGTH, altitudeAt, place } from "../src/sim/route";
import { Season } from "../src/sim/weather";
import { play } from "./bot";

describe("the route", () => {
  it("runs from Base Camp to 8,848.86 m", () => {
    expect(altitudeAt(0)).toBeGreaterThan(5200);
    expect(altitudeAt(0)).toBeLessThan(5400);
    expect(Math.abs(altitudeAt(ROUTE_LENGTH) - SUMMIT_M)).toBeLessThan(1);
    expect(ROUTE_LENGTH).toBeGreaterThan(11000);
    expect(ROUTE_LENGTH).toBeLessThan(14000);
  });
  it("passes its landmarks in order, near their quoted heights", () => {
    for (let i = 1; i < PLACES.length; i++) expect(PLACES[i]!.s).toBeGreaterThan(PLACES[i - 1]!.s);
    for (const id of ["c1", "c2", "c4", "balcony", "south"] as const) {
      const p = place(id);
      expect(Math.abs(altitudeAt(p.s) - p.quoted)).toBeLessThan(60);
    }
  });
});

describe("the season", () => {
  it("has the jet stream on the summit in April and a window in May", () => {
    for (const seed of [1, 2, 3, 4, 5, 99, 1953]) {
      const s = new Season(seed);
      for (let d = 0; d < 20; d++) expect(s.day(d).wind).toBeGreaterThanOrEqual(48);
      let calm = 0;
      for (let d = 30; d < 50; d++) if (s.day(d).wind < 40) calm++;
      expect(calm).toBeGreaterThanOrEqual(4);
    }
  });
  it("is the same season for the same seed", () => {
    expect(new Season(42).day(33)).toEqual(new Season(42).day(33));
    expect(new Season(42).day(33)).not.toEqual(new Season(43).day(33));
  });
});

describe("a whole climb", () => {
  it("a patient, acclimatised climber on oxygen reaches the top and comes home", () => {
    for (const seed of [1, 7, 1953]) {
      const r = play(seed);
      expect(r.game.scene).toMatchObject({ kind: "end", ending: "summit" });
      expect(Math.abs(r.game.stats.maxAlt - SUMMIT_M)).toBeLessThan(1);
      expect(r.seconds).toBeGreaterThan(5 * 60);
      expect(r.seconds).toBeLessThan(15 * 60);
    }
  });
  it("is deterministic", () => {
    const a = play(7);
    const b = play(7);
    expect(a.game.time).toBe(b.game.time);
    expect(a.game.stats).toEqual(b.game.stats);
  });
  it("without bottled oxygen the same climber does not reach the top", () => {
    const r = play(7, { flow: 0 });
    expect(r.game.summited).toBe(false);
    expect(r.game.stats.minSpo2).toBeLessThan(0.45);
  });
  it("going up after one rotation can end in a helicopter", () => {
    const r = play(2, { rotations: 1 });
    expect(r.game.scene).toMatchObject({ kind: "end", ending: "evacuated", cause: "hape" });
  });
  it("ignoring the forecast and the turnaround time can kill", () => {
    const r = play(3, { maxWind: 70, leave: "leave00", turn: "t14", keepGoing: true });
    expect(r.game.scene).toMatchObject({ kind: "end", ending: "lost" });
  });
  it("turning back is an ending you walk away from", () => {
    const r = play(1, { flow: 0 });
    expect(r.game.scene).toMatchObject({ kind: "end", ending: "turned" });
    expect(r.game.stats.turnedAt).toBeGreaterThan(8000);
  });
  it("the icefall in the sun is a gamble", () => {
    expect(play(2, { icefall: "t08" }).game.scene).toMatchObject({ kind: "end", ending: "evacuated", cause: "serac" });
    expect(play(2, { icefall: "t02" }).game.summited).toBe(true);
  });
});
