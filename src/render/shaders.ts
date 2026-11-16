// GLSL for the mountain, the air above it, the cloud below it and the snow in the wind.

/** Sky radiance along a direction. Single scattering, tuned by eye against photographs. */
export const SKY = /* glsl */ `
uniform vec3 uSun;        // unit vector to the sun
uniform vec3 uSunColor;   // sunlight reaching this height
uniform vec3 uSkySun;     // the same, less reddened: what lights the sky
uniform vec3 uGlow;       // twilight colour on the sunward horizon
uniform vec3 uNight;      // what is left when the sun is gone
uniform float uDensity;   // air density here relative to sea level
const vec3 BETA = vec3(5.8e-3, 13.5e-3, 33.1e-3);
vec3 skyColor(vec3 d) {
  float mu = dot(d, uSun);
  float h = max(d.y, -0.02);
  float am = 1.0 / (h + 0.085);
  vec3 ext = exp(-BETA * 8.0 * uDensity * am);
  float pr = 0.75 * (1.0 + mu * mu);
  vec3 col = uSkySun * (1.0 - ext) * pr * 1.75;
  float m = max(mu, 0.0);
  col += uSunColor * (1.0 - ext.r) * (pow(m, 6.0) * 0.9 + pow(m, 90.0) * 6.0);
  float low = pow(clamp(1.0 - h * 2.6, 0.0, 1.0), 3.0);
  vec2 dh = normalize(d.xz + 1e-5);
  vec2 sh = normalize(uSun.xz + 1e-5);
  float toward = 0.5 + 0.5 * dot(dh, sh);
  col += uGlow * low * (0.12 + 0.88 * toward * toward * toward);
  col += uNight * (0.6 + 0.4 * low);
  return col;
}
`;

export const FOG = /* glsl */ `
uniform float uHaze;
vec3 applyFog(vec3 col, vec3 world, vec3 cam) {
  vec3 v = world - cam;
  float dist = length(v);
  vec3 d = v / max(dist, 1.0);
  float f = 1.0 - exp(-dist * 1.5e-5 * uHaze);
  vec3 air = skyColor(normalize(vec3(d.x, abs(d.y) * 0.5 + 0.03, d.z)));
  return mix(col, air, f);
}
`;

