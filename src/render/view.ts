// Everything drawn: the mountain, the sky by the real sun, cloud, snow in the wind,
// the climber and the camera that keeps them small.
import * as THREE from "three";
import starData from "../data/stars.json";
import { EVEREST_LAT, horizonDipDeg, pressureMmHg, siderealHours, sunPosition } from "../sim/air";
import { PLACES, ROUTE_LENGTH, ROUTE_POINTS, altitudeAt, place, positionAt, terrainAt, type TerrainKind } from "../sim/route";
import { SEASON_YEAR } from "../sim/weather";
import type { Dem } from "../world/dem";
import { Patch, PATCH_HALF } from "../world/patch";
import { ShadowMap, buildMesh, distanceToRoute, normalTexture } from "../world/terrain";
import { noiseTexture, noiseTexture3D } from "./noise";
import {
  LIT_FRAG,
  LIT_VERT,
  PLUME_VERT,
  POST_FRAG,
  POST_VERT,
  SNOW_FRAG,
  SNOW_VERT,
  STAR_FRAG,
  STAR_VERT,
  TERRAIN_FRAG,
  TERRAIN_VERT,
} from "./shaders";

const RAD = Math.PI / 180;
const V = THREE.Vector3;

interface Shot {
  dist: number;
  yaw: number;
  pitch: number;
}
// Each kind of ground has a few camera set-ups; the view glides from one to the next.
// yaw 0 is behind the climber, 180 is in front looking back down the route.
const SHOTS: Record<TerrainKind, Shot[]> = {
  moraine: [{ dist: 44, yaw: 24, pitch: 6 }, { dist: 70, yaw: -40, pitch: 10 }],
  icefall: [{ dist: 46, yaw: -28, pitch: 9 }, { dist: 60, yaw: 150, pitch: 16 }, { dist: 34, yaw: 60, pitch: 5 }],
  cwm: [{ dist: 110, yaw: 30, pitch: 5 }, { dist: 170, yaw: -150, pitch: 9 }, { dist: 70, yaw: -50, pitch: 4 }],
  face: [{ dist: 80, yaw: 150, pitch: 16 }, { dist: 90, yaw: 68, pitch: 3 }, { dist: 130, yaw: -160, pitch: 22 }],
  rock: [{ dist: 66, yaw: -52, pitch: 7 }, { dist: 90, yaw: 160, pitch: 18 }],
  ridge: [{ dist: 74, yaw: -76, pitch: 5 }, { dist: 96, yaw: 165, pitch: 14 }, { dist: 60, yaw: 80, pitch: 9 }],
};

export interface Weather {
  /** km/h where the climber is. */
  wind: number;
  /** km/h on the summit, for the plume. */
  summitWind: number;
  /** 1 fair, up to about 2.6 in a storm. */
  storm: number;
  hour: number;
}

export type CameraMode =
  | { kind: "follow" }
  | { kind: "orbit"; x: number; y: number; z: number; radius: number; height: number; speed: number }
  | { kind: "pano"; x: number; y: number; z: number; heading: number; sweep: number; speed: number }
  | { kind: "fly"; from: number; to: number; seconds: number; t: number };

