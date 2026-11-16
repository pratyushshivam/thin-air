// Every sound is made here, live, from noise and sine waves. No recordings.

export interface Mix {
  /** km/h */
  wind: number;
  /** 0..1 breathlessness */
  debt: number;
  moving: boolean;
  gasping: boolean;
  oxygen: boolean;
  /** 0..1, 1 = high and silent */
  thin: number;
  icefall: boolean;
  storm: number;
  clarity: number;
  /** metres a minute along the route, for the pace of footsteps */
  speed: number;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private windLow!: BiquadFilterNode;
  private windHigh!: BiquadFilterNode;
  private windGain!: GainNode;
  private whistleGain!: GainNode;
  private breathGain!: GainNode;
  private breathFilter!: BiquadFilterNode;
  private hush!: GainNode;
  private phase = 0;
  private inhale = true;
  private stepClock = 0;
  private creakClock = 4;
  private gustBoost = 0;
  muted = false;

  /** Must be called from a tap or key press. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    this.master.connect(comp).connect(ctx.destination);
    this.master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2.5);

    // four seconds of pink-ish noise, looped
    const len = ctx.sampleRate * 4;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
    const loop = (rate = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(0, Math.random() * 3);
      return s;
    };

    // wind: a low body and a high whistle
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windLow = ctx.createBiquadFilter();
    this.windLow.type = "bandpass";
    this.windLow.frequency.value = 260;
    this.windLow.Q.value = 0.6;
    loop(0.8).connect(this.windLow).connect(this.windGain).connect(this.master);
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    this.windHigh = ctx.createBiquadFilter();
    this.windHigh.type = "bandpass";
    this.windHigh.frequency.value = 1400;
    this.windHigh.Q.value = 7;
    loop(1.3).connect(this.windHigh).connect(this.whistleGain).connect(this.master);

    // breath
    this.breathGain = ctx.createGain();
    this.breathGain.gain.value = 0;
    this.breathFilter = ctx.createBiquadFilter();
    this.breathFilter.type = "bandpass";
    this.breathFilter.frequency.value = 900;
    this.breathFilter.Q.value = 1.1;
    loop(1).connect(this.breathFilter).connect(this.breathGain).connect(this.master);

    // the faint hiss of very high, very still air
    this.hush = ctx.createGain();
    this.hush.gain.value = 0;
    const hf = ctx.createBiquadFilter();
    hf.type = "highpass";
    hf.frequency.value = 5200;
    loop(1.7).connect(hf).connect(this.hush).connect(this.master);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.2);
  }

  private burst(freq: number, q: number, gain: number, attack: number, decay: number, rate = 1, type: BiquadFilterType = "bandpass"): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 3);
    s.stop(t + attack + decay + 0.1);
  }

  private tone(freq: number, gain: number, attack: number, decay: number, type: OscillatorType = "sine", glide = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq, t);
    if (glide !== 1) o.frequency.exponentialRampToValueAtTime(freq * glide, t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + attack + decay + 0.1);
  }

  /** Crampon points going into snow or ice. */
  step(hard: boolean): void {
    this.burst(hard ? 3400 : 1900, hard ? 2.2 : 0.9, hard ? 0.2 : 0.16, 0.004, hard ? 0.07 : 0.13, 1.4);
    if (hard) this.burst(6200, 5, 0.07, 0.002, 0.04, 2);
  }

  /** The icefall settling: a groan and a crack. */
  creak(loud = 0.5): void {
    const f = 46 + Math.random() * 50;
    this.tone(f, 0.22 * loud, 0.5, 1.8, "sawtooth", 0.72);
    this.tone(f * 2.02, 0.07 * loud, 0.3, 1.2, "triangle", 0.8);
    if (Math.random() < 0.6) setTimeout(() => this.burst(2400, 1.5, 0.3 * loud, 0.002, 0.18, 1.6), 600 + Math.random() * 900);
  }

  /** A serac coming down. `near` 0..1. */
  collapse(near: number): void {
    this.burst(2000, 0.8, 0.5 * near + 0.15, 0.003, 0.3, 1.2);
    setTimeout(() => {
      this.burst(90, 0.7, 0.9 * near + 0.25, 0.4, 6, 0.5, "lowpass");
      this.burst(400, 0.5, 0.35 * near + 0.1, 0.8, 5, 0.7);
    }, 250);
  }