export const TERRAIN_VERT = /* glsl */ `
attribute float aDetail;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vDetail;
void main() {
  vWorld = position;
  vNormal = normal;
  vDetail = aDetail;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

export const TERRAIN_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vDetail;
uniform sampler2D uNormalTex;
uniform sampler2D uShadowTex;
uniform sampler2D uNoiseTex;
uniform vec4 uRect;       // x0, z0, 1/width, 1/depth of the textures
uniform float uMode;      // 0 mountain, 1 close ground, 2 far horizon
uniform vec4 uPatch;      // centre x, z, half size, on
uniform vec4 uInner;      // x0, z0, x1, z1 of the fine grid (the far mesh leaves it out)
uniform vec3 uAmbient;
uniform vec4 uLamp;       // headlamp position and strength
uniform float uSnowfall;  // fresh snow on everything
uniform float uIce;       // close ground that is glacier, not rock
${SKY}
${FOG}
void main() {
  vec2 p = vWorld.xz;
  if (uMode < 0.5 && uPatch.w > 0.5) {
    vec2 q = abs(p - uPatch.xy);
    if (max(q.x, q.y) < uPatch.z - 5.0) discard;
  }
  if (uMode > 1.5 && p.x > uInner.x && p.x < uInner.z && p.y > uInner.y && p.y < uInner.w) discard;

  vec2 uv = (p - uRect.xy) * uRect.zw;
  vec4 nt = texture2D(uNormalTex, uv);
  vec3 n;
  n.xz = nt.rg * 2.0 - 1.0;
  n.y = sqrt(max(0.0, 1.0 - dot(n.xz, n.xz)));
  float open = nt.b;
  if (uMode > 0.5 && uMode < 1.5) n = normalize(vNormal);
  float shadow = texture2D(uShadowTex, uv).r;

  float dist = length(vWorld - cameraPosition);
  vec4 big = texture2D(uNoiseTex, p / 1400.0);
  vec4 mid = texture2D(uNoiseTex, p / 190.0);
  vec4 fine = texture2D(uNoiseTex, p / 23.0);
  float nearK = 1.0 - smoothstep(150.0, 900.0, dist);
  float midK = 1.0 - smoothstep(2500.0, 9000.0, dist);

  float alt = vWorld.y;
  float slope = 1.0 - n.y;
  float breakup = big.r * 0.55 + mid.r * 0.45;
  float line = mix(0.11, 0.37, smoothstep(5000.0, 6700.0, alt)) + uSnowfall * 0.2;
  // rock lies in beds; snow sits on the ledges between them
  float bed = alt / 26.0 + big.r * 5.0 + mid.r * 1.2;
  float strata = 0.5 + 0.5 * sin(bed * 6.2832);
  float thin = 0.5 + 0.5 * sin(bed * 6.2832 * 4.3 + mid.a * 5.0);
  float strataK = (1.0 - smoothstep(1200.0, 4200.0, dist)) * smoothstep(40.0, 260.0, dist);
  float crisp = (mid.a - 0.5) * 0.1 + (fine.r - 0.5) * 0.09 * nearK;
  float rock = smoothstep(line - 0.025, line + 0.045, slope + (breakup - 0.5) * 0.24 + crisp + (strata - 0.5) * 0.08 * strataK);
  rock = max(rock, smoothstep(5250.0, 4750.0, alt + (breakup - 0.5) * 700.0) * (1.0 - uSnowfall));
  // wind-scoured crests keep less snow
  rock = max(rock, smoothstep(0.78, 0.95, open) * smoothstep(0.2, 0.34, slope) * 0.8);

  float patchK = step(0.5, uMode) * step(uMode, 1.5);
  float carved = patchK * uIce * smoothstep(0.3, 2.0, abs(vDetail));
  rock *= 1.0 - carved;
  vec3 rockCol = mix(vec3(0.115, 0.1, 0.092), vec3(0.24, 0.215, 0.19), mid.a) * (0.86 + 0.2 * strata * strataK + 0.12 * thin * nearK * strataK);
  float band = smoothstep(130.0, 20.0, abs(alt - (8400.0 - 0.37 * vWorld.z) + (big.a - 0.5) * 90.0));
  band *= smoothstep(5200.0, 3600.0, length(p - vec2(0.0, 600.0)));
  rockCol = mix(rockCol, vec3(0.43, 0.34, 0.2), band * 0.85);
  rockCol = mix(rockCol, vec3(0.105, 0.115, 0.075), smoothstep(4700.0, 4100.0, alt));
  vec3 snowCol = vec3(0.9, 0.93, 0.98);
  // bare glacier ice shows where the close ground is cut deep
  float ice = max(clamp(-vDetail / 7.0, 0.0, 1.0), carved * smoothstep(0.25, 0.6, slope) * 0.75) * patchK;
  snowCol = mix(snowCol, vec3(0.3, 0.56, 0.74), ice);
  vec3 albedo = mix(snowCol, rockCol, rock);

  vec2 g = (mid.gb - 0.5) * midK * 0.9 + (fine.gb - 0.5) * nearK * 1.1;
  vec3 nd = n + vec3(g.x, 0.0, g.y) * mix(0.42, 1.25, rock);
  // flutings: ribs of snow running down steep faces
  vec2 across = normalize(vec2(-n.z, n.x) + 1e-5);
  float rib = sin(dot(p, across) * 0.3 + big.a * 14.0 + mid.r * 2.0);
  nd += vec3(across.x, 0.0, across.y) * rib * 0.3 * smoothstep(0.2, 0.42, slope) * (1.0 - rock) * midK * (1.0 - patchK);
  nd = normalize(nd);

  float ndl = dot(nd, uSun);
  float diff = mix(max(ndl * 0.86 + 0.14, 0.0), max(ndl, 0.0), rock);
  vec3 view = normalize(cameraPosition - vWorld);
  vec3 light = uSunColor * diff * shadow;
  vec3 amb = uAmbient * (0.38 + 0.62 * nd.y) * mix(0.42, 1.0, open) * (1.0 + ice * 1.4);
  // light thrown back up by sunlit snow
  amb += uSunColor * 0.07 * (1.0 - nd.y * 0.5) * mix(0.3, 1.0, shadow);
  vec3 col = albedo * (light + amb);
  float spec = pow(max(dot(reflect(-uSun, nd), view), 0.0), 48.0);
  col += uSunColor * spec * shadow * (1.0 - rock) * (0.16 + ice * 0.5);

  if (uLamp.w > 0.0) {
    vec3 l = uLamp.xyz - vWorld;
    float d2 = dot(l, l);
    float att = uLamp.w / (1.0 + d2 * 0.012);
    col += albedo * vec3(1.0, 0.93, 0.8) * att * max(dot(nd, normalize(l)), 0.25);
  }
  gl_FragColor = vec4(applyFog(col, vWorld, cameraPosition), 1.0);
}
`;

