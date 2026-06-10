/* ORPHIC scene — MURMURATION · dusk flock
 * 65k starlings over an aurora dusk. Boids without neighbor lists: every frame
 * the flock splats velocity + density into a field texture, and each bird steers
 * from that field — alignment (local mean velocity) and cohesion (up the coarse
 * density gradient) form a density-INDEPENDENT cohesive backbone, the way real
 * starlings stay whole through huge density swings by coupling to a fixed count
 * of neighbours (Ballerini/STARFLAG, topological not metric). O(n), no spatial
 * hashing, weak-GPU friendly.
 *
 * The murmuration LOOK comes from a curl-noise (divergence-free) turbulence
 * field laid over the boids: it stretches the flock into rolling ribbons and
 * sheets without ever tearing it apart, because curl flow preserves area.
 *
 * Audio drives ENERGY, never fragmentation: loudness sets flight tempo, level
 * rides the curl amplitude (more turbulence), and beats radiate agitation waves
 * — expanding rings of synchronised roll ("zig" manoeuvres) that sweep outward
 * and read as dark bands, the real optical signature of a murmuration (the dark
 * wave is an orientation effect, not a density effect — Hemelrijk/StarDisplay).
 * Only the hawk, launched on occasional onsets, truly scatters the flock; it
 * always re-coheres. Every bird is also keyed to one spectrum slice for shimmer.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const DIM = 256;          // 65,536 birds
  const FIELD = 128;        // neighborhood field resolution
  const WAVE_SPEED = 1.15;  // agitation wave front speed (UV/s, faster than flock)
  const MAX_WAVES = 4;

  const INIT_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform float uSeed;
  void main() {
    vec2 h = hash22(gl_FragCoord.xy + uSeed);
    vec2 h2 = hash22(gl_FragCoord.yx * 2.3 + uSeed + 17.0);
    float ang = h.x * 6.28318;
    vec2 pos = vec2(0.5, 0.55) + vec2(cos(ang), sin(ang)) * (0.04 + 0.16 * h.y);
    vec2 vel = vec2(cos(ang + 1.8), sin(ang + 1.8)) * 0.09;
    fragColor = vec4(pos, vel * (0.7 + 0.6 * h2.x));
  }`;

  // splat each bird's velocity + presence into the field (additive points)
  const FIELD_VERT = `#version 300 es
  precision highp float;
  uniform sampler2D uAgents;
  uniform int uDim;
  out vec2 vVel;
  void main() {
    ivec2 tc = ivec2(gl_VertexID % uDim, gl_VertexID / uDim);
    vec4 a = texelFetch(uAgents, tc, 0);
    vVel = a.zw;
    gl_Position = vec4(a.xy * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 5.0;
  }`;
  const FIELD_FRAG = `#version 300 es
  precision highp float;
  in vec2 vVel;
  out vec4 fragColor;
  void main() {
    // scaled so a fully packed flock reads ~30, a spread one ~4 — the
    // separation ramp depends on this calibration
    float w = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * 0.125;
    fragColor = vec4(vVel * w, w, 0.0);
  }`;

  // divergence-free curl-noise flow from a scrolling scalar potential. Because
  // it has zero divergence it swirls the flock into ribbons/sheets without
  // diverging it — coherent turbulence, the heart of the murmuration look.
  const CURL_GLSL = `
  float psi(vec2 p) { return vnoise(p) + 0.5 * vnoise(p * 2.1 + 7.3); }
  vec2 curl(vec2 p) {
    float e = 0.012;
    float dy = psi(p + vec2(0.0, e)) - psi(p - vec2(0.0, e));
    float dx = psi(p + vec2(e, 0.0)) - psi(p - vec2(e, 0.0));
    return vec2(dy, -dx) / (2.0 * e);
  }`;

  const UPDATE_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + M.GLSL_SPECTRUM + CURL_GLSL + `
  uniform sampler2D uAgents, uField;
  uniform float uAspect, uDt;
  uniform vec2 uRoost;
  uniform vec3 uPredator; // xy pos, z = active

  void main() {
    vec4 a = texelFetch(uAgents, ivec2(gl_FragCoord.xy), 0);
    vec2 pos = a.xy, vel = a.zw;
    vec2 h = hash22(gl_FragCoord.xy);

    vec4 f = texture(uField, pos);
    float dens = f.z;
    vec2 avgVel = f.xy / max(dens, 0.5);

    // density gradients: coarse for cohesion, fine for separation
    float rc = 3.0 / ${FIELD}.0, rf = 1.3 / ${FIELD}.0;
    vec2 gC = vec2(texture(uField, pos + vec2(rc, 0)).z - texture(uField, pos - vec2(rc, 0)).z,
                   texture(uField, pos + vec2(0, rc)).z - texture(uField, pos - vec2(0, rc)).z)
              / (dens + 2.0);
    vec2 gF = vec2(texture(uField, pos + vec2(rf, 0)).z - texture(uField, pos - vec2(rf, 0)).z,
                   texture(uField, pos + vec2(0, rf)).z - texture(uField, pos - vec2(0, rf)).z)
              / (dens * 0.25 + 2.0);

    // Topological backbone: alignment + cohesion are CONSTANT and density-
    // independent — never weakened by audio — and DOMINANT, so the flock stays
    // one living body through every loud passage. Separation is a gentle
    // constant that only bites in true clumps. (Audio used to quadruple
    // separation and kick the cloud outward, which detonated it.)
    // Topological backbone: alignment dominates (coherent, sheet-like motion);
    // cohesion just keeps the body connected; separation gives the flock VOLUME
    // so it fills a region instead of collapsing to a knot. All density-
    // independent and never weakened by audio — the flock stays one living body
    // through every loud passage. (Audio used to quadruple separation and kick
    // the cloud outward, which detonated it.)
    float wAlign = 2.6;
    float wCoh   = 1.4;
    float wSep   = 1.3;

    vec2 acc = (avgVel - vel) * wAlign
             + gC * wCoh
             - gF * wSep * smoothstep(5.0, 20.0, dens);

    // curl turbulence — the music's ENERGY: louder = more turbulent rolling
    // motion; bass widens the swirls. Kept LOW-amplitude and small-eddy so it
    // only ripples the surface and shears the interior — it must never be
    // strong enough to pinch a sub-group off into a separate clump.
    // Divergence-free, so it never diverges the flock.
    float cScale = 4.5 - uBass * 1.0;
    vec2 flow = curl(pos * cScale + vec2(uTime * 0.06, uTime * 0.04));
    acc += flow * (0.16 + uLevel * 0.45 + uBeat * 0.20);

    // roost = the GLOBAL binder. An always-on gentle spring to the single flock
    // centre (field cohesion is only LOCAL, so without this the flock splits
    // into separate clumps each pulled to its own centre). Separation keeps the
    // spring from collapsing it to a knot, so it settles at a healthy radius;
    // the steep outer ramp snaps any stray group back so it stays ONE body.
    vec2 toR = uRoost - pos;
    float farR = length(toR);
    acc += toR * (0.7 + 2.4 * smoothstep(0.12, 0.40, farR) + uQuiet * 0.4);

    // hawk strike: the ONLY force that truly scatters the flock
    if (uPredator.z > 0.5) {
      vec2 d = pos - uPredator.xy;
      float dist = max(length(d), 1e-4);
      acc += d / dist * exp(-dist * dist * 60.0) * 5.0;
    }

    // faint per-bird shimmer keyed to its own spectrum slice — different
    // frequencies sparkle through different parts of the cloud
    float bandE = specLog(h.x);
    vec2 jit = hash22(gl_FragCoord.xy + fract(uTime) * 317.0) - 0.5;
    acc += jit * (0.10 + bandE * 0.30 + uTreble * 0.30) * (1.0 - uQuiet * 0.5);

    vel += acc * uDt;

    // starlings never hover: loudness sets the tempo of flight. Energy shows
    // as faster, more turbulent flight — NOT as the cloud blowing apart.
    float spd = max(length(vel), 1e-5);
    float vmax = (0.10 + uLevel * 0.22 + uBeat * 0.05) * (1.0 - uQuiet * 0.4);
    vel *= clamp(spd, 0.05, vmax) / spd;

    pos += vel * vec2(1.0 / uAspect, 1.0) * uDt;
    pos = clamp(pos, -0.05, 1.05);
    fragColor = vec4(pos, vel);
  }`;

  const SKY_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform vec2 uRes;
  uniform float uKeyHue;
  float fbm3(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + 13.7; a *= 0.5; }
    return v;
  }
  void main() {
    float y = vUV.y;
    vec3 warm = pal(uKeyHue + 0.04, vec3(0.42), vec3(0.32), vec3(1.0), vec3(0.0, 0.33, 0.67))
                * (0.55 + uLevel * 0.30);
    vec3 deep = pal(uKeyHue + 0.58, vec3(0.16), vec3(0.12), vec3(1.0), vec3(0.0, 0.33, 0.67))
                * 0.55;
    vec3 sky = mix(warm, deep, pow(y, 0.65));

    // ---- aurora curtains drifting across the upper sky (the dynamism) ----
    // a scrolling sheet broken into vertical rays, shimmering with the music
    float aurMask = smoothstep(0.32, 0.95, y);
    float warp = fbm3(vec2(vUV.x * 2.5 + uTime * 0.04, y * 1.2));
    float sheet = smoothstep(0.42, 0.92, fbm3(vec2(vUV.x * 3.0 + uPhaseLevel * 0.04, y * 2.2 - uTime * 0.03)));
    float rays  = 0.45 + 0.55 * sin(vUV.x * 46.0 + warp * 9.0 + uTime * 0.25);
    float aur = aurMask * sheet * rays;
    vec3 aurCol = mix(pal(uKeyHue + 0.30, vec3(0.45), vec3(0.45), vec3(1.0), vec3(0.0, 0.20, 0.45)),
                      pal(uKeyHue + 0.72, vec3(0.40), vec3(0.45), vec3(1.0), vec3(0.10, 0.40, 0.80)),
                      y);
    sky += aurCol * aur * (0.10 + uLevel * 0.24 + uTreble * 0.20 + uBeat * 0.10);

    // low setting sun: warm core, amber halo, beat pulse
    vec2 sunP = vec2(0.5 + sin(uPhaseLevel * 0.05) * 0.22, 0.115);
    vec2 d = (vUV - sunP) * vec2(uRes.x / uRes.y, 1.35);
    float dd = dot(d, d);
    vec3 sunCol = mix(vec3(1.0, 0.45, 0.22), vec3(1.0, 0.88, 0.62), exp(-dd * 500.0));
    sky += sunCol * (exp(-dd * 300.0) * (1.0 + uBeat * 0.35)
                     + exp(-dd * 22.0) * 0.30 + exp(-dd * 5.0) * 0.10);

    // thin stratus bands near the horizon, drifting, warmed near the sun
    float cl = smoothstep(0.45, 0.8, fbm3(vec2(vUV.x * 3.0 + uPhaseLevel * 0.02, y * 14.0)));
    sky *= 1.0 - cl * 0.18 * (1.0 - y);
    sky += sunCol * cl * exp(-dd * 8.0) * 0.10;

    // twinkling stars, drifting almost imperceptibly with the music's time
    vec2 sp = (vUV + vec2(uPhaseLevel * 0.0015, 0.0)) * uRes / 4.0;
    float sh = hash12(floor(sp));
    float th = hash12(floor(sp) + 17.31); // independent twinkle hash
    float tw = 0.6 + 0.4 * sin(uTime * (0.8 + th * 4.0) + th * 40.0);
    float star = step(0.9965, sh)
               * smoothstep(0.5, 0.1, length(fract(sp) - 0.5)) * tw;
    sky += vec3(0.85, 0.9, 1.0) * star * smoothstep(0.45, 0.85, y)
           * (0.45 + uTreble * 0.35);

    // dark treeline anchoring the horizon, rim-lit toward the sun
    float ridge = 0.105 + 0.04 * fbm3(vec2(vUV.x * 5.5, 0.7));
    float ground = smoothstep(ridge + 0.006, ridge - 0.006, y);
    vec3 groundCol = vec3(0.012, 0.014, 0.022)
                   + sunCol * exp(-abs(vUV.x - sunP.x) * 4.0) * 0.05;
    sky = mix(sky, groundCol, ground);

    float v = length(vUV - 0.5);
    sky *= 1.0 - v * v * 0.55;
    // dither kills 8-bit gradient banding
    sky += (hash12(vUV * uRes) - 0.5) / 128.0;
    fragColor = vec4(aces(sky), 1.0);
  }`;

  // each bird presents a roll-dependent wing area to the camera. Banking from
  // the flow it rides + synchronised "zig" rolls from passing agitation waves
  // turn the bird broadside, darkening and enlarging it — so a dark band sweeps
  // outward through the flock. This is the real optical murmuration wave.
  const DRAW_VERT = `#version 300 es
  precision highp float;
  uniform sampler2D uAgents;
  uniform int uDim;
  uniform float uTime, uPointScale, uBass, uAspect, uLevel;
  uniform float uWaves[${MAX_WAVES * 4}]; // x, y, radius, amp per wave
  out float vAlpha;
  out vec3 vColor;
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), fr = fract(p);
    vec2 u = fr * fr * (3.0 - 2.0 * fr);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
               mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  ${CURL_GLSL}
  void main() {
    ivec2 tc = ivec2(gl_VertexID % uDim, gl_VertexID / uDim);
    vec4 a = texelFetch(uAgents, tc, 0);
    vec2 pos = a.xy, vel = a.zw;
    vec2 hh = hash22(vec2(tc) * 1.7 + 3.1);
    float depth = hh.x; // pseudo-depth: distant birds smaller + hazier

    // banking: roll proportional to how hard the bird is turning in the flow
    vec2 fl = curl(pos * (5.0 - uBass * 1.2) + vec2(uTime * 0.06, uTime * 0.04));
    vec2 vdir = normalize(vel + 1e-5);
    float turn = fl.x * (-vdir.y) + fl.y * vdir.x; // flow component across heading
    float bank = abs(tanh(turn * 0.55));

    // agitation waves: expanding rings of synchronised roll → dark bands
    float waveRoll = 0.0;
    for (int i = 0; i < ${MAX_WAVES}; i++) {
      float amp = uWaves[i * 4 + 3];
      if (amp <= 0.0) continue;
      vec2 o = vec2(uWaves[i * 4 + 0], uWaves[i * 4 + 1]);
      float R = uWaves[i * 4 + 2];
      float x = (length((pos - o) * vec2(uAspect, 1.0)) - R) / 0.055;
      waveRoll += amp * exp(-x * x);
    }

    // broadside amount 0..1 — how much wing the bird shows the camera
    float broad = clamp(bank * 0.7 + waveRoll, 0.0, 1.0);

    // wing-beat flicker
    float wing = 0.78 + 0.32 * sin(uTime * (7.0 + hh.y * 6.0) + hh.y * 40.0);
    gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = mix(2.1, 4.0, depth) * wing * uPointScale * (0.72 + broad * 1.0);
    vAlpha = mix(0.7, 1.0, depth) * (0.72 + broad * 0.42);
    // silhouettes; broadside birds read darker (full wing), edge-on lift to haze
    vec3 near = mix(vec3(0.17, 0.15, 0.23), vec3(0.015, 0.018, 0.035), broad);
    vColor = mix(near, vec3(0.020, 0.026, 0.052), depth);
  }`;
  const DRAW_FRAG = `#version 300 es
  precision highp float;
  in float vAlpha;
  in vec3 vColor;
  out vec4 fragColor;
  void main() {
    float a = smoothstep(0.5, 0.22, length(gl_PointCoord - 0.5)) * vAlpha;
    fragColor = vec4(vColor, a);
  }`;

  // the hawk: one big point sprite carrying a procedural raptor silhouette
  const HAWK_VERT = `#version 300 es
  precision highp float;
  uniform vec2 uPos;
  uniform float uSize;
  void main() {
    gl_Position = vec4(uPos * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = uSize;
  }`;
  const HAWK_FRAG = `#version 300 es
  precision highp float;
  uniform float uAngle, uTime, uFlapHz, uFlapAmp, uAlpha, uGlow;
  uniform vec3 uRimCol;
  out vec4 fragColor;
  float sdSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  void main() {
    vec2 q = (gl_PointCoord - 0.5) * 2.0;
    q.y = -q.y; // point-coord y runs downward
    float cs = cos(uAngle), sn = sin(uAngle);
    q = mat2(cs, sn, -sn, cs) * q; // into hawk frame, +x = travel
    // beating swept wings + body + fork tail; the kick powers the stroke
    float flap = sin(uTime * uFlapHz);
    float span = 0.42 + uFlapAmp * flap;
    float wing1 = sdSeg(q, vec2(0.12, 0.0), vec2(-0.38,  span)) - 0.050;
    float wing2 = sdSeg(q, vec2(0.12, 0.0), vec2(-0.38, -span)) - 0.050;
    float body = sdSeg(q, vec2(0.52, 0.0), vec2(-0.30, 0.0)) - 0.070;
    float tail = sdSeg(q, vec2(-0.28, 0.0), vec2(-0.52, 0.10 * flap)) - 0.040;
    float dd = min(min(wing1, wing2), min(body, tail));
    // dark raptor core with a burning sun-lit rim
    float core = smoothstep(0.025, -0.025, dd);
    float rim = smoothstep(0.11, 0.0, abs(dd)) * (1.0 - core * 0.5);
    vec3 col = mix(vec3(0.012, 0.010, 0.022), uRimCol * (0.8 + uGlow), rim);
    float a = max(core, rim * 0.85) * uAlpha;
    fragColor = vec4(col, a);
  }`;

  // glowing wake the hawk drags behind it
  const TRAIL_FRAG = `#version 300 es
  precision highp float;
  uniform vec3 uCol;
  uniform float uA;
  out vec4 fragColor;
  void main() {
    float fall = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
    fragColor = vec4(uCol * fall * fall * uA, 1.0);
  }`;

  M.registerScene({
    name: 'murmuration · dusk flock',
    modes: ['music', 'ambient'],
    create(glc) {
      const gl = glc.gl;
      const agents = glc.pingpong(DIM, DIM, { nearest: true });
      const field = glc.target(FIELD, FIELD);
      const pInit = glc.program(INIT_FRAG);
      const pField = glc.program(FIELD_FRAG, FIELD_VERT);
      const pUpdate = glc.program(UPDATE_FRAG);
      const pSky = glc.program(SKY_FRAG);
      const pDraw = glc.program(DRAW_FRAG, DRAW_VERT);
      const pHawk = glc.program(HAWK_FRAG, HAWK_VERT);
      const pTrail = glc.program(TRAIL_FRAG, HAWK_VERT);
      const trail = []; // fading wake samples
      let trailTimer = 0;
      const vao = gl.createVertexArray();
      let keyHue = 0.08;
      const pred = { x: 0, y: 0, vx: 0, vy: 0, t: 0 };
      // the roost leaps to a new spot on musical events; the flock chases it
      const roost = { x: 0.5, y: 0.55, tx: 0.5, ty: 0.55, side: 1 };
      let leapBeats = 0, leapLatch = 0;
      // agitation waves: rendering-only rings of synchronised roll
      const waves = [];
      const waveBuf = new Float32Array(MAX_WAVES * 4);
      let waveLatch = 0;
      function spawnWave(x, y, t) {
        waves.push({ x, y, t0: t });
        if (waves.length > MAX_WAVES) waves.shift();
      }

      pInit.use().f('uSeed', Math.random() * 100);
      glc.draw(pInit, agents.read);

      return {
        resize() {},
        update(dt, audio, t) {
          const f = audio.f;
          keyHue = M.chromaHue(f.chroma, keyHue, dt);

          // hawk: occasional strikes, not every onset — scatters must stay
          // the exception or the flock never re-forms
          pred.t -= dt;
          if (f.onset === 1 && pred.t < -3.5) {
            const ang = Math.random() * Math.PI * 2;
            pred.x = 0.5 + Math.cos(ang) * 0.55;
            pred.y = 0.55 + Math.sin(ang) * 0.45;
            const aim = Math.atan2(0.55 - pred.y + (Math.random() - 0.5) * 0.3,
                                   0.5 - pred.x + (Math.random() - 0.5) * 0.3);
            const spd = 0.55 + Math.random() * 0.25;
            pred.vx = Math.cos(aim) * spd;
            pred.vy = Math.sin(aim) * spd;
            pred.t = 1.8;
            spawnWave(pred.x, pred.y, t); // the flock's alarm ripples outward
          }

          // roost leaps every 2 beats (alternating sides of the sky), so the
          // flock swoops in rhythm — bright music flies high, dark flies low.
          // Wider arcs than before so the compact flock sweeps through the
          // negative space instead of sitting centred.
          leapLatch -= dt;
          if (f.beat > 0.9 && leapLatch <= 0) {
            leapLatch = 0.25;
            if (++leapBeats >= 2) {
              leapBeats = 0;
              roost.side = -roost.side;
              roost.tx = 0.5 + roost.side * (0.12 + Math.random() * 0.10 + f.level * 0.05);
              roost.ty = 0.38 + f.centroid * 0.30 + Math.random() * 0.10;
            }
          }
          // gentle ambient wander when there is no beat to chase
          if (f.beatConf < 0.15) {
            roost.tx = 0.5 + Math.sin(f.phaseLevel * 0.11) * 0.18;
            roost.ty = 0.55 + Math.sin(f.phaseLevel * 0.083 + 1.9) * 0.14;
          }
          const rk = 1 - Math.exp(-dt * 1.6);
          roost.x += (roost.tx - roost.x) * rk;
          roost.y += (roost.ty - roost.y) * rk;

          // beat rising edge radiates an agitation wave through the flock —
          // a sweep of roll (dark band), NOT an outward shove. Throttled so
          // the bands stay distinct.
          const beatNow = f.beat > 0.9;
          waveLatch -= dt;
          if (beatNow && !this._beatHeld && f.level > 0.12 && waveLatch <= 0) {
            spawnWave(roost.x, roost.y, t);
            waveLatch = 0.30;
          }
          this._beatHeld = beatNow;

          // age out spent waves
          for (let i = waves.length - 1; i >= 0; i--) {
            if ((t - waves[i].t0) * WAVE_SPEED > 1.5) waves.splice(i, 1);
          }

          const roostX0 = roost.x, roostY0 = roost.y;
          if (pred.t > 0) {
            // banked pursuit: curve toward the flock, dive speed on loudness
            const ax = roostX0 - pred.x, ay = roostY0 - pred.y;
            const al = Math.hypot(ax, ay) + 1e-4;
            pred.vx += (ax / al) * dt * 0.45;
            pred.vy += (ay / al) * dt * 0.45;
            const sp = Math.hypot(pred.vx, pred.vy) + 1e-4;
            const want = 0.50 + 0.40 * f.level;
            pred.vx *= want / sp; pred.vy *= want / sp;
            pred.x += pred.vx * dt; pred.y += pred.vy * dt;
            trailTimer += dt;
            if (trailTimer > 0.03) {
              trailTimer = 0;
              trail.push({ x: pred.x, y: pred.y, life: 1 });
              if (trail.length > 16) trail.shift();
            }
          }
          for (let i = trail.length - 1; i >= 0; i--) {
            trail[i].life -= dt * 1.8;
            if (trail[i].life <= 0) trail.splice(i, 1);
          }

          // 1. splat the flock into the neighborhood field
          field.clear();
          gl.bindFramebuffer(gl.FRAMEBUFFER, field.fbo);
          gl.viewport(0, 0, field.w, field.h);
          gl.useProgram(pField.handle);
          pField._pendingTex.length = 0;
          pField.i('uDim', DIM).tex('uAgents', agents.read.tex, 0);
          pField._bindPending();
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.bindVertexArray(vao);
          gl.drawArrays(gl.POINTS, 0, DIM * DIM);
          gl.disable(gl.BLEND);

          // 2. steer + advance every bird
          pUpdate.use();
          M.audioUniforms(pUpdate, audio, t);
          M.spectrumUniforms(pUpdate, audio, 2);
          pUpdate.f('uAspect', glc.width / glc.height)
                 .f('uDt', Math.min(dt, 0.033))
                 .v2('uRoost', roostX0, roostY0)
                 .v3('uPredator', pred.x, pred.y, pred.t > 0 ? 1 : 0)
                 .tex('uAgents', agents.read.tex, 0)
                 .tex('uField', field.tex, 1);
          glc.draw(pUpdate, agents.write);
          agents.swap();
        },
        render(out, audio, t) {
          pSky.use().v2('uRes', glc.width, glc.height).f('uKeyHue', keyHue);
          M.audioUniforms(pSky, audio, t);
          glc.draw(pSky, out);

          // pack current agitation-wave fronts for the draw shader
          waveBuf.fill(0);
          for (let i = 0; i < waves.length && i < MAX_WAVES; i++) {
            const r = (t - waves[i].t0) * WAVE_SPEED;
            const amp = Math.max(0, 1 - r / 1.3); // damping: roll fades with distance
            waveBuf[i * 4] = waves[i].x;
            waveBuf[i * 4 + 1] = waves[i].y;
            waveBuf[i * 4 + 2] = r;
            waveBuf[i * 4 + 3] = amp;
          }

          const f = audio.f;
          // honor `out` like glc.draw does — transitions render scenes offscreen
          gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
          gl.viewport(0, 0, out ? out.w : glc.width, out ? out.h : glc.height);
          gl.useProgram(pDraw.handle);
          pDraw._pendingTex.length = 0;
          pDraw.i('uDim', DIM).f('uTime', t)
               .f('uPointScale', Math.min(window.devicePixelRatio || 1, 2))
               .f('uBass', f.bass).f('uLevel', f.level)
               .f('uAspect', glc.width / glc.height)
               .fv('uWaves', waveBuf)
               .tex('uAgents', agents.read.tex, 0);
          pDraw._bindPending();
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.bindVertexArray(vao);
          gl.drawArrays(gl.POINTS, 0, DIM * DIM);

          // the hawk's glowing wake (additive), intensity riding the level
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const ember = [1.0, 0.55, 0.28];
          if (trail.length) {
            gl.blendFunc(gl.ONE, gl.ONE);
            gl.useProgram(pTrail.handle);
            pTrail._pendingTex.length = 0;
            for (const s of trail) {
              pTrail.v2('uPos', s.x, s.y)
                    .f('uSize', (4 + s.life * 12) * dpr)
                    .v3('uCol', ember[0], ember[1], ember[2])
                    .f('uA', s.life * s.life * (0.10 + f.level * 0.30 + f.beat * 0.20));
              pTrail._bindPending();
              gl.drawArrays(gl.POINTS, 0, 1);
            }
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          }

          // the hawk itself: kick powers the wing stroke, beats flare the rim
          if (pred.t > 0) {
            const age = 1.8 - pred.t;
            const alpha = Math.min(1, age / 0.15) * Math.min(1, pred.t / 0.3);
            const aspect = glc.width / glc.height;
            gl.useProgram(pHawk.handle);
            pHawk._pendingTex.length = 0;
            pHawk.v2('uPos', pred.x, pred.y)
                 .f('uSize', (30 + f.bassFast * 14) * dpr)
                 .f('uAngle', Math.atan2(pred.vy, pred.vx * aspect))
                 .f('uTime', t)
                 .f('uFlapHz', 8 + f.treble * 10)
                 .f('uFlapAmp', 0.18 + f.bassFast * 0.34 + f.level * 0.10)
                 .f('uGlow', f.beat * 1.4 + f.onset * 0.6)
                 .v3('uRimCol', ember[0], ember[1], ember[2])
                 .f('uAlpha', alpha * 0.95);
            pHawk._bindPending();
            gl.drawArrays(gl.POINTS, 0, 1);
          }
          gl.disable(gl.BLEND);
        },
        dispose() {
          agents.dispose();
          field.dispose();
          gl.deleteVertexArray(vao);
        },
      };
    },
  });
})();