  gust(): void {
    this.gustBoost = 1;
  }

  /** A small bell for a place reached. */
  chime(high = false): void {
    const base = high ? 660 : 440;
    this.tone(base, 0.07, 0.01, 2.6);
    this.tone(base * 1.5, 0.045, 0.01, 2.2);
    this.tone(base * 2.76, 0.016, 0.005, 1.4);
  }

  /** The top. */
  summit(): void {
    const notes = [196, 293.66, 392, 493.88, 587.33];
    notes.forEach((n, i) => setTimeout(() => this.tone(n, 0.06, 2.5, 9), i * 700));
  }

  /** A low single note for an ending. */
  toll(): void {
    this.tone(110, 0.14, 0.02, 7);
    this.tone(164.8, 0.07, 0.02, 6);
  }

  click(): void {
    this.burst(2600, 4, 0.12, 0.001, 0.03, 2);
  }

  heartbeat(): void {
    this.tone(58, 0.3, 0.01, 0.16, "sine", 0.7);
    setTimeout(() => this.tone(50, 0.22, 0.01, 0.14, "sine", 0.7), 190);
  }

  update(dt: number, m: Mix): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.gustBoost = Math.max(0, this.gustBoost - dt / 2.8);
    const w = Math.min(1.6, m.wind / 70 + this.gustBoost * 0.7 + m.storm * 0.4);
    const swell = 0.75 + 0.25 * Math.sin(t * 0.37) + 0.12 * Math.sin(t * 1.3);
    this.windGain.gain.setTargetAtTime((0.03 + 0.5 * w * w) * swell, t, 0.3);
    this.windLow.frequency.setTargetAtTime(180 + 420 * w + 60 * Math.sin(t * 0.21), t, 0.4);
    this.whistleGain.gain.setTargetAtTime(Math.max(0, w - 0.45) * 0.09 * swell, t, 0.4);
    this.windHigh.frequency.setTargetAtTime(1100 + 900 * w + 250 * Math.sin(t * 0.9), t, 0.3);
    this.hush.gain.setTargetAtTime(m.thin * 0.012 * (1 - Math.min(1, w)), t, 1);

    // breathing: faster and harsher the more you owe
    const rate = 0.28 + m.debt * 0.95 + (m.gasping ? 0.5 : 0) + (1 - m.clarity) * 0.25;
    this.phase += dt * rate * 2;
    if (this.phase >= 1) {
      this.phase = 0;
      this.inhale = !this.inhale;
      const loud = (0.05 + 0.3 * m.debt + (m.gasping ? 0.2 : 0)) * (m.oxygen ? 1.25 : 1);
      const dur = 0.45 / rate;
      this.breathFilter.frequency.setTargetAtTime(m.oxygen ? (this.inhale ? 520 : 380) : this.inhale ? 1500 : 800, t, 0.03);
      this.breathFilter.Q.setTargetAtTime(m.oxygen ? 2.6 : 1.1, t, 0.03);
      this.breathGain.gain.cancelScheduledValues(t);
      this.breathGain.gain.setValueAtTime(this.breathGain.gain.value, t);
      this.breathGain.gain.linearRampToValueAtTime(loud * (this.inhale ? 1 : 0.75), t + dur * 0.35);
      this.breathGain.gain.linearRampToValueAtTime(0.0001, t + dur);
      // the mask's valve
      if (m.oxygen && this.inhale) this.burst(3000, 6, 0.035, 0.001, 0.02, 2);
    }

    if (m.moving) {
      this.stepClock -= dt;
      if (this.stepClock <= 0) {
        this.stepClock = Math.max(0.42, Math.min(1.5, 5.5 / Math.max(2, m.speed)));
        this.step(m.icefall || m.thin > 0.5);
      }
    } else this.stepClock = Math.min(this.stepClock, 0.15);

    if (m.icefall) {
      this.creakClock -= dt;
      if (this.creakClock <= 0) {
        this.creakClock = 5 + Math.random() * 9;
        this.creak(0.35 + Math.random() * 0.4);
      }
    }
  }
}
