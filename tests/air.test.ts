import { describe, expect, it } from "vitest";
import {
  frostbiteMinutes,
  heightForPO2,
  horizonDipDeg,
  inspiredPO2,
  oxygenFraction,
  pressureMmHg,
  sunPosition,
  windChillC,
  SUMMIT_M,
} from "../src/sim/air";

describe("barometric pressure (West 1996 model atmosphere)", () => {
  it("is one atmosphere at sea level", () => {
    expect(Math.abs(pressureMmHg(0) - 760)).toBeLessThan(1);
  });
  it("is within 2% of the pressures the 1981 expedition measured (West et al. 1983)", () => {
    for (const [h, p] of [[5400, 400.4], [6300, 351], [8050, 283.6], [8848, 253]] as const) {
      expect(Math.abs(pressureMmHg(h) / p - 1)).toBeLessThan(0.02);
    }
    expect(Math.abs(pressureMmHg(8848) - 253)).toBeLessThan(1);
  });
  it("is above the textbook standard atmosphere's 236 mmHg on the summit", () => {
    expect(pressureMmHg(SUMMIT_M)).toBeGreaterThan(245);
  });
  it("is within 2% of the 272 mmHg measured at 8,400 m in 2007 (Grocott et al. 2009)", () => {
    expect(Math.abs(pressureMmHg(8400) / 272 - 1)).toBeLessThan(0.02);
  });
});

describe("oxygen", () => {
  it("inspired PO2 is 149 mmHg at sea level and 43 mmHg on the summit", () => {
    expect(inspiredPO2(760)).toBeCloseTo(149.2, 0);
    expect(inspiredPO2(253)).toBeCloseTo(43.1, 1);
  });
  it("a breath on the summit holds under a third of a breath at sea level", () => {
    const f = oxygenFraction(SUMMIT_M);
    expect(f).toBeGreaterThan(0.27);
    expect(f).toBeLessThan(0.3);
  });
  it("inverts", () => {
    expect(Math.abs(heightForPO2(inspiredPO2(pressureMmHg(7000))) - 7000)).toBeLessThan(1);
  });
});

describe("wind chill (2001 index), against Environment Canada's table", () => {
  const table: [number, number, number][] = [
    [-10, 10, -15],
    [-20, 20, -30],
    [-30, 40, -48],
    [-40, 60, -64],
  ];
  for (const [t, v, wc] of table) {
    it(`${t} C in ${v} km/h feels like ${wc}`, () => {
      expect(Math.round(windChillC(t, v))).toBe(wc);
    });
  }
  it("gives the summit's May climate: -26 C in 58 km/h is about -45", () => {
    expect(Math.abs(windChillC(-26, 58) - -45)).toBeLessThan(1.5);
  });
  it("is the air temperature in still air", () => {
    expect(windChillC(-20, 2)).toBe(-20);
  });
  it("frostbite bands", () => {
    expect(frostbiteMinutes(-20)).toBe(Infinity);
    expect(frostbiteMinutes(-28)).toBeCloseTo(30, 5);
    expect(frostbiteMinutes(-40)).toBeCloseTo(10, 5);
    expect(frostbiteMinutes(-48)).toBeCloseTo(5, 5);
    expect(frostbiteMinutes(-60)).toBe(2);
  });
});

describe("the sun over Everest", () => {
  it("is nearly overhead at local noon in late May", () => {
    // 23 May is day 143. Solar noon at 86.925 E is about 11:54 Nepal time.
    const s = sunPosition(143, 11.9);
    expect(s.elevation).toBeGreaterThan(81);
    expect(s.elevation).toBeLessThan(84);
  });
  it("rises in the east-north-east a little after five", () => {
    const before = sunPosition(143, 4.9);
    const after = sunPosition(143, 5.6);
    expect(before.elevation).toBeLessThan(0);
    expect(after.elevation).toBeGreaterThan(0);
    expect(after.azimuth).toBeGreaterThan(60);
    expect(after.azimuth).toBeLessThan(75);
  });
  it("the summit sees three degrees below the level horizon", () => {
    expect(horizonDipDeg(SUMMIT_M)).toBeCloseTo(3.02, 1);
  });
});
