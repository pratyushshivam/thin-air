// The air on Everest: pressure, oxygen, temperature, wind chill and where the sun is.
// Every formula here is a published one, and tests/air.test.ts checks each against
// the numbers its source prints.

/** Water vapour pressure in the lungs at body temperature, mmHg. */
export const PH2O = 47;
/** Fraction of dry air that is oxygen. */
export const FIO2_AIR = 0.2093;
export const SEA_LEVEL_MMHG = 760;
export const SUMMIT_M = 8848.86;
export const DEATH_ZONE_M = 8000;

/**
 * Barometric pressure in mmHg at a height in metres.
 *
 * John West's model atmosphere for the latitudes and seasons in which the great
 * mountains are climbed (West, J. Appl. Physiol. 81(4), 1996). The textbook
 * standard atmosphere gives 236 mmHg on the summit; the pressure measured there
 * in 1981 was 253 mmHg, and this curve gives that.
 */
export function pressureMmHg(heightM: number): number {
  const h = heightM / 1000;
  return Math.exp(6.63268 - 0.1112 * h - 0.00149 * h * h);
}

/** Oxygen pressure in the air once it is warm and wet in the airways, mmHg. */
export function inspiredPO2(pressure: number, fio2 = FIO2_AIR): number {
  return Math.max(0, (pressure - PH2O) * fio2);
}

/** How much oxygen each breath holds, as a fraction of a breath at sea level. */
export function oxygenFraction(heightM: number): number {
  return inspiredPO2(pressureMmHg(heightM)) / inspiredPO2(SEA_LEVEL_MMHG);
}

/** The height at which plain air would give this inspired oxygen pressure. */
export function heightForPO2(pio2: number): number {
  let lo = -500;
  let hi = 12000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inspiredPO2(pressureMmHg(mid)) > pio2) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Wind chill in deg C: the 2001 index used by the US National Weather Service and
 * Environment Canada. T in deg C, wind in km/h at 10 m. It is defined for T <= 10
 * and wind above 4.8 km/h; outside that the air temperature is returned.
 */
export function windChillC(tempC: number, windKmh: number): number {
  if (tempC > 10 || windKmh < 4.8) return tempC;
  const v = Math.pow(windKmh, 0.16);
  return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v;
}

/**
 * Minutes until exposed skin can freeze, from Environment Canada's wind chill
 * hazard bands. Infinity when the risk is low.
 */
export function frostbiteMinutes(windChill: number): number {
  if (windChill > -28) return Infinity;
  if (windChill > -40) return 30 - ((-28 - windChill) / 12) * 20; // 10 to 30 minutes
  if (windChill > -48) return 10 - ((-40 - windChill) / 8) * 5; // 5 to 10 minutes
  if (windChill > -55) return 5 - ((-48 - windChill) / 7) * 3; // 2 to 5 minutes
  return 2;
}

// ---- the sun ---------------------------------------------------------------

export const EVEREST_LAT = 27.9881;
export const EVEREST_LON = 86.925;
/** Nepal Time is UTC+5:45. */
export const NPT_OFFSET_H = 5.75;

const RAD = Math.PI / 180;

export interface SunPosition {
  /** Degrees above the horizon. */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

/**
 * Where the sun is, from NOAA's solar position equations (the ones behind the
 * NOAA Solar Calculator). `dayOfYear` counts from 1 January = 1; `nptHours` is
 * local clock time in Nepal.
 */
export function sunPosition(dayOfYear: number, nptHours: number, lat = EVEREST_LAT, lon = EVEREST_LON): SunPosition {
  const utc = nptHours - NPT_OFFSET_H;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utc - 12) / 24);
  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const trueSolarMin = utc * 60 + eqTime + 4 * lon;
  const hourAngle = (trueSolarMin / 4 - 180) * RAD;
  const la = lat * RAD;
  const cosZen = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(hourAngle);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const az = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(la) - Math.tan(decl) * Math.cos(la)) / RAD + 180;
  return { elevation: 90 - zen / RAD, azimuth: ((az % 360) + 360) % 360 };
}

/**
 * How far below the level horizon you can see from a height, in degrees: the
 * reason the sun reaches the summit minutes before it reaches Base Camp.
 */
export function horizonDipDeg(heightM: number): number {
  const R = 6371008.8;
  return Math.acos(R / (R + Math.max(0, heightM))) / RAD;
}

/** Greenwich-referenced local sidereal time in hours, for turning the star catalogue. */
export function siderealHours(year: number, dayOfYear: number, nptHours: number, lon = EVEREST_LON): number {
  const utc = nptHours - NPT_OFFSET_H;
  // days since J2000.0 (2000-01-01 12:00 UT)
  const y = year - 2000;
  const days = y * 365 + Math.floor((y + 3) / 4) + (dayOfYear - 1) - 0.5 + utc / 24;
  const gmst = 18.697374558 + 24.06570982441908 * days;
  return (((gmst + lon / 15) % 24) + 24) % 24;
}