function shared() {
  return {
    uSun: { value: new V(0, 1, 0) },
    uSunColor: { value: new V(1, 1, 1) },
    uSkySun: { value: new V(1, 1, 1) },
    uGlow: { value: new V(0, 0, 0) },
    uNight: { value: new V(0, 0, 0) },
    uDensity: { value: 0.5 },
    uHaze: { value: 1 },
    uAmbient: { value: new V(0.2, 0.25, 0.35) },
  };
}

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(38, 1, 3, 160000);
  private scene = new THREE.Scene();
  private target: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private post: THREE.ShaderMaterial;
  private u = shared();
  private terrainMats: THREE.ShaderMaterial[] = [];
  private patch: Patch;
  private patchMat: THREE.ShaderMaterial;
  private shadowInner: ShadowMap;
  private shadowOuter: ShadowMap;
  private lastSun = new V(0, -1, 0);
  private shadowTurn = 0;
  private stars: THREE.Points;
  private starMat: THREE.ShaderMaterial;
  private snow: THREE.Points;
  private snowMat: THREE.ShaderMaterial;
  private plumeMat: THREE.ShaderMaterial;
  private litMats: THREE.ShaderMaterial[] = [];
  private tentMat: THREE.ShaderMaterial;
  private climber: THREE.Group;
  private partner: THREE.Group;
  private limbs: THREE.Object3D[] = [];
  private lamps: THREE.Points;
  private lampMat: THREE.ShaderMaterial;
  private routeLine: THREE.Line;
  private time = 0;
  private stride = 0;
  private scale = 1;
  private maxScale: number;
  private frameMs = 16;
  private slowFrames = 0;
  private fastFrames = 0;

  // state the game sets
  s = 0;
  dir: 1 | -1 = 1;
  moving = false;
  gasping = false;
  mode: CameraMode = { kind: "follow" };
  yawOffset = 0;
  pitchOffset = 0;
  zoom = 1;
  clarity = 1;
  cold = 0;
  fade = 1;
  shake = 0;
  nightLamps = 0;
  exposure = 1;
  sunElevation = 45;
  private weather: Weather = { wind: 10, summitWind: 40, storm: 1, hour: 12 };
  private cloudTop = 4700;
  private coverage = 0.42;
  private camPos = new V(0, 9000, 2000);
  private camTarget = new V();
  private first = true;
  private groundUp = new V(0, 1, 0);
  readonly climberPos = new V();

  constructor(
    canvas: HTMLCanvasElement,
    private inner: Dem,
    outer: Dem,
    readonly mobile: boolean,
  ) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" }));
    r.setClearColor(0x000000, 1);
    r.autoClear = true;
    this.maxScale = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5);
    this.scale = this.maxScale;
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.target.depthTexture = new THREE.DepthTexture(4, 4);
    this.target.depthTexture.type = THREE.UnsignedIntType;

    const noise = noiseTexture();
    const noise3 = noiseTexture3D(mobile ? 32 : 48);

    // ---- the mountain ----
    this.shadowInner = new ShadowMap(inner);
    this.shadowOuter = new ShadowMap(outer);
    const terrainMat = (dem: Dem, shadow: ShadowMap, mode: number) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: TERRAIN_VERT,
        fragmentShader: TERRAIN_FRAG,
        uniforms: {
          ...this.u,
          uNormalTex: { value: normalTexture(dem) },
          uShadowTex: { value: shadow.texture },
          uNoiseTex: { value: noise },
          uRect: { value: new THREE.Vector4(dem.x0 - dem.dx / 2, dem.z0 - dem.dz / 2, 1 / (dem.n * dem.dx), 1 / (dem.n * dem.dz)) },
          uMode: { value: mode },
          uPatch: { value: new THREE.Vector4(0, 0, PATCH_HALF, 0) },
          uInner: { value: new THREE.Vector4(inner.x0 + 120, inner.z0 + 120, inner.x0 + inner.width - 120, inner.z0 + inner.depth - 120) },
          uLamp: { value: new THREE.Vector4(0, 0, 0, 0) },
          uSnowfall: { value: 0 },
          uIce: { value: 0 },
        },
      });
      this.terrainMats.push(m);
      return m;
    };
    const fine = mobile ? 2 : 1;
    const innerGeo = buildMesh(
      inner,
      32,
      (x, z) => {
        const d = distanceToRoute(x, z);
        return d < 700 ? 1 : d < 2600 ? fine : d < 6500 ? fine * 2 : fine * 4;
      },
      90,
    );
    const innerMat = terrainMat(inner, this.shadowInner, 0);
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    innerMesh.frustumCulled = false;
    this.scene.add(innerMesh);
    const outerMesh = new THREE.Mesh(buildMesh(outer, 64, () => (mobile ? 2 : 1), 300), terrainMat(outer, this.shadowOuter, 2));
    outerMesh.frustumCulled = false;
    this.scene.add(outerMesh);

    this.patch = new Patch(inner);
    this.patchMat = terrainMat(inner, this.shadowInner, 1);
    this.patchMat.uniforms.uNormalTex = innerMat.uniforms.uNormalTex!;
    const patchMesh = new THREE.Mesh(this.patch.geometry, this.patchMat);
    patchMesh.frustumCulled = false;
    this.scene.add(patchMesh);

    // ---- stars ----
    const sd = starData as number[];
    const count = sd.length / 4;
    const sp = new Float32Array(count * 3);
    const sc = new Float32Array(count * 3);
    const sm = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const ra = (sd[i * 4]! / 1000) * 15 * RAD;
      const dec = (sd[i * 4 + 1]! / 100) * RAD;
      sp[i * 3] = Math.cos(dec) * Math.cos(ra);
      sp[i * 3 + 1] = Math.cos(dec) * Math.sin(ra);
      sp[i * 3 + 2] = Math.sin(dec);
      sm[i] = sd[i * 4 + 2]! / 100;
      const bv = sd[i * 4 + 3]! / 100;
      // blue-white to orange by colour index
      const t = Math.max(0, Math.min(1, (bv + 0.3) / 2));
      sc[i * 3] = 0.7 + 0.3 * t + 0.1;
      sc[i * 3 + 1] = 0.8 + 0.05 * (1 - Math.abs(t - 0.4) * 2);
      sc[i * 3 + 2] = 1.05 - 0.6 * t;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    sg.setAttribute("aColor", new THREE.BufferAttribute(sc, 3));
    sg.setAttribute("aMag", new THREE.BufferAttribute(sm, 1));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uScale: { value: 1 }, uFade: { value: 0 } },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.matrixAutoUpdate = false;
    this.stars.renderOrder = -10;
    this.scene.add(this.stars);

    // ---- snow in the air ----
    const nSnow = mobile ? 2200 : 6000;
    const seeds = new Float32Array(nSnow * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const sng = new THREE.BufferGeometry();
    sng.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nSnow * 3), 3));
    sng.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    this.snowMat = new THREE.ShaderMaterial({
      vertexShader: SNOW_VERT,
      fragmentShader: SNOW_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uCentre: { value: new V() },
        uWind: { value: new V(8, 0, 2) },
        uBox: { value: 150 },
        uScale: { value: 1 },
        uAmount: { value: 0.3 },
        uUp: { value: this.groundUp },
        uTint: { value: new V(1, 1, 1) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
    });
    this.snow = new THREE.Points(sng, this.snowMat);
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);

    // the plume: snow torn off the summit ridges
    const emit: number[] = [];
    const pSeed: number[] = [];
    const ridgeFrom = place("balcony").s;
    const nPlume = mobile ? 500 : 1300;
    for (let i = 0; i < nPlume; i++) {
      let x: number, z: number, y: number;
      if (i % 4 !== 0) {
        const s = ridgeFrom + Math.random() * (ROUTE_LENGTH - ridgeFrom);
        const p = positionAt(s);
        x = p.x;
        z = p.z;
        y = altitudeAt(s);
      } else {
        // the Lhotse and Nuptse crest
        const a = Math.random();
        x = -3800 + a * 4600;
        z = 2250 + Math.sin(a * 3) * 500 + a * 400;
        y = inner.surface(x, z);
        if (y < 7300) {
          x = 730;
          z = 2890;
          y = 8500;
        }
      }
      emit.push(x, y + 4, z);
      pSeed.push(Math.random(), Math.random(), Math.random(), Math.random());
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nPlume * 3), 3));
    pg.setAttribute("aEmit", new THREE.BufferAttribute(new Float32Array(emit), 3));
    pg.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(pSeed), 4));
    this.plumeMat = new THREE.ShaderMaterial({
      vertexShader: PLUME_VERT,
      fragmentShader: SNOW_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: new V(20, 0, 5) },
        uScale: { value: 1 },
        uAmount: { value: 0.5 },
        uTint: { value: new V(1, 1, 1) },
      },
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
    });
    const plume = new THREE.Points(pg, this.plumeMat);
    plume.frustumCulled = false;
    this.scene.add(plume);

    // ---- people and tents ----
    this.climber = this.figure(0xc8281c, 0xe7b416, true);
    this.partner = this.figure(0x1f5fae, 0x2b2b2b, false);
    this.scene.add(this.climber, this.partner);

    this.tentMat = this.lit(0xf2a51a);
    const dome = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const tents: THREE.Matrix4[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const p of PLACES) {
      if (!p.camp) continue;
      const c = positionAt(p.s);
      const n = p.id === "bc" ? 26 : p.id === "c2" ? 14 : 8;
      const spread = p.id === "bc" ? 90 : 34;
      for (let i = 0; i < n; i++) {
        const x = c.x + (rnd() - 0.5) * spread * 2;
        const z = c.z + (rnd() - 0.5) * spread * 1.4;
        if (Math.hypot(x - c.x, z - c.z) < 5) continue;
        const m = new THREE.Matrix4().compose(
          new V(x, inner.surface(x, z) - 0.1, z),
          new THREE.Quaternion().setFromAxisAngle(new V(0, 1, 0), rnd() * 6.3),
          new V(1.5 + rnd() * 0.5, 1.15, 1.2),
        );
        tents.push(m);
      }
    }
    const tentMesh = new THREE.InstancedMesh(dome, this.tentMat, tents.length);
    tents.forEach((m, i) => tentMesh.setMatrixAt(i, m));
    tentMesh.frustumCulled = false;
    this.scene.add(tentMesh);

    // other teams' headlamps on summit night
    const lp: number[] = [0, 0, 0, 0, 0, 0];
    const c4 = place("c4").s;
    for (let i = 0; i < 46; i++) {
      const s = c4 + ((i * 37) % 46) * ((ROUTE_LENGTH - c4) / 46) * 0.82 + 20;
      const p = positionAt(s);
      lp.push(p.x, altitudeAt(s) + 1.6, p.z);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(lp), 3));
    this.lampMat = new THREE.ShaderMaterial({
      vertexShader: `uniform float uScale; uniform float uTime; uniform float uOthers; varying float vA;
        void main(){ vec4 mv = viewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
        vA = (0.75 + 0.25 * sin(uTime * 3.0 + position.x)) * (gl_VertexID < 2 ? 1.0 : min(1.0, uOthers));
        gl_PointSize = uScale * clamp(900.0 / -mv.z, 2.0, 7.0); }`,
      fragmentShader: `precision highp float; varying float vA; uniform float uAmount;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-d*d*4.0) * vA * uAmount;
        gl_FragColor = vec4(vec3(1.0,0.9,0.7) * a, 1.0); }`,
      uniforms: { uScale: { value: 1 }, uTime: { value: 0 }, uAmount: { value: 0 }, uOthers: { value: 0 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.lamps = new THREE.Points(lg, this.lampMat);
    this.lamps.frustumCulled = false;
    this.scene.add(this.lamps);

    // the line of the route, faint
    const rp: number[] = [];
    for (const p of ROUTE_POINTS) rp.push(p.x, inner.surface(p.x, p.z) + 2.5, p.z);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(rp), 3));
    this.routeLine = new THREE.Line(rg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
    this.routeLine.frustumCulled = false;
    this.scene.add(this.routeLine);

    // ---- the last pass ----
    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        ...this.u,
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uNoise3: { value: noise3 },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new V() },
        uTime: { value: 0 },
        uCloudTop: { value: 4700 },
        uCloudBase: { value: 3300 },
        uCoverage: { value: 0.42 },
        uCloudWind: { value: new V() },
        uExposure: { value: 1 },
        uClarity: { value: 1 },
        uCold: { value: 0 },
        uFade: { value: 1 },
        uGrain: { value: 0.035 },
        uSteps: { value: mobile ? 12 : 20 },
        uShake: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.resize();
    this.setSun(143, 6, 5300);
  }

  private lit(color: number, emissive = 0): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      vertexShader: LIT_VERT,
      fragmentShader: LIT_FRAG,
      uniforms: {
        ...this.u,
        uColor: { value: new THREE.Color(color) },
        uEmissive: { value: new THREE.Color(emissive) },
        uShade: { value: 1 },
      },
    });
    this.litMats.push(m);
    return m;
  }

  private figure(suit: number, pack: number, lead: boolean): THREE.Group {
    const g = new THREE.Group();
    const suitM = this.lit(suit);
    const dark = this.lit(0x1b1b1e);
    const packM = this.lit(pack);
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      return mesh;
    };
    const body = new THREE.Group();
    body.add(box(0.5, 0.66, 0.34, suitM, 0, 1.2, 0));
    body.add(box(0.3, 0.3, 0.3, suitM, 0, 1.7, 0.02));
    body.add(box(0.24, 0.1, 0.06, dark, 0, 1.72, 0.16));
    body.add(box(0.4, 0.56, 0.24, packM, 0, 1.24, -0.29));
    const limb = (x: number, y: number, len: number, m: THREE.Material) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      pivot.add(box(0.17, len, 0.19, m, 0, -len / 2, 0));
      body.add(pivot);
      if (lead) this.limbs.push(pivot);
      else pivot.userData.partner = true;
      return pivot;
    };
    const parts = [limb(-0.14, 0.88, 0.86, suitM), limb(0.14, 0.88, 0.86, suitM), limb(-0.34, 1.48, 0.62, suitM), limb(0.34, 1.48, 0.62, suitM)];
    g.userData.limbs = parts;
    g.userData.body = body;
    g.add(body);
    return g;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(1);
    const pw = Math.max(2, Math.round(w * this.scale));
    const ph = Math.max(2, Math.round(h * this.scale));
    this.renderer.setSize(pw, ph, false);
    this.target.setSize(pw, ph);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 54 : 38;
    this.camera.updateProjectionMatrix();
    const k = ph / 1080;
    this.starMat.uniforms.uScale!.value = Math.max(1, k * 1.6);
    this.snowMat.uniforms.uScale!.value = k * 1.8;
    this.plumeMat.uniforms.uScale!.value = k;
    this.lampMat.uniforms.uScale!.value = Math.max(1, k * 1.5);
  }

  /** Cut to the next camera position instead of gliding there. */
  snap(): void {
    this.first = true;
  }

  /** Height of the ground you would stand on. */
  ground(x: number, z: number): number {
    return this.patch.height(x, z);
  }

  /** Put the real sun in the sky for a day of the year and a Nepal clock time. */
  setSun(dayOfYear: number, hour: number, alt: number): void {
    const sun = sunPosition(dayOfYear, hour);
    this.sunElevation = sun.elevation;
    const el = sun.elevation * RAD;
    const az = sun.azimuth * RAD;
    const dir = this.u.uSun.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const density = pressureMmHg(alt) / 760;
    this.u.uDensity.value = density;

    // sunlight after its path through the air (Kasten and Young air mass)
    const dip = horizonDipDeg(alt);
    const e = Math.max(sun.elevation, -3.4);
    const am = 1 / (Math.sin(e * RAD) + 0.50572 * Math.pow(e + 6.07995, -1.6364));
    const path = Math.min(am, 38) * (0.35 + 0.65 * density);
    const up = THREE.MathUtils.smoothstep(sun.elevation, -dip - 0.9, -dip + 1.2);
    const I = 0.8 * up;
    const warm = 1 + 0.5 * (1 - THREE.MathUtils.smoothstep(sun.elevation, 0, 14));
    this.u.uSunColor.value.set(I * warm * Math.exp(-0.04 * path), I * warm * Math.exp(-0.09 * path), I * warm * Math.exp(-0.14 * path));

    this.u.uSkySun.value.copy(this.u.uSunColor.value).lerp(new V(I, I, I), 0.6);
    // twilight: strongest with the sun just under the horizon, gone by -14 degrees
    const tw = THREE.MathUtils.smoothstep(sun.elevation, -15, -3) * (1 - THREE.MathUtils.smoothstep(sun.elevation, -1, 7));
    const deep = THREE.MathUtils.smoothstep(sun.elevation, -12, -2);
    this.u.uGlow.value.set(1.5 * tw * deep, 0.62 * tw * deep, 0.2 * tw).multiplyScalar(0.3);
    const night = 1 - THREE.MathUtils.smoothstep(sun.elevation, -14, -3);
    const dusk = THREE.MathUtils.smoothstep(sun.elevation, -16, -4) * (1 - up);
    this.u.uNight.value.set(0.0016 + 0.03 * dusk, 0.0024 + 0.05 * dusk, 0.0052 + 0.11 * dusk);

    const sc = this.u.uSunColor.value;
    this.u.uAmbient.value
      .set(0.2 * sc.x + 0.02 * sc.z, 0.3 * sc.y + 0.03 * sc.z, 0.62 * sc.z)
      .multiplyScalar(0.62 * (0.45 + 0.55 * density))
      .add(new V(0.03, 0.045, 0.085).multiplyScalar(night))
      .add(new V(0.03, 0.045, 0.085).multiplyScalar(dusk));
    this.exposure = 1 + 0.5 * dusk * (1 - night) + 0.8 * night + 0.35 * (1 - THREE.MathUtils.smoothstep(sun.elevation, 0, 10)) * up;
    this.starMat.uniforms.uFade!.value = night * 0.06;

    // turn the star catalogue to this place and hour
    const L = siderealHours(SEASON_YEAR, dayOfYear, hour) * 15 * RAD;
    const phi = EVEREST_LAT * RAD;
    const sinL = Math.sin(L);
    const cosL = Math.cos(L);
    // rows: world x (east), y (up), z (south = -north)
    this.stars.matrix.set(
      -sinL, cosL, 0, 0,
      Math.cos(phi) * cosL, Math.cos(phi) * sinL, Math.sin(phi), 0,
      Math.sin(phi) * cosL, Math.sin(phi) * sinL, -Math.cos(phi), 0,
      0, 0, 0, 1,
    );
    this.stars.matrixWorld.copy(this.stars.matrix);

    // shadows: only when the sun has moved enough to see
    if (dir.dot(this.lastSun) < 0.99997) {
      if (this.shadowTurn === 0) {
        this.shadowInner.update(dir.x, dir.y, dir.z);
        this.shadowTurn = 1;
      } else {
        this.shadowOuter.update(dir.x, dir.y, dir.z);
        this.shadowTurn = 0;
        this.lastSun.copy(dir);
      }
    }
  }

  setWeather(w: Weather): void {
    this.weather = w;
  }

  /** World position of a point on the route, on the drawn ground. */
  routePoint(s: number, out = new V()): THREE.Vector3 {
    const p = positionAt(s);
    return out.set(p.x, this.ground(p.x, p.z), p.z);
  }

  /** Screen position (CSS pixels) of a world point, or null if behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new V(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  private pose(g: THREE.Group, s: number, moving: boolean, bent: number, phase: number): void {
    const p = this.routePoint(s);
    const a = this.routePoint(Math.min(ROUTE_LENGTH, s + 2 * this.dir));
    const b = this.routePoint(Math.max(0, s - 2 * this.dir));
    const heading = Math.atan2(a.x - b.x, a.z - b.z);
    g.position.copy(p);
    g.rotation.set(0, heading, 0);
    const body = g.userData.body as THREE.Group;
    const climb = Math.atan2(a.y - b.y, Math.hypot(a.x - b.x, a.z - b.z));
    body.rotation.x = Math.max(-0.2, Math.min(0.5, climb * 0.45)) + bent * 0.6;
    const limbs = g.userData.limbs as THREE.Group[];
    const sw = moving ? Math.sin(phase) * 0.55 : 0;
    limbs[0]!.rotation.x = sw;
    limbs[1]!.rotation.x = -sw;
    limbs[2]!.rotation.x = -sw * 0.8 - bent * 0.5;
    limbs[3]!.rotation.x = sw * 0.8 - bent * 0.5;
    body.position.y = moving ? Math.abs(Math.sin(phase)) * 0.05 : 0;
  }

  render(dt: number): void {
    this.time += dt;
    const t = this.time;
    const w = this.weather;

    // fly-overs move the point the camera follows
    let s = this.s;
    if (this.mode.kind === "fly") {
      const m = this.mode;
      m.t = Math.min(1, m.t + dt / m.seconds);
      const k = m.t * m.t * (3 - 2 * m.t);
      s = m.from + (m.to - m.from) * k;
    }
    const kind = terrainAt(s);
    const here = positionAt(s);
    if (this.patch.update(here.x, here.z, kind, s)) {
      for (const m of this.terrainMats) m.uniforms.uPatch!.value.set(this.patch.cx, this.patch.cz, PATCH_HALF, 1);
    }

    // people
    if (this.moving) this.stride += dt * 5.2;
    const flying = this.mode.kind === "fly";
    this.climber.visible = this.partner.visible = !flying;
    this.pose(this.climber, s, this.moving, this.gasping ? 1 : 0, this.stride);
    this.pose(this.partner, Math.max(0, Math.min(ROUTE_LENGTH, s + 7 * this.dir)), this.moving, 0, this.stride + 1.7);
    this.climberPos.copy(this.climber.position);
    const cp = this.climberPos;
    // slope under the climber, for the snow to skim along
    const gx = this.ground(cp.x + 4, cp.z) - this.ground(cp.x - 4, cp.z);
    const gz = this.ground(cp.x, cp.z + 4) - this.ground(cp.x, cp.z - 4);
    this.groundUp.set(-gx / 8, 1, -gz / 8).normalize();

    // ---- camera ----
    const want = new V();
    const look = new V();
    if (this.mode.kind === "orbit") {
      const m = this.mode;
      const a = t * m.speed + this.yawOffset * RAD;
      const rad = m.radius * this.zoom;
      want.set(m.x + Math.sin(a) * rad, m.y + m.height + this.pitchOffset * rad * 0.012, m.z + Math.cos(a) * rad);
      look.set(m.x, m.y, m.z);
    } else if (this.mode.kind === "pano") {
      // stand at a camp and look slowly across what is above it
      const m = this.mode;
      const a = m.heading + (Math.sin(t * m.speed) * m.sweep + this.yawOffset) * RAD;
      want.set(m.x, m.y, m.z);
      look.set(m.x + Math.sin(a) * 1000, m.y + 1000 * Math.tan((2 - this.pitchOffset * 0.5) * RAD), m.z - Math.cos(a) * 1000);
    } else {
      const set = SHOTS[kind];
      const shot = set[Math.floor(t / 22) % set.length]!;
      const wide = flying ? 3.4 : 1;
      const a = this.routePoint(Math.min(ROUTE_LENGTH, s + 25));
      const b = this.routePoint(Math.max(0, s - 25));
      const f = new V(a.x - b.x, 0, a.z - b.z).normalize();
      const yaw = (shot.yaw * (this.dir > 0 ? 1 : -0.4) + (this.dir > 0 ? 0 : 150) + this.yawOffset + Math.sin(t * 0.05) * 6) * RAD;
      const pitch = Math.max(-8, Math.min(70, shot.pitch + (flying ? 10 : 0) + this.pitchOffset)) * RAD;
      const dist = shot.dist * this.zoom * wide;
      const back = f.clone().applyAxisAngle(new V(0, 1, 0), yaw).multiplyScalar(-1);
      const base = this.routePoint(s);
      look.copy(base).add(new V(0, 1.3 + dist * 0.2, 0)).addScaledVector(f, flying ? 60 : 3 * this.dir);
      want.copy(base).addScaledVector(back, dist * Math.cos(pitch)).add(new V(0, 1.3 + dist * Math.sin(pitch), 0));
    }
    // never under the snow, and never with the mountain between lens and climber
    for (let pass = 0; pass < 6; pass++) {
      let blocked = false;
      const floor = Math.max(this.ground(want.x, want.z), this.inner.surface(want.x, want.z)) + 3.5;
      if (want.y < floor) want.y = floor;
      for (let i = 1; i < 8; i++) {
        const k = i / 8;
        const x = want.x + (look.x - want.x) * k;
        const z = want.z + (look.z - want.z) * k;
        const y = want.y + (look.y - want.y) * k;
        if (this.inner.surface(x, z) > y - 1.5) blocked = true;
      }
      if (!blocked) break;
      want.y += 6 + pass * 6;
    }
    const lerp = this.first ? 1 : 1 - Math.exp(-dt * (flying ? 2.2 : 0.9));
    this.camPos.lerp(want, lerp);
    this.camTarget.lerp(look, this.first ? 1 : 1 - Math.exp(-dt * 3));
    this.first = false;
    const floor = Math.max(this.ground(this.camPos.x, this.camPos.z), this.inner.surface(this.camPos.x, this.camPos.z)) + 2.5;
    if (this.camPos.y < floor) this.camPos.y = floor;
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      const k = this.shake * 0.5;
      this.camera.position.x += Math.sin(t * 31) * k;
      this.camera.position.y += Math.sin(t * 27 + 1) * k;
    }
    this.camera.lookAt(this.camTarget);
    // a little breath in the frame
    this.camera.rotateZ(Math.sin(t * 0.7) * 0.004 * (2 - this.clarity));
    this.camera.updateMatrixWorld();

    // ---- weather to uniforms ----
    const storm = Math.max(0, Math.min(1, (w.storm - 1) / 1.6));
    const noonRise = THREE.MathUtils.smoothstep(w.hour, 10, 15) * (1 - THREE.MathUtils.smoothstep(w.hour, 18, 21));
    const topWant = 4650 + 750 * noonRise + storm * 5200;
    const covWant = 0.44 - 0.06 * noonRise - storm * 0.3;
    const k = 1 - Math.exp(-dt * 0.35);
    this.cloudTop += (topWant - this.cloudTop) * k;
    this.coverage += (covWant - this.coverage) * k;
    this.u.uHaze.value += (1 + storm * 16 - this.u.uHaze.value) * k;
    for (const m of this.terrainMats) m.uniforms.uSnowfall!.value = storm * 0.5;
    this.patchMat.uniforms.uIce!.value = kind === "icefall" || kind === "cwm" || kind === "face" ? 1 : 0;

    const windDir = new V(0.95, 0.02, 0.3).normalize();
    const ms = w.wind / 3.6;
    this.snowMat.uniforms.uTime!.value = t;
    this.snowMat.uniforms.uCentre!.value.copy(cp);
    this.snowMat.uniforms.uWind!.value.copy(windDir).multiplyScalar(4 + ms * 1.1);
    this.snowMat.uniforms.uAmount!.value = Math.min(1, 0.05 + w.wind / 75 + storm * 0.6);
    const sc = this.u.uSunColor.value;
    const amb = this.u.uAmbient.value;
    const tint = new V(sc.x * 0.22 + amb.x * 1.6, sc.y * 0.22 + amb.y * 1.6, sc.z * 0.22 + amb.z * 1.6);
    this.snowMat.uniforms.uTint!.value.copy(tint);
    this.plumeMat.uniforms.uTint!.value.copy(tint).multiplyScalar(0.8);
    this.plumeMat.uniforms.uTime!.value = t;
    this.plumeMat.uniforms.uWind!.value.copy(windDir).multiplyScalar(6 + w.summitWind / 3.6 * 0.6);
    this.plumeMat.uniforms.uAmount!.value = THREE.MathUtils.smoothstep(w.summitWind, 30, 110) * (1 - storm * 0.5);

    // headlamps
    const dark = 1 - THREE.MathUtils.smoothstep(this.sunElevation, -8, 2);
    this.lampMat.uniforms.uTime!.value = t;
    this.lampMat.uniforms.uAmount!.value = dark * 0.9;
    this.lampMat.uniforms.uOthers!.value = this.nightLamps;
    const lampOn = dark > 0.05 && !flying;
    const fwd = this.routePoint(Math.min(ROUTE_LENGTH, Math.max(0, s + 6 * this.dir)));
    for (const m of this.terrainMats) m.uniforms.uLamp!.value.set(fwd.x, fwd.y + 2.2, fwd.z, lampOn ? 0.9 * dark : 0);
    // your own two lamps are the first two points
    const la = this.lamps.geometry.attributes.position as THREE.BufferAttribute;
    la.setXYZ(0, cp.x, cp.y + 1.75, cp.z);
    la.setXYZ(1, this.partner.position.x, this.partner.position.y + 1.75, this.partner.position.z);
    la.needsUpdate = true;
    const tentGlow = dark * 0.05;
    (this.tentMat.uniforms.uEmissive!.value as THREE.Color).setRGB(tentGlow, tentGlow * 0.62, tentGlow * 0.18);
    (this.routeLine.material as THREE.LineBasicMaterial).color.setScalar(0.12 + sc.length() * 0.5);
    (this.routeLine.material as THREE.LineBasicMaterial).opacity = flying ? 0.5 : 0.2;

    // ---- draw ----
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(this.scene, this.camera);
    const pu = this.post.uniforms;
    pu.uInvProj!.value.copy(this.camera.projectionMatrixInverse);
    pu.uCamWorld!.value.copy(this.camera.matrixWorld);
    pu.uCamPos!.value.copy(this.camera.position);
    pu.uTime!.value = t;
    pu.uCloudTop!.value = this.cloudTop;
    pu.uCoverage!.value = this.coverage;
    pu.uCloudWind!.value.set(t * 0.0022 * (1 + storm * 3), t * 0.0004, t * 0.0007);
    pu.uExposure!.value += (this.exposure - pu.uExposure!.value) * (1 - Math.exp(-dt * 2));
    pu.uClarity!.value += (this.clarity - pu.uClarity!.value) * (1 - Math.exp(-dt * 1.5));
    pu.uCold!.value += (this.cold - pu.uCold!.value) * (1 - Math.exp(-dt));
    pu.uFade!.value = this.fade;
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);

    // hold sixty frames a second by giving up pixels before anything else
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    if (this.frameMs > 21) this.slowFrames++;
    else this.slowFrames = 0;
    if (this.frameMs < 17.5) this.fastFrames++;
    else this.fastFrames = 0;
    if (this.slowFrames > 45 && this.scale > 0.55) {
      this.scale = Math.max(0.55, this.scale * 0.85);
      this.slowFrames = 0;
      this.resize();
    } else if (this.fastFrames > 600 && this.scale < this.maxScale) {
      this.scale = Math.min(this.maxScale, this.scale * 1.1);
      this.fastFrames = 0;
      this.resize();
    }
  }

  get pixelScale(): number {
    return this.scale;
  }
  get cloudTopNow(): number {
    return this.cloudTop;
  }
}
