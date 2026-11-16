import "./styles.css";
import { Game, TICK, type GameEvent, type Scene } from "./sim/game";
import { INNER, OUTER, PLACES, ROUTE_LENGTH, altitudeAt, place, positionAt, terrainAt } from "./sim/route";
import { dayOfYear } from "./sim/weather";
import { View } from "./render/view";
import { loadDem } from "./world/dem";
import { Sound } from "./ui/audio";
import { Hud } from "./ui/hud";

const query = new URLSearchParams(location.search);
let seed = Number(query.get("seed")) || 1 + Math.floor(Math.random() * 9998);
const canvas = document.getElementById("view") as HTMLCanvasElement;
const mobile = matchMedia("(pointer: coarse)").matches && Math.min(innerWidth, innerHeight) < 820;

let game = new Game(seed);
const sound = new Sound();
let view: View | null = null;
let started = false;
let ringHeld = false;
let keyHeld = false;
let shown: Scene | null = null;
let fade = 1;
let acc = 0;
let shake = 0;
let logOpen = false;
let titleClock = 0;
const lapses: Extract<GameEvent, { type: "lapse" }>[] = [];
let lapse: (Extract<GameEvent, { type: "lapse" }> & { t: number }) | null = null;

const hud = new Hud(
  {
    hold: (down) => {
      ringHeld = down;
      if (down) sound.start();
    },
    flow: (f) => {
      game.setFlow(f);
      sound.click();
    },
    turnBack: () => {
      game.turnBack();
      hud.banner("Turning back", "Down is the hard part done right");
    },
    mute: () => {
      sound.setMuted(!sound.muted);
      return sound.muted;
    },
    choose: (id) => {
      sound.click();
      if (game.scene.kind === "summit") game.choose("descend");
      else game.choose(id);
    },
    restart: (same) => {
      if (!same) seed = 1 + Math.floor(Math.random() * 9998);
      history.replaceState(null, "", `?seed=${seed}`);
      game = new Game(seed);
      shown = null;
      lapses.length = 0;
      lapse = null;
      fade = 1;
      hud.showLog(game, false);
      hud.clearToasts();
    },
  },
  seed,
);
hud.onLog(() => {
  logOpen = !logOpen;
  hud.showLog(game, logOpen);
});

function orbitAt(s: number, radius: number, height: number, speed: number): void {
  if (!view) return;
  const p = positionAt(s);
  view.mode = { kind: "orbit", x: p.x, y: altitudeAt(s) + 2, z: p.z, radius, height, speed };
}

function present(scene: Scene): void {
  if (!view) return;
  const resumed = shown?.kind === "decision" && shown.resume !== undefined && scene.kind === "climb";
  const interrupt = scene.kind === "decision" && scene.resume !== undefined;
  shown = scene;
  if (!resumed && !interrupt) {
    fade = 1;
    view.snap();
  }
  view.s = game.s;
  switch (scene.kind) {
    case "decision":
      game.refresh();
      hud.showHud(true, false);
      hud.decision(scene.decision, game);
      if (!interrupt) {
        // stand a little above camp and look up the route
        const here = positionAt(game.s);
        const ahead = positionAt(Math.min(ROUTE_LENGTH, game.s + 1500));
        const back = positionAt(Math.max(0, game.s - 400));
        const up = game.s > ROUTE_LENGTH - 2000;
        const heading = up ? Math.atan2(back.x - here.x, -(back.z - here.z)) : Math.atan2(ahead.x - here.x, -(ahead.z - here.z));
        const cx = here.x - Math.sin(heading) * 280;
        const cz = here.z + Math.cos(heading) * 280;
        view.mode = { kind: "pano", x: cx, y: Math.max(view.ground(cx, cz), altitudeAt(game.s)) + 120, z: cz, heading, sweep: 24, speed: 0.07 };
        view.yawOffset = 0;
        view.pitchOffset = 0;
        view.zoom = 1;
      }
      break;
    case "climb":
      hud.decision(null);
      hud.showHud(true, true);
      view.mode = { kind: "follow" };
      if (!resumed) {
        view.yawOffset = 0;
        view.pitchOffset = 0;
        view.zoom = 1;
      }
      break;
    case "summit":
      hud.showHud(true, false);
      orbitAt(ROUTE_LENGTH, 70, 9, 0.09);
      view.yawOffset = 0;
      view.zoom = 1;
      hud.summit(game, () => {
        game.choose("descend");
      });
      sound.summit();
      break;
    case "end":
      hud.decision(null);
      hud.showHud(false);
      hud.clearToasts();
      orbitAt(scene.ending === "summit" || scene.ending === "turned" ? place("c4").s : game.s, 900, 260, 0.03);
      hud.end(game, scene.ending, scene.cause, seed);
      if (scene.ending === "lost") sound.toll();
      else sound.chime(scene.ending === "summit");
      break;
  }
}

