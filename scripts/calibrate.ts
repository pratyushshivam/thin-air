import { play } from "../tests/bot";
import { dateLabel } from "../src/sim/weather";
import { clock } from "../src/sim/game";
for (const seed of [1, 2, 3, 7, 1953]) {
  for (const plan of [{}, { rotations: 1 as const }, { flow: 0 }, { flow: 4 }, { icefall: "t08" }, { turn: "t14", keepGoing: true, leave: "leave00", maxWind: 70 }]) {
    const r = play(seed, plan);
    const g = r.game;
    const sc = g.scene;
    console.log(
      seed, JSON.stringify(plan), "->", sc.kind === "end" ? sc.ending + "/" + sc.cause : sc.kind, dateLabel(g.day), clock(g.hour),
      "real", (r.seconds / 60).toFixed(1), "min",
      "| acclim", g.acclim.toFixed(2), "energy", g.energy.toFixed(2), "warm", g.warmth.toFixed(2), "frost", g.frost.toFixed(2), "hyp", g.hyp.toFixed(2),
      "minSpO2", (g.stats.minSpo2 * 100).toFixed(0), "maxAlt", g.stats.maxAlt.toFixed(0), "wc", g.stats.minWindChill.toFixed(0), "O2", g.stats.o2Used.toFixed(0), "summit", g.stats.summitTime ? clock((g.stats.summitTime % 1440) / 60) : "-", "gasps", g.stats.gasps,
    );
    console.log("   ", r.legs.map((l) => `${l.leg} ${l.hours.toFixed(1)}h/${l.seconds.toFixed(0)}s`).join("  "));
  }
}
