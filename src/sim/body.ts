// The body in thin air: how much oxygen reaches the blood, what bottled oxygen
// adds, and how much work a climber can still do. Built from the alveolar gas
// equation and the Severinghaus dissociation curve, pinned to blood sampled at
// 8,400 m on Everest in 2007 (Grocott et al., N. Engl. J. Med. 360, 2009).
import { FIO2_AIR, PH2O, inspiredPO2 } from "./air";

/** Respiratory exchange ratio used in the alveolar gas equation. */
export const R_EXCHANGE = 0.8;
/** Resting alveolar-arterial oxygen difference measured at 8,400 m, mmHg. */
export const AA_REST = 5.4;
/** Extra alveolar-arterial difference at full effort (diffusion limit), mmHg. */
export const AA_WORK = 5;

/**
 * Oxygen saturation of haemoglobin (0..1) at an oxygen pressure in mmHg and a
 * blood pH. Severinghaus (J. Appl. Physiol. 46, 1979), with the Bohr shift.
 */
export function saturation(po2: number, pH = 7.4): number {
  const p = Math.max(0, po2) * Math.pow(10, 0.48 * (pH - 7.4));
  if (p <= 0) return 0;
  return 1 / (1 + 23400 / (p * p * p + 150 * p));
}

/**
 * Arterial carbon dioxide, mmHg. Breathing harder blows off CO2 and makes room
 * for oxygen in the lungs; that is most of what acclimatisation is. The
 * acclimatised line runs from 40 mmHg at sea level to the 13.3 mmHg measured at
 * 8,400 m; a newcomer hyperventilates only a third as much.
 */
export function arterialPCO2(pio2: number, acclim: number): number {
  const deficit = Math.max(0, 149 - pio2);
  const adapted = Math.max(7.5, 40 - 0.262 * deficit);
  const acute = Math.max(28, 40 - 0.09 * deficit);
  const a = Math.max(0, Math.min(1, acclim));
  return acute + (adapted - acute) * a;
}

/** Blood pH: respiratory alkalosis, fitted to 7.53 at a PCO2 of 13.3 mmHg. */
export function bloodPH(paco2: number): number {
  return 7.4 + (40 - paco2) * (0.13 / 26.7);
}

export interface Blood {
  pio2: number;
  paco2: number;
  pao2: number;
  pH: number;
  /** Arterial saturation, 0..1. */
  sao2: number;
}

/**
 * Arterial blood for a climber breathing gas with oxygen fraction `fio2` at a
 * barometric pressure, acclimatised 0..1 and working at 0..1 of what they can.
 */
export function blood(pressureMmHg: number, fio2: number, acclim: number, effort = 0): Blood {
  const pio2 = inspiredPO2(pressureMmHg, fio2);
  const paco2 = arterialPCO2(pio2, acclim);
  const alveolar = pio2 - paco2 / R_EXCHANGE + (fio2 * paco2 * (1 - R_EXCHANGE)) / R_EXCHANGE;
  const pao2 = Math.max(1, alveolar - AA_REST - AA_WORK * effort);
  const pH = bloodPH(paco2);
  return { pio2, paco2, pao2, pH, sao2: saturation(pao2, pH) };
}

/**
 * Lung ventilation in litres a minute (at body temperature and pressure) for an
 * effort of 0..1 at extreme altitude.
 */
export function ventilationBTPS(effort: number): number {
  return 18 + 62 * Math.max(0, Math.min(1, effort));
}

/**
 * The oxygen fraction a climber actually breathes on bottled oxygen.
 *
 * A regulator delivers `flowLpm` litres a minute measured at 0 deg C and one
 * atmosphere. In the thin air that gas expands (Boyle and Charles), and it is
 * mixed into each breath of ambient air. Mass balance, nothing wasted.
 */
export function breathedFiO2(flowLpm: number, pressureMmHg: number, ventilation: number): number {
  if (flowLpm <= 0) return FIO2_AIR;
  const flowBTPS = flowLpm * (760 / (pressureMmHg - PH2O)) * (310 / 273);
  const added = Math.min(flowBTPS, ventilation);
  return (FIO2_AIR * (ventilation - added) + added) / ventilation;
}

/** Minutes a cylinder holding `litres` of gas lasts at a flow in litres a minute. */
export function bottleMinutes(litres: number, flowLpm: number): number {
  return flowLpm > 0 ? litres / flowLpm : Infinity;
}

/**
 * Greatest oxygen uptake as a fraction of the sea-level figure, by inspired
 * oxygen pressure. The bottom of the curve is pinned to the 1981 American
 * Medical Research Expedition (West et al., J. Appl. Physiol. 55, 1983): at the
 * summit's 43 mmHg two climbers reached about 1 l/min, under a quarter of what
 * fit people manage at sea level. The points between are a smooth join, not
 * measurements.
 */
export function vo2maxFraction(pio2: number): number {
  const pts: [number, number][] = [
    [20, 0.05],
    [43, 0.23],
    [49, 0.31],
    [64, 0.5],
    [80, 0.65],
    [149, 1],
  ];
  if (pio2 <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (pio2 <= b[0]) return a[1] + ((b[1] - a[1]) * (pio2 - a[0])) / (b[0] - a[0]);
  }
  return 1;
}