function handle(e: GameEvent): void {
  switch (e.type) {
    case "log":
      hud.toast(e.id);
      break;
    case "place": {
      const p = PLACES.find((q) => q.id === e.id)!;
      const h = p.quoted === 8848.86 ? "8 848.86 m" : `${p.quoted.toLocaleString("en-GB").replace(",", " ")} m`;
      if (p.id !== "summit") hud.banner(p.name, h);
      sound.chime(p.camp);
      break;
    }
    case "lapse":
      lapses.push(e);
      break;
    case "serac": {
      const near = Math.max(0, 1 - e.distance / 1800);
      sound.collapse(near);
      shake = Math.max(shake, 0.6 + near * 2);
      hud.banner("The icefall moves", e.distance < 330 ? "" : `An ice tower comes down ${Math.round(e.distance / 10) * 10} m from you`);
      break;
    }
    case "gust":
      if (e.phase === "warn") sound.gust();
      else if (e.phase === "hit") shake = Math.max(shake, 0.5);
      else {
        shake = Math.max(shake, 1.4);
        hud.banner("Caught in the gust", "Stand still when the wind rises", 3);
      }
      break;
    case "gasp":
      sound.heartbeat();
      break;
    case "bottle":
      hud.banner("Bottle empty", `Changed to the next. ${e.left - 1} spare.`, 3.5);
      sound.click();
      break;
    case "o2out":
      hud.banner("The oxygen is gone", "");
      break;
    case "storm":
      hud.banner("The weather is turning", "Cloud is coming up from the valleys");
      break;
    case "queue":
      hud.banner("A queue on the rope", `About ${e.minutes} minutes, standing still`);
      break;
    case "heat":
      hud.banner("The Cwm is a furnace", "");
      break;
  }
}

/** One frame of everything. `draw` false skips the picture (used when fast-forwarding in development). */
function frame(dt: number, draw = true): void {
  if (!view) return;
  const g = game;
  let hour = g.hour;
  let doy = dayOfYear(g.day);

  if (started) {
    for (const e of g.events.splice(0)) handle(e);
    if (lapse) {
      lapse.t += dt / 6.5;
      hour = 6.5 + 10.5 * Math.min(1, lapse.t);
      if (lapse.t > 0.88) fade = Math.min(1, fade + dt * 2.2);
      if (lapse.t >= 1) {
        lapse = null;
        hud.caption(null);
      }
    } else if (lapses.length) {
      const l = lapses.shift()!;
      lapse = { ...l, t: 0 };
      hud.decision(null);
      hud.showHud(false);
      fade = 1;
      view.mode = { kind: "fly", from: l.from, to: l.to, seconds: 6.5, t: 0 };
      view.snap();
      view.yawOffset = l.to > l.from ? 0 : 160;
      view.pitchOffset = 6;
      hud.caption(l.days > 0 ? `${l.text} · ${l.days === 1 ? "a day" : `${l.days} days`}` : l.text);
    } else if (g.scene !== shown) {
      present(g.scene);
    } else if (g.scene.kind === "climb" || g.scene.kind === "summit") {
      acc = Math.min(acc + dt, 0.2);
      const hold = ringHeld || keyHeld;
      while (acc >= TICK) {
        g.step({ climb: hold });
        acc -= TICK;
        if (g.scene !== shown) break;
      }
      hour = g.hour;
      doy = dayOfYear(g.day);
    }
  } else {
    // the title: first light on the summit pyramid
    // dawn arrives while you read
    titleClock += dt;
    hour = 5.0 + Math.min(0.55, titleClock / 150);
    doy = 143;
  }

  const sc = g.scene;
  const climbing = started && sc.kind === "climb" && !lapse;
  const L = g.live;
  if (!lapse) view.s = started ? g.s : ROUTE_LENGTH;
  view.dir = sc.kind === "climb" ? sc.dir : 1;
  view.moving = climbing && L.moving;
  view.gasping = climbing && g.gasp > 0;
  view.clarity = started && (climbing || sc.kind === "summit") ? Math.max(0.12, L.clarity) : 1;
  view.cold = started && !lapse ? Math.max(0, Math.min(1, (0.55 - g.warmth) / 0.55)) : 0;
  const day = g.season.day(g.day);
  view.nightLamps = climbing && sc.kind === "climb" && sc.leg === "summit" ? 0.25 + day.crowd : 0;
  shake = Math.max(0, shake - dt * 0.9);
  view.shake = shake + (climbing && L.gust > 1 ? 0.25 : 0);
  fade = Math.max(0, fade - dt * 0.75);
  view.fade = fade;
  const alt = lapse ? altitudeAt(view.mode.kind === "fly" ? view.mode.from + (view.mode.to - view.mode.from) * view.mode.t : g.s) : started ? g.alt : 8600;
  const storm = started && !lapse ? g.season.stormFactor(g.day, hour) : 1;
  view.setSun(doy, hour, alt);
  view.setWeather({
    wind: started ? g.season.wind(alt, g.day, hour) * (L.gust > 1 ? 1.8 : 1) : 30,
    summitWind: started ? day.wind * storm : 75,
    storm,
    hour,
  });
  if (draw) view.render(dt);

  if (started) {
    hud.update(g, ringHeld || keyHeld);
    sound.update(dt, {
      wind: lapse ? 25 : L.wind,
      debt: climbing ? g.debt : 0.1,
      moving: view.moving,
      gasping: view.gasping,
      oxygen: g.oxygenOn,
      thin: Math.max(0, Math.min(1, (alt - 6500) / 2300)),
      icefall: climbing && terrainAt(g.s) === "icefall",
      storm: Math.max(0, storm - 1),
      clarity: view.clarity,
      speed: L.speed,
    });
  }
}