export const LIT_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const LIT_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vN;
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform vec3 uAmbient;
uniform float uShade;
${SKY}
${FOG}
void main() {
  vec3 n = normalize(vN);
  float ndl = max(dot(n, uSun) * 0.8 + 0.2, 0.0);
  vec3 col = uColor * (uSunColor * ndl * uShade + uAmbient * (0.6 + 0.4 * n.y)) + uEmissive;
  gl_FragColor = vec4(applyFog(col, vWorld, cameraPosition), 1.0);
}
`;

export const STAR_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aMag;
uniform float uScale;
uniform float uFade;
varying vec3 vColor;
void main() {
  vec4 mv = viewMatrix * vec4(mat3(modelMatrix) * position, 0.0);
  gl_Position = projectionMatrix * vec4(mv.xyz, 1.0);
  gl_Position.z = gl_Position.w * 0.99999;
  float flux = pow(2.512, -aMag);
  vec3 w = normalize(mat3(modelMatrix) * position);
  float air = smoothstep(-0.04, 0.12, w.y);
  vColor = aColor * flux * uFade * air * 5.0;
  gl_PointSize = uScale * clamp(1.4 + 2.2 * sqrt(flux), 1.2, 6.0);
}
`;
export const STAR_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 3.5);
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

/** Spindrift near the climber, and the plume streaming off the high ridges. */
export const SNOW_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCentre;
uniform vec3 uWind;      // metres a second
uniform float uBox;
uniform float uScale;
uniform float uAmount;
uniform vec3 uUp;        // ground normal near the climber
varying float vAlpha;
void main() {
  vec3 drift = uWind * uTime * (0.6 + 0.8 * aSeed.w);
  vec3 p = aSeed.xyz * uBox + drift;
  p.y += sin(uTime * (1.0 + aSeed.w * 2.0) + aSeed.x * 40.0) * 0.6;
  p = mod(p - uCentre + uBox * 0.5, uBox) - uBox * 0.5;
  // keep most of it skimming the slope
  float lift = dot(p, uUp);
  p -= uUp * lift * 0.72;
  vec3 world = uCentre + p + uUp * 0.4;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float edge = 1.0 - smoothstep(0.36, 0.5, length(p) / uBox);
  vAlpha = edge * step(aSeed.w, uAmount) * (0.35 + 0.65 * aSeed.y);
  gl_PointSize = uScale * (0.5 + aSeed.w) * 90.0 / max(1.0, -mv.z);
}
`;
export const SNOW_FRAG = /* glsl */ `
precision highp float;
varying float vAlpha;
uniform vec3 uTint;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.0, 1.0, d)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uTint * a, a);
}
`;

export const PLUME_VERT = /* glsl */ `
attribute vec4 aSeed;     // emitter index, phase, spread, size
attribute vec3 aEmit;
uniform float uTime;
uniform vec3 uWind;
uniform float uScale;
uniform float uAmount;
varying float vAlpha;
void main() {
  float life = 26.0 + aSeed.z * 20.0;
  float age = fract(uTime / life + aSeed.y);
  float t = age * life;
  vec3 w = uWind;
  vec3 side = normalize(vec3(-w.z, 0.0, w.x) + 1e-4);
  vec3 p = aEmit + w * t * 0.75 + side * (aSeed.z - 0.5) * t * 5.0
         + vec3(0.0, 1.0, 0.0) * (sin(aSeed.x * 12.9 + t * 0.2) * 12.0 + t * (aSeed.w - 0.35) * 5.0);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vAlpha = smoothstep(0.0, 0.1, age) * (1.0 - age) * (1.0 - age) * uAmount * 0.09;
  gl_PointSize = min(uScale * (30.0 + t * 14.0) * (0.6 + aSeed.w) * 700.0 / max(300.0, -mv.z), 220.0 * uScale);
}
`;

export const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const POST_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler3D uNoise3;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uCloudTop;
uniform float uCloudBase;
uniform float uCoverage;
uniform vec3 uCloudWind;
uniform vec3 uAmbient;
uniform float uExposure;
uniform float uClarity;   // 1 thinking clearly, 0 not
uniform float uCold;      // 0 warm, 1 freezing
uniform float uFade;      // 0 picture, 1 black
uniform float uGrain;
uniform float uSteps;
uniform float uShake;
${SKY}

float cloudTopAt(vec2 xz) {
  return uCloudTop + (texture(uNoise3, vec3(xz / 11000.0, 0.31) + uCloudWind * 0.4).r - 0.5) * 700.0;
}
float cloudDensity(vec3 p) {
  float top = cloudTopAt(p.xz);
  float hp = smoothstep(top, top - 520.0, p.y) * smoothstep(uCloudBase, uCloudBase + 400.0, p.y);
  if (hp <= 0.0) return 0.0;
  vec3 q = p / vec3(6200.0, 2600.0, 6200.0) + uCloudWind;
  float n = texture(uNoise3, q).r * 0.64 + texture(uNoise3, q * 3.3 + 0.37).r * 0.36;
  float far = smoothstep(24000.0, 36000.0, length(p.xz));
  float cov = mix(uCoverage, 0.12, far);
  return smoothstep(cov, cov + 0.2, n) * hp;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 uv = vUv;
  float depth = texture2D(tDepth, uv).r;
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 vp = uInvProj * ndc;
  vp /= vp.w;
  vec3 dir = normalize((uCamWorld * vec4(normalize(vp.xyz), 0.0)).xyz);
  float dist = depth >= 0.99999 ? 1e9 : length(vp.xyz);
  vec3 col = texture2D(tColor, uv).rgb;
  if (depth >= 0.99999) {
    col += skyColor(dir);
    float mu = dot(dir, uSun);
    col += uSunColor * smoothstep(0.99994, 0.99998, mu) * 25.0 * step(-0.06, dir.y);
  }

  // the cloud sea
  float topMax = uCloudTop + 380.0;
  float t0 = 0.0;
  float t1 = min(dist, 70000.0);
  if (abs(dir.y) > 1e-4) {
    float ta = (uCloudBase - uCamPos.y) / dir.y;
    float tb = (topMax - uCamPos.y) / dir.y;
    t0 = max(t0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  } else if (uCamPos.y > topMax || uCamPos.y < uCloudBase) {
    t1 = -1.0;
  }
  if (t1 > t0) {
    float steps = uSteps;
    float dt = (t1 - t0) / steps;
    float t = t0 + dt * ign(gl_FragCoord.xy + fract(uTime) * 61.0);
    float trans = 1.0;
    vec3 acc = vec3(0.0);
    float mu = dot(dir, uSun);
    float fwd = 1.0 + 1.6 * pow(max(mu, 0.0), 8.0);
    for (float i = 0.0; i < 40.0; i += 1.0) {
      if (i >= steps || trans < 0.02) break;
      vec3 p = uCamPos + dir * t;
      float d = cloudDensity(p);
      if (d > 0.002) {
        float towardSun = cloudDensity(p + uSun * 380.0);
        float lit = exp(-towardSun * 2.6);
        float top = cloudTopAt(p.xz);
        float heightLit = smoothstep(top - 1500.0, top, p.y);
        vec3 c = uSunColor * (0.05 + 0.62 * lit * (0.35 + 0.65 * heightLit)) * fwd + uAmbient * (0.55 + 0.75 * heightLit);
        // distance softens the far sea into the sky
        float f = 1.0 - exp(-t * 1.5e-5);
        c = mix(c, skyColor(normalize(vec3(dir.x, abs(dir.y) * 0.5 + 0.03, dir.z))), f);
        float a = 1.0 - exp(-d * dt * 0.0016);
        acc += trans * a * c;
        trans *= 1.0 - a;
      }
      t += dt;
    }
    col = col * trans + acc;
  }

  col *= uExposure;
  // thin air takes colour and the edges of the picture first
  float r = length((uv - 0.5) * vec2(1.0, 0.82));
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float dull = 1.0 - uClarity;
  col = mix(col, vec3(lum), dull * 0.75);
  col *= 1.0 - dull * smoothstep(0.18, 0.72, r) * 0.92;
  col = aces(col);
  col *= 1.0 - smoothstep(0.35, 0.95, r) * 0.42;
  // rime creeping in from the corners when you are cold
  float rime = uCold * smoothstep(0.52 - uCold * 0.2, 0.86, r + (texture(uNoise3, vec3(uv * 3.0, 0.7)).r - 0.5) * 0.3);
  col = mix(col, vec3(0.82, 0.9, 0.97), rime * 0.72);
  col = pow(col, vec3(1.0 / 2.2));
  col += (ign(gl_FragCoord.xy + fract(uTime * 7.0) * 100.0) - 0.5) * uGrain;
  col *= 1.0 - uFade;
  gl_FragColor = vec4(col, 1.0);
}
`;
