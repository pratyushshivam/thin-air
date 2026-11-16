// The instruments and the cards. Plain DOM over the canvas.
import { bottleMinutes } from "../sim/body";
import { BOTTLE_L, FLOWS, clock, type Decision, type Ending, type Cause, type Game } from "../sim/game";
import { PLACES, ROUTE_LENGTH, ROUTE_POINTS, altitudeAt, gradeAt, placeBelow } from "../sim/route";
import { SUMMIT_M } from "../sim/air";
import { LOG } from "../sim/words";
import { dateLabel } from "../sim/weather";

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const fmt = (n: number, d = 0) =>
  n.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/,/g, " ");
const temp = (t: number) => `${t < 0 ? "−" : ""}${Math.abs(Math.round(t))} °C`;

export interface HudActions {
  hold(down: boolean): void;
  flow(f: number): void;
  turnBack(): void;
  mute(): boolean;
  choose(id: string): void;
  restart(sameSeed: boolean): void;
}

export class Hud {
  private root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private bannerTimer = 0;
  private toastTimer = 0;
  private toastQueue: string[] = [];
  private lastFlow = -1;
  private vspeed = 0;

  constructor(
    private act: HudActions,
    seed: number,
  ) {
    this.root = $("#ui");
    this.root.innerHTML = `
      <div class="hud" hidden>
        <div class="where"><div class="place" data-k="place"></div><div class="when" data-k="when"></div><div class="turn" data-k="turn"></div></div>
        <div class="top-right">
          <button class="chip" data-k="back">Turn back</button>
          <button class="chip" data-k="logbtn">Log <span data-k="logn">0</span></button>
          <button class="chip" data-k="mute" aria-label="Sound">Sound on</button>
        </div>
        <div class="kit">
          <div class="alt"><span data-k="alt">5 364</span><small>m</small></div>
          <div class="sub" data-k="togo"></div>
          <div class="rows">
            <div class="row"><label>Air</label><b data-k="air"></b><i data-k="airsub"></i></div>
            <div class="row"><label>Blood oxygen</label><b data-k="spo2"></b><i data-k="spo2sub"></i></div>
            <div class="row"><label>Outside</label><b data-k="wx"></b><i data-k="wxsub"></i></div>
          </div>
          <div class="bars">
            <div class="bar"><label>Strength</label><span><em data-k="energy"></em></span></div>
            <div class="bar"><label>Warmth</label><span><em data-k="warmth"></em></span></div>
          </div>
        </div>
        <div class="o2" data-k="o2" hidden>
          <label>Oxygen <i data-k="o2left"></i></label>
          <div class="bottle"><em data-k="o2bar"></em></div>
          <div class="flows" data-k="flows">${FLOWS.map((f) => `<button data-flow="${f}">${f === 0 ? "off" : f}</button>`).join("")}<small>l/min</small></div>
          <div class="sub" data-k="o2sub"></div>
        </div>
        <svg class="profile" data-k="profile" viewBox="0 0 60 300" preserveAspectRatio="none"></svg>
        <div class="climb">
          <button class="ring" data-k="ring" aria-label="Hold to climb">
            <svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"/><circle class="fill" data-k="ringfill" cx="60" cy="60" r="52"/></svg>
            <span data-k="ringtext">Hold</span>
          </button>
          <div class="hint" data-k="hint">Hold to climb. Let go to breathe.</div>
        </div>
      </div>
      <div class="banner" data-k="banner" hidden><h2></h2><p></p></div>
      <div class="toast" data-k="toast" hidden><small>Logged</small><h3></h3><p></p></div>
      <div class="caption" data-k="caption" hidden></div>
      <div class="card" data-k="card" hidden></div>
      <div class="sheet" data-k="sheet" hidden></div>
      <div class="title" data-k="title">
        <div class="t-in">
          <p class="eyebrow">Mount Everest · South Col route</p>
          <h1>Thin Air</h1>
          <p class="lede">The real mountain, the real route, the real air.<br>On top there is a third of the oxygen you are breathing now.</p>
          <button class="primary" data-k="begin" disabled>Loading the mountain</button>
          <p class="fine">Season <b>${seed}</b> · about twelve minutes · sound on</p>
        </div>
      </div>`;
    this.root.querySelectorAll<HTMLElement>("[data-k]").forEach((e) => (this.el[e.dataset.k!] = e));

    // the profile of the route, drawn once
    const pts = ROUTE_POINTS;
    const lo = pts[0]!.h;
    const hi = SUMMIT_M;
    const path = pts
      .filter((_, i) => i % 3 === 0 || i === pts.length - 1)
      .map((p, i) => `${i ? "L" : "M"}${(8 + (p.s / ROUTE_LENGTH) * 44).toFixed(1)},${(292 - ((p.h - lo) / (hi - lo)) * 284).toFixed(1)}`)
      .join("");
    const ticks = PLACES.filter((p) => p.camp || p.id === "summit")
      .map((p) => {
        const y = 292 - ((altitudeAt(p.s) - lo) / (hi - lo)) * 284;
        const x = 8 + (p.s / ROUTE_LENGTH) * 44;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" class="camp"/>`;
      })
      .join("");
    this.el.profile!.innerHTML = `<line x1="0" x2="60" y1="${(292 - ((8000 - lo) / (hi - lo)) * 284).toFixed(1)}" y2="${(292 - ((8000 - lo) / (hi - lo)) * 284).toFixed(1)}" class="dz"/><path d="${path}"/>${ticks}<circle r="3.2" class="me" data-k="me"/>`;
    this.el.me = $("[data-k=me]", this.el.profile!);

    const ring = this.el.ring!;
    const down = (e: Event) => {
      e.preventDefault();
      act.hold(true);
    };
    const up = () => act.hold(false);
    ring.addEventListener("pointerdown", down);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
    ring.addEventListener("contextmenu", (e) => e.preventDefault());
    this.el.flows!.addEventListener("click", (e) => {
      const f = (e.target as HTMLElement).dataset.flow;
      if (f !== undefined) act.flow(Number(f));
    });
    this.el.back!.addEventListener("click", () => act.turnBack());
    this.el.mute!.addEventListener("click", () => (this.el.mute!.textContent = act.mute() ? "Sound off" : "Sound on"));
  }

