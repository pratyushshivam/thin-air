import { describe, expect, it } from "vitest";
import { pressureMmHg } from "../src/sim/air";
import { blood, bottleMinutes, breathedFiO2, saturation, vo2maxFraction } from "../src/sim/body";
import { BOTTLE_L } from "../src/sim/game";

describe("haemoglobin (Severinghaus 1979)", () => {
  it("is half saturated at 26.86 mmHg", () => {
    expect(saturation(26.86)).toBeCloseTo(0.5, 3);
  });
  it("is about 97.5% saturated at 100 mmHg", () => {
    expect(saturation(100)).toBeCloseTo(0.977, 2);
  });
  it("holds more oxygen in alkaline blood (Bohr shift)", () => {
    expect(saturation(24.6, 7.53)).toBeGreaterThan(saturation(24.6, 7.4) + 0.08);
  });
});

describe("arterial blood", () => {
  it("is normal at sea level", () => {
    const b = blood(760, 0.2093, 1);
    expect(b.paco2).toBeCloseTo(40, 0);
    expect(b.pao2).toBeGreaterThan(90);
    expect(b.sao2).toBeGreaterThan(0.96);
  });
  it("matches blood drawn at 8,400 m (Grocott et al. 2009: PaO2 24.6, PaCO2 13.3 mmHg)", () => {
    const b = blood(272, 0.2093, 1);
    expect(b.pio2).toBeCloseTo(47.1, 0);
    expect(Math.abs(b.paco2 - 13.3)).toBeLessThan(0.5);
    expect(Math.abs(b.pao2 - 24.6)).toBeLessThan(2.5);
    expect(b.sao2).toBeGreaterThan(0.48);
    expect(b.sao2).toBeLessThan(0.62);
  });
  it("an unacclimatised person on the summit is close to unconscious", () => {
    expect(blood(253, 0.2093, 0).sao2).toBeLessThan(0.2);
  });
  it("acclimatised climbers at Base Camp sit in the eighties", () => {
    const s = blood(pressureMmHg(5300), 0.2093, 1).sao2;
    expect(s).toBeGreaterThan(0.8);
    expect(s).toBeLessThan(0.9);
  });
});

describe("bottled oxygen", () => {
  it("a 4 litre cylinder at 260 bar lasts 8.7 hours at 2 l/min and 4.3 at 4", () => {
    expect(BOTTLE_L).toBe(4 * 260);
    expect(bottleMinutes(BOTTLE_L, 2) / 60).toBeCloseTo(8.67, 1);
    expect(bottleMinutes(BOTTLE_L, 4) / 60).toBeCloseTo(4.33, 1);
    expect(bottleMinutes(BOTTLE_L, 0)).toBe(Infinity);
  });
  it("two litres a minute on the summit helps a great deal, and is still not sea level", () => {
    const p = pressureMmHg(8848.86);
    const f = breathedFiO2(2, p, 80);
    expect(f).toBeGreaterThan(0.27);
    expect(f).toBeLessThan(0.33);
    const b = blood(p, f, 1, 0.75);
    expect(b.sao2).toBeGreaterThan(blood(p, 0.2093, 1, 0.75).sao2 + 0.2);
    expect(b.sao2).toBeLessThan(0.9);
  });
  it("never exceeds pure oxygen", () => {
    expect(breathedFiO2(50, 253, 20)).toBe(1);
  });
});

describe("work capacity", () => {
  it("is under a quarter of sea level on the summit (West et al. 1983)", () => {
    expect(vo2maxFraction(43)).toBeLessThan(0.25);
    expect(vo2maxFraction(149)).toBe(1);
  });
  it("only falls as the air thins", () => {
    for (let p = 30; p < 149; p += 5) expect(vo2maxFraction(p)).toBeLessThanOrEqual(vo2maxFraction(p + 5));
  });
});