async function boot(): Promise<void> {
  try {
    const [inner, outer] = await Promise.all([loadDem("./data/khumbu.dem", INNER), loadDem("./data/himal.dem", OUTER)]);
    view = new View(canvas, inner, outer, mobile);
  } catch (err) {
    console.error(err);
    hud.loadFailed("This browser could not draw the mountain");
    return;
  }
  const v = view;
  addEventListener("resize", () => v.resize());
  v.s = ROUTE_LENGTH;
  v.mode = { kind: "orbit", x: -700, y: 8250, z: 900, radius: 4300, height: 620, speed: 0.012 };
  v.yawOffset = 205;

  hud.onBegin(() => {
    sound.start();
    started = true;
    hud.hideTitle();
    fade = 1;
  });

  // look around: drag, wheel, pinch
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 1) {
      v.yawOffset -= (e.clientX - p.x) * 0.25;
      v.pitchOffset = Math.max(-12, Math.min(55, v.pitchOffset + (e.clientY - p.y) * 0.18));
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch > 0) v.zoom = Math.max(0.45, Math.min(5, (v.zoom * pinch) / d));
      pinch = d;
    }
  });
  const lift = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      v.zoom = Math.max(0.45, Math.min(5, v.zoom * Math.exp(e.deltaY * 0.0012)));
    },
    { passive: false },
  );
  addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
      keyHeld = true;
      e.preventDefault();
    } else if (/^Digit[0-4]$/.test(e.code) && started) game.setFlow(Number(e.code.slice(5)));
  });
  addEventListener("keyup", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") keyHeld = false;
  });
  addEventListener("blur", () => {
    keyHeld = false;
    ringHeld = false;
  });

  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  if (import.meta.env.DEV) {
    // Development hooks: drive the page without a visible tab, and save frames.
    const dev = {
      view: v,
      get game() {
        return game;
      },
      start() {
        started = true;
        hud.hideTitle();
      },
      /** Advance `seconds` of play, holding the climb control by the rules of the test bot. */
      run(seconds: number, hold = true) {
        let h = true;
        for (let i = 0; i < seconds * 30; i++) {
          if (h && game.debt > 0.82) h = false;
          else if (!h && game.debt < 0.2) h = true;
          keyHeld = hold && h && game.live.gust === 0;
          frame(1 / 30, false);
        }
        keyHeld = false;
        return `${game.scene.kind} s=${game.s.toFixed(0)} alt=${game.alt.toFixed(0)}`;
      },
      choose(id: string) {
        game.choose(id);
      },
      /** Simulation only, no picture: play `seconds` of climbing as the test bot would. */
      fast(seconds: number) {
        let h = true;
        for (let i = 0; i < seconds * 30 && (game.scene.kind === "climb" || game.scene.kind === "summit"); i++) {
          if (h && game.debt > 0.82) h = false;
          else if (!h && game.debt < 0.2) h = true;
          game.step({ climb: h && game.live.gust === 0 });
        }
        game.events.length = 0;
        lapses.length = 0;
        lapse = null;
        hud.caption(null);
        shown = null;
        return `${game.scene.kind} alt=${game.alt.toFixed(0)} ${game.hour.toFixed(1)}h`;
      },
      async shot(name: string, frames = 20) {
        for (let i = 0; i < frames; i++) frame(1 / 60);
        const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.85));
        await fetch(`/__shot?name=${name}`, { method: "POST", body: blob });
        return `${canvas.width}x${canvas.height}`;
      },
      /** The picture with the HUD laid over it (fonts fall back; good enough to check layout). */
      async shotUI(name: string, frames = 20) {
        for (let i = 0; i < frames; i++) frame(1 / 60);
        const w = innerWidth;
        const h = innerHeight;
        const css = [...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).filter((r) => !r.startsWith("@font-face")).join(" ");
        const html = new XMLSerializer().serializeToString(document.getElementById("ui")!);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;position:relative;color:#f4f1ea;font-family:system-ui,sans-serif"><style>${css.replace(/</g, "&lt;")}</style>${html}</div></foreignObject></svg>`;
        const img = new Image();
        await new Promise((r, j) => {
          img.onload = r;
          img.onerror = j;
          img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        });
        frame(1 / 60);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const x = c.getContext("2d")!;
        x.drawImage(canvas, 0, 0, w, h);
        x.drawImage(img, 0, 0);
        const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.85));
        await fetch(`/__shot?name=${name}`, { method: "POST", body: blob });
        return `${w}x${h}`;
      },
    };
    (window as unknown as Record<string, unknown>).ta = dev;
  }
}
void boot();