  onBegin(fn: () => void): void {
    const b = this.el.begin as HTMLButtonElement;
    b.disabled = false;
    b.textContent = "Begin the climb";
    b.addEventListener("click", fn, { once: true });
  }
  loadFailed(msg: string): void {
    this.el.begin!.textContent = msg;
  }
  hideTitle(): void {
    this.el.title!.classList.add("gone");
    setTimeout(() => (this.el.title!.hidden = true), 1600);
  }
  onLog(fn: () => void): void {
    this.el.logbtn!.addEventListener("click", fn);
  }

  showHud(on: boolean, climbing = true): void {
    this.el.hud = this.el.hud ?? $(".hud", this.root);
    this.el.hud.hidden = !on;
    this.el.hud.classList.toggle("resting", !climbing);
  }

  banner(title: string, sub = "", seconds = 4.5): void {
    const b = this.el.banner!;
    $("h2", b).textContent = title;
    $("p", b).textContent = sub;
    b.hidden = false;
    b.classList.remove("show");
    void b.offsetWidth;
    b.classList.add("show");
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (b.hidden = true), seconds * 1000);
  }

  toast(id: string): void {
    this.toastQueue.push(id);
    if (this.toastQueue.length === 1 && this.el.toast!.hidden) this.nextToast();
  }
  private nextToast(): void {
    const id = this.toastQueue.shift();
    const t = this.el.toast!;
    if (!id || !LOG[id]) {
      t.hidden = true;
      if (this.toastQueue.length) this.nextToast();
      return;
    }
    $("h3", t).textContent = LOG[id]!.title;
    $("p", t).textContent = LOG[id]!.text;
    t.hidden = false;
    t.classList.remove("show");
    void t.offsetWidth;
    t.classList.add("show");
    clearTimeout(this.toastTimer);
    const ms = Math.min(13000, 4500 + LOG[id]!.text.length * 28);
    this.toastTimer = window.setTimeout(() => {
      t.hidden = true;
      this.nextToast();
    }, ms);
  }
  clearToasts(): void {
    this.toastQueue.length = 0;
    clearTimeout(this.toastTimer);
    this.el.toast!.hidden = true;
  }

  caption(text: string | null): void {
    const c = this.el.caption!;
    c.hidden = text === null;
    if (text !== null) c.textContent = text;
  }

  decision(d: Decision | null, g?: Game): void {
    const c = this.el.card!;
    if (!d || !g) {
      c.hidden = true;
      return;
    }
    const rows = (d.forecast ?? [])
      .map((f) => {
        const w = Math.min(100, (f.wind / 140) * 100);
        const cls = f.wind <= 35 ? "ok" : f.wind <= 55 ? "mid" : "bad";
        return `<tr><td>${dateLabel(f.day)}</td><td class="w"><span class="${cls}" style="width:${w}%"></span></td><td>${f.wind} km/h</td><td>${temp(f.temp)}</td><td>${
          f.stormRisk > 0.5 ? "storm likely" : f.stormRisk > 0.3 ? "unsettled" : "settled"
        }</td></tr>`;
      })
      .join("");
    c.innerHTML = `
      <p class="eyebrow">${dateLabel(g.day)} · ${clock(g.hour)} · ${fmt(g.alt)} m</p>
      <h2>${d.title}</h2>
      ${d.lines.map((l) => `<p>${l}</p>`).join("")}
      ${rows ? `<table class="fc"><caption>Forecast for the summit</caption>${rows}</table>` : ""}
      <div class="opts">${d.options
        .map((o) => `<button data-id="${o.id}"><b>${o.label}</b>${o.note ? `<small>${o.note}</small>` : ""}</button>`)
        .join("")}</div>
      <p class="state">Acclimatised ${Math.round(g.acclim * 100)}% · strength ${Math.round(g.energy * 100)}% · blood oxygen ${Math.round(g.spo2 * 100)}%</p>`;
    c.hidden = false;
    c.classList.remove("show");
    void c.offsetWidth;
    c.classList.add("show");
    c.querySelectorAll<HTMLButtonElement>(".opts button").forEach((b) =>
      b.addEventListener("click", () => {
        c.querySelectorAll<HTMLButtonElement>(".opts button").forEach((x) => (x.disabled = true));
        this.act.choose(b.dataset.id!);
      }),
    );
  }

  summit(g: Game, onDown: () => void): void {
    const c = this.el.card!;
    c.innerHTML = `
      <p class="eyebrow">${dateLabel(g.day)} · ${clock(g.hour)}</p>
      <h2>8 848.86 m</h2>
      <p>There is nowhere higher to go. The curve of the Earth is in the horizon, and the sky overhead is nearly the colour of space.</p>
      <p>The barometer reads ${fmt(g.live.pressure)} mmHg. Your blood is carrying ${Math.round(g.spo2 * 100)}% of the oxygen it could. You are halfway.</p>
      <div class="opts"><button data-id="down"><b>Start down</b><small>The clock is still running</small></button></div>`;
    c.hidden = false;
    c.classList.remove("show");
    void c.offsetWidth;
    c.classList.add("show", "late");
    $("button", c).addEventListener("click", () => {
      c.classList.remove("late");
      onDown();
    });
  }

  showLog(g: Game, on: boolean): void {
    const s = this.el.sheet!;
    if (!on) {
      s.hidden = true;
      return;
    }
    s.innerHTML = `<div class="sheet-in"><button class="chip close">Close</button><p class="eyebrow">The log · ${g.log.length} of ${Object.keys(LOG).length}</p>${g.log
      .map((id) => (LOG[id] ? `<article><h3>${LOG[id]!.title}</h3><p>${LOG[id]!.text}</p></article>` : ""))
      .join("")}</div>`;
    s.hidden = false;
    $(".close", s).addEventListener("click", () => (s.hidden = true));
  }

  end(g: Game, ending: Ending, cause: Cause, seed: number): void {
    const st = g.stats;
    const head: Record<Ending, [string, string]> = {
      summit: [
        "You came home.",
        `You stood on top at ${clock(((st.summitTime ?? 0) % 1440) / 60)} and walked back into camp on the South Col at ${clock(g.hour)}. Getting down is the part that counts.`,
      ],
      turned: [
        "You turned around.",
        `At ${fmt(st.turnedAt ?? st.maxAlt)} m, ${fmt(Math.max(0, SUMMIT_M - (st.turnedAt ?? st.maxAlt)))} m below the summit. The mountain will be there next year. So will you.`,
      ],
      lost: [
        "You did not come down.",
        cause === "cold"
          ? "The wind took the heat out of you faster than you could make it. Cold slows the hands first, then the mind."
          : cause === "fall"
            ? "A gust, a stumble, and nothing left to catch it with."
            : "Without enough oxygen the brain does not hurt. It just stops noticing, and you sat down in the snow to rest.",
      ],
      evacuated: [
        "A helicopter took you out.",
        cause === "serac"
          ? "A tower of ice came down across the route while you were in it, in the warm part of the day. You were lucky: a broken leg and a flight to Kathmandu."
          : "You went up before your body had caught up, and your lungs filled. You went down in time. That was the right call, and the only one.",
      ],
      season: ["The monsoon came.", "The window never opened wide enough, or you did not take it. The icefall route is closed and the tents are coming down. Most expeditions have a year like this."],
    };
    const [h, p] = head[ending];
    const rows: [string, string][] = [
      ["Highest point", `${fmt(st.maxAlt, st.maxAlt > 8848.8 ? 2 : 0)} m`],
      ["Lowest blood oxygen", `${Math.round(st.minSpo2 * 100)}%`],
      ["Coldest wind chill", temp(st.minWindChill)],
      ["Strongest wind", `${fmt(st.maxWind)} km/h`],
      ["Time above 8,000 m", `${fmt(st.deathZoneMin / 60, 1)} h`],
      ["Oxygen breathed", `${fmt(st.o2Used)} litres (${fmt(st.o2Used / BOTTLE_L, 1)} bottles)`],
      ["Days on the mountain", `${g.day}`],
      ["Out of breath, stopped", `${st.gasps} times`],
    ];
    const c = this.el.sheet!;
    c.innerHTML = `<div class="sheet-in end ${ending}">
      <p class="eyebrow">${dateLabel(g.day)} · season ${seed}</p>
      <h2>${h}</h2><p class="lede">${p}</p>
      ${
        ending === "lost"
          ? `<p class="quiet">At least 339 people have died on Everest. Most were strong and experienced, and most died coming down.</p>`
          : ""
      }
      <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      <div class="opts row"><button data-r="same"><b>Climb this season again</b><small>Same weather, same mountain</small></button><button data-r="new"><b>A different season</b><small>New weather</small></button></div>
      <p class="eyebrow">What you saw · ${g.log.length} of ${Object.keys(LOG).length}</p>
      ${g.log.map((id) => (LOG[id] ? `<article><h3>${LOG[id]!.title}</h3><p>${LOG[id]!.text}</p></article>` : "")).join("")}
      <p class="fine"><a href="https://github.com/pratyushshivam/thin-air#what-is-real-and-what-is-not" target="_blank" rel="noopener">What is real and what is not</a> · by <a href="https://www.pratyushshivam.com/" target="_blank" rel="noopener">Pratyush Shivam</a></p>
    </div>`;
    c.hidden = false;
    c.querySelectorAll<HTMLButtonElement>("[data-r]").forEach((b) => b.addEventListener("click", () => this.act.restart(b.dataset.r === "same")));
  }

  update(g: Game, held: boolean): void {
    const e = this.el;
    const L = g.live;
    const sc = g.scene;
    const climbing = sc.kind === "climb";
    const pl = placeBelow(g.s + 30);
    e.place!.textContent = climbing && sc.dir < 0 ? `Descending · ${pl.name}` : pl.name;
    e.when!.textContent = `${dateLabel(g.day)} · ${clock(g.hour)}`;
    e.turn!.textContent =
      g.turnaround !== null && climbing && sc.leg === "summit" ? `Turn round by ${clock(((g.turnaround % 1440) / 60))}` : "";
    e.turn!.classList.toggle("late", g.turnaround !== null && g.time > g.turnaround);
    e.alt!.textContent = fmt(L.alt);
    e.togo!.textContent = L.alt >= SUMMIT_M - 0.5 ? "The summit" : `${fmt(SUMMIT_M - L.alt)} m below the summit`;
    e.air!.textContent = `${fmt(L.pressure)} mmHg`;
    e.airsub!.textContent = `${Math.round(L.o2Fraction * 100)}% of the oxygen at sea level`;
    e.spo2!.textContent = `${Math.round(g.spo2 * 100)}%`;
    e.spo2!.classList.toggle("warn", g.spo2 < 0.6);
    e.spo2!.classList.toggle("bad", g.spo2 < 0.48);
    e.spo2sub!.textContent = g.spo2 > 0.92 ? "normal" : g.spo2 > 0.8 ? "low" : g.spo2 > 0.65 ? "a hospital would put you on oxygen" : g.spo2 > 0.5 ? "very low" : "close to passing out";
    e.wx!.textContent = `${temp(L.temp)} · ${fmt(L.wind)} km/h`;
    e.wxsub!.textContent =
      `feels ${temp(L.windChill)}` + (Number.isFinite(L.frostbiteMin) ? ` · bare skin freezes in ${Math.max(1, Math.round(L.frostbiteMin))} min` : "");
    e.wxsub!.classList.toggle("warn", L.frostbiteMin < 10);
    (e.energy as HTMLElement).style.width = `${g.energy * 100}%`;
    (e.warmth as HTMLElement).style.width = `${g.warmth * 100}%`;
    e.energy!.classList.toggle("low", g.energy < 0.2);
    e.warmth!.classList.toggle("low", g.warmth < 0.3);

    const has = g.bottles.length > 0;
    e.o2!.hidden = !has && g.stats.o2Used === 0;
    if (!e.o2!.hidden) {
      const cur = g.bottles[0] ?? 0;
      (e.o2bar as HTMLElement).style.width = `${(cur / BOTTLE_L) * 100}%`;
      e.o2left!.textContent = has ? `bottle ${fmt((cur / BOTTLE_L) * 260)} bar · ${g.bottles.length - 1} spare` : "none left";
      const total = g.bottles.reduce((a, b) => a + b, 0);
      const mins = bottleMinutes(total, g.flow);
      e.o2sub!.textContent = !has ? "You are breathing the mountain's air" : g.flow === 0 ? "Regulator closed" : `${Math.floor(mins / 60)} h ${String(Math.round(mins % 60)).padStart(2, "0")} min left at this rate`;
      e.o2sub!.classList.toggle("warn", has && g.flow > 0 && mins < 180);
      if (this.lastFlow !== g.flow) {
        this.lastFlow = g.flow;
        e.flows!.querySelectorAll<HTMLElement>("button").forEach((b) => b.classList.toggle("on", Number(b.dataset.flow) === g.flow));
      }
    }

    // the breath ring
    const C = 2 * Math.PI * 52;
    (e.ringfill as unknown as SVGCircleElement).style.strokeDasharray = `${C}`;
    (e.ringfill as unknown as SVGCircleElement).style.strokeDashoffset = `${C * (1 - g.debt)}`;
    const gasping = g.gasp > 0;
    e.ring!.classList.toggle("hot", g.debt > 0.75);
    e.ring!.classList.toggle("gasp", gasping);
    e.ring!.classList.toggle("held", held);
    e.ringtext!.textContent = L.queued ? "Wait" : gasping ? "Breathe" : L.gust > 0 ? "Brace" : held ? "Climbing" : "Hold";
    if (L.moving) {
      const v = L.speed * Math.abs(gradeAt(g.s)) * 60;
      this.vspeed += (v - this.vspeed) * 0.02;
    }
    e.hint!.textContent = L.queued
      ? "A queue on the rope ahead. Nothing to do but stand in it."
      : gasping
        ? "Out of breath."
        : L.gust > 0
          ? "Gust. Stand still."
          : climbing && sc.dir < 0
            ? "Going down."
            : this.vspeed > 5 && L.moving
              ? `${fmt(this.vspeed)} metres of height an hour`
              : "Hold to climb. Let go to breathe.";
    e.back!.hidden = !(climbing && sc.dir > 0);
    e.logn!.textContent = String(g.log.length);

    const lo = ROUTE_POINTS[0]!.h;
    const y = 292 - ((L.alt - lo) / (SUMMIT_M - lo)) * 284;
    e.me!.setAttribute("cx", (8 + (g.s / ROUTE_LENGTH) * 44).toFixed(1));
    e.me!.setAttribute("cy", y.toFixed(1));
  }
}
