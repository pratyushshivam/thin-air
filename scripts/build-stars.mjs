// Bakes the naked-eye sky from the HYG 4.1 catalogue (raw/hyg.csv, CC BY-SA 4.0,
// https://github.com/astronexus/HYG-Database): every star to magnitude 5.6.
// Output src/data/stars.json: flat [ra (0.001 h), dec (0.01 deg), mag (0.01), B-V (0.01)] per star.
import { readFileSync, writeFileSync } from "node:fs";
const lines = readFileSync("raw/hyg.csv", "utf8").split(/\r?\n/).filter(Boolean);
const head = lines[0].split(",").map((s) => s.replace(/"/g, ""));
const c = (n) => head.indexOf(n);
const [iRa, iDec, iMag, iCi, iProper] = ["ra", "dec", "mag", "ci", "proper"].map(c);
const out = [];
for (const line of lines.slice(1)) {
  const f = line.split(",").map((s) => s.replace(/"/g, ""));
  if (f[iProper] === "Sol") continue;
  const mag = Number(f[iMag]);
  if (!(mag <= 5.6)) continue;
  out.push([Math.round(Number(f[iRa]) * 1000), Math.round(Number(f[iDec]) * 100), Math.round(mag * 100), Math.round((f[iCi] === "" ? 0.65 : Number(f[iCi])) * 100)]);
}
out.sort((a, b) => a[2] - b[2]);
writeFileSync("src/data/stars.json", JSON.stringify(out.flat()));
console.log(out.length, "stars; brightest", out[0]);
