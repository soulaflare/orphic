/* ORPHIC scene — TWO-BODY · warped spacetime
 * A cinematic gravitational system: two heavy bodies in a tight binary, plus a
 * lighter companion and the occasional captured wanderer, all moving under
 * genuine Newtonian gravity (leapfrog + softening). The motion is real — the
 * orbit is the rhythm, not a beat detector — and the masses read physically:
 * softening scales with ∛mass, so a heavy body carves a deep, wide well and a
 * light one only a shallow dimple. The camera dynamically follows the binary's
 * centre (smoothed for a cinematic lag) and slowly orbits it; the grid and the
 * star swarm recenter on that point too, so the action always stays framed and
 * the stars never get lost.
 *
 * The fabric itself is music-static — only gravity warps it (and the warp lives,
 * because the bodies orbit). The music plays through the STARS: each tracer sings
 * a frequency band set by its orbital radius — inner stars ride the bass, outer
 * ones the treble — so the swarm becomes a living spectral halo that twinkles,
 * swells and flares with the sound. The suns also throb (heavy with bass, light
 * with treble, flaring on onsets) without moving off their real orbits. The key
 * tilts a steel-blue/gold palette; a big burst captures a new body. In silence
 * the stars fall quiet and the binary simply keeps orbiting — never static.
 *
 * Inspiration (concept only — Newtonian gravity is public domain, all GLSL our
 * own, no code borrowed): kavan010's "gravity_sim".
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const MAXM = 6;             // a few bodies (2 heavy + companion + transients)
  const DIM_T = 112;          // ~12.5k tracers — a swarm of orbiting spectral stars
  const GSCALE = 1.0;         // gravitational constant (sets the orbital pace)

  // shared world / camera / gravity GLSL — one warped space for grid + tracers.
  const FIELD_LIB = M.GLSL_SPECTRUM + `
  uniform vec4 uMass[${MAXM}];   // xy = plane pos, z = mass, w = softening²
  uniform float uBodyBand[${MAXM}]; // each body's frequency band, 0 = bass .. 1 = treble
  uniform int  uMassN;
  uniform float uDepth, uExtent, uMaxDip;
  uniform vec2 uCenter;          // the followed binary centre (world plane coords)
  uniform vec3 uCamPos, uCamTarget;
  uniform float uFocal, uAspect;

  // index of the body whose well a plane point belongs to (nearest centre)
  int nearestBody(vec2 p) {
    int bi = 0; float bd = 1e20;
    for (int i = 0; i < ${MAXM}; i++) {
      if (i >= uMassN) break;
      vec2 d = p - uMass[i].xy; float dd = dot(d, d);
      if (dd < bd) { bd = dd; bi = i; }
    }
    return bi;
  }

  float potential(vec2 p) {
    float phi = 0.0;
    for (int i = 0; i < ${MAXM}; i++) {
      if (i >= uMassN) break;
      vec2 d = p - uMass[i].xy;
      phi -= uMass[i].z * inversesqrt(dot(d, d) + uMass[i].w);
    }
    return phi;
  }
  float sheetY(vec2 p) { return max(potential(p) * uDepth, -uMaxDip); }

  vec4 project(vec3 wp) {
    vec3 fwd = normalize(uCamTarget - uCamPos);
    vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up  = cross(rgt, fwd);
    vec3 rel = wp - uCamPos;
    float zc = max(dot(rel, fwd), 0.02);
    float xc = dot(rel, rgt), yc = dot(rel, up);
    return vec4(xc * uFocal / uAspect, yc * uFocal, 0.0, zc);
  }`;

  // a distinct, key-tinted colour per frequency band: bass→gold, mid→green/teal,
  // treble→blue/violet. (needs pal from GLSL_COLOR — include after it.)
  const BAND_COLOR = `
  vec3 bandColor(float band, float keyHue) {
    return pal(keyHue * 0.35 + 0.04 + band * 0.52, vec3(0.5), vec3(0.5),
               vec3(1.0), vec3(0.0, 0.25, 0.5));
  }`;

  // ---- the warped fabric (GL_LINES generated from gl_VertexID) ----
  const GRID_VERT = `#version 300 es
  precision highp float;
  ` + M.GLSL_COLOR + M.GLSL_NOISE + BAND_COLOR + FIELD_LIB + `
  uniform int uG;
  uniform float uKeyHue, uRim;
  out vec3 vCol;
  void main() {
    int v = gl_VertexID;
    int seg = v >> 1, end = v & 1;
    int HV = uG * (uG + 1);
    ivec2 gi;
    if (seg < HV) { int row = seg / uG; gi = ivec2(seg - row * uG + end, row); }
    else { int s = seg - HV; int col = s / uG; gi = ivec2(col, s - col * uG + end); }

    // the tile is laid out around the followed centre so the fabric stays framed
    vec2 tile = (vec2(gi) / float(uG) * 2.0 - 1.0) * uExtent;
    vec2 xz = uCenter + tile;
    float r = length(tile);
    float y = sheetY(xz);
    gl_Position = project(vec3(xz.x, y, xz.y));

    // radial fade hides the tile's square edges → fabric melts into the dark
    float fog = smoothstep(uExtent * uRim, uExtent * 0.32, r);

    // a calm, music-static web: only gravity warps it. Cool steel that warms
    // toward each well — tinted by THAT sun's band colour, so the fabric picks
    // up the bodies' colours where they pull on it.
    float well = clamp(-potential(xz) * 0.05, 0.0, 1.5);
    vec3 cool = pal(uKeyHue + 0.58, vec3(0.20, 0.30, 0.42), vec3(0.16, 0.22, 0.30),
                    vec3(1.0), vec3(0.0, 0.15, 0.30));
    vec3 warm = bandColor(uBodyBand[nearestBody(xz)], uKeyHue);
    vec3 c = mix(cool, warm, smoothstep(0.0, 1.0, well));
    c *= (0.30 + well * 1.4);
    vCol = c * fog;
  }`;

  const GRID_FRAG = `#version 300 es
  precision highp float;
  in vec3 vCol; out vec4 fragColor;
  uniform float uBright;
  void main() { fragColor = vec4(vCol * uBright, 1.0); }`;

  // ---- the bodies (one POINT per uMass entry) ----
  const BODY_VERT = `#version 300 es
  precision highp float;
  ` + M.GLSL_COLOR + BAND_COLOR + FIELD_LIB + `
  uniform float uPx, uKeyHue, uOnsetP;
  out vec3 vCol;
  void main() {
    int i = gl_VertexID;
    vec4 mm = uMass[i];
    vec3 wp = vec3(mm.x, sheetY(mm.xy) + 0.04, mm.y);
    vec4 cl = project(wp);
    gl_Position = cl;
    float depth = clamp(7.0 / cl.w, 0.3, 2.4);
    // each sun throbs to ITS OWN frequency band and flares on onsets
    float band = uBodyBand[i];
    float e = specLog(band);
    float react = 1.0 + e * 1.4 + uOnsetP * 0.6;
    gl_PointSize = uPx * (0.5 + sqrt(mm.z) * 3.0) * depth * (0.85 + react * 0.28);
    vec3 col = mix(bandColor(band, uKeyHue), vec3(1.0), clamp(e * 0.7, 0.0, 0.65));
    vCol = col * (0.7 + min(mm.z, 1.4) * 0.7) * react;
  }`;

  // round soft sprite for the tracer stars
  const SPRITE_FRAG = `#version 300 es
  precision highp float;
  in vec3 vCol; out vec4 fragColor;
  uniform float uBright, uFalloff;
  void main() {
    vec2 pc = gl_PointCoord - 0.5;
    float d = length(pc) * 2.0;
    if (d > 1.0) discard;                              // round, no square corners
    float a = exp(-d * d * uFalloff);
    fragColor = vec4(vCol * a * uBright, 1.0);
  }`;

  // a proper round sun: a tight bright core + a soft corona (no square quad)
  const SUN_FRAG = `#version 300 es
  precision highp float;
  in vec3 vCol; out vec4 fragColor;
  uniform float uBright;
  void main() {
    vec2 pc = gl_PointCoord - 0.5;
    float d = length(pc) * 2.0;                        // 0 centre .. 1 inscribed edge
    if (d > 1.0) discard;
    float core = pow(smoothstep(1.0, 0.0, d), 2.5);    // tight bright core
    float corona = exp(-d * d * 2.5);                  // soft halo
    fragColor = vec4(vCol * (core * 1.8 + corona * 0.5) * uBright, 1.0);
  }`;

  // ---- tracer particles (orbiting stars): pos.xy, vel.zw on the plane ----
  const TINIT_FRAG = M.FRAG_HEADER + M.GLSL_NOISE + FIELD_LIB + `
  uniform float uSeed, uGScale, uTotM, uSpawnR;
  void main() {
    vec2 s = gl_FragCoord.xy + uSeed;
    vec2 u = hash22(s);
    float ang = u.x * 6.28318;
    float rad = (0.4 + u.y * 0.6) * uSpawnR;
    vec2 p = uCenter + vec2(cos(ang), sin(ang)) * rad;
    float vmag = sqrt(uGScale * uTotM / max(rad, 0.2)) * (0.9 + hash12(s + 4.0) * 0.2);
    fragColor = vec4(p, vec2(-sin(ang), cos(ang)) * vmag);
  }`;

  const TUPDATE_FRAG = M.FRAG_HEADER + M.GLSL_NOISE + FIELD_LIB + `
  uniform sampler2D uParts;
  uniform float uDt, uSeed, uGScale, uTotM, uSpawnR, uConfK;
  void main() {
    vec4 st = texelFetch(uParts, ivec2(gl_FragCoord.xy), 0);
    vec2 p = st.xy, vel = st.zw;
    vec2 acc = vec2(0.0);
    for (int i = 0; i < ${MAXM}; i++) {
      if (i >= uMassN) break;
      vec2 d = uMass[i].xy - p;
      // big softening floor → stars glide over the suns into long stable spiral
      // orbits instead of plunging in or slingshotting out
      float r2 = dot(d, d) + uMass[i].w * 4.0 + 0.07;
      acc += uMass[i].z * d / (r2 * sqrt(r2));
    }
    // a soft confinement wall past the swarm radius keeps stars from escaping
    // (only beyond uSpawnR, so the inner spiral arms stay untouched)
    vec2 fromC = p - uCenter;
    float dC = length(fromC);
    if (dC > uSpawnR) acc -= fromC / dC * (dC - uSpawnR) * uConfK;
    vel += acc * uGScale * uDt;
    vel *= 0.9997;                                  // barely any drag → spirals persist
    p += vel * uDt;
    // last-resort respawn (rare): flung way out, or fallen into a core
    float rr = length(p - uCenter);
    if (rr > uSpawnR * 1.7 || rr < 0.03) {
      vec2 s = gl_FragCoord.xy + uSeed;
      vec2 u = hash22(s);
      float ang = u.x * 6.28318, rad = (0.4 + u.y * 0.6) * uSpawnR;
      p = uCenter + vec2(cos(ang), sin(ang)) * rad;
      float vmag = sqrt(uGScale * uTotM / max(rad, 0.2)) * (0.9 + hash12(s + 4.0) * 0.2);
      vel = vec2(-sin(ang), cos(ang)) * vmag;
    }
    fragColor = vec4(p, vel);
  }`;

  const TRACER_VERT = `#version 300 es
  precision highp float;
  uniform sampler2D uParts;
  uniform int uDim;
  ` + M.GLSL_COLOR + M.GLSL_NOISE + BAND_COLOR + FIELD_LIB + `
  uniform float uKeyHue, uPx, uShimmer, uBeat, uTime4;
  out vec3 vCol;
  void main() {
    ivec2 tc = ivec2(gl_VertexID % uDim, gl_VertexID / uDim);
    vec4 st = texelFetch(uParts, tc, 0);
    vec2 xz = st.xy;
    vec3 wp = vec3(xz.x, sheetY(xz) + 0.02, xz.y);
    vec4 cl = project(wp);
    gl_Position = cl;
    float depth = clamp(6.0 / cl.w, 0.4, 2.2);
    float spd = length(st.zw);
    float h = hash12(vec2(tc) + 0.5);

    // each star takes on the aspect of the sun whose well it orbits: it adopts
    // that sun's frequency band and colour, and pulses when that band is loud
    float band = uBodyBand[nearestBody(xz)];
    float e = specLog(band);
    float loud = e * e;
    // twinkle — faster and brighter with treble
    float tw = 0.6 + 0.4 * sin(uTime4 * (1.5 + h * 4.0) + h * 40.0) * (0.6 + uShimmer);
    float react = 0.4 + loud * 3.0 + uBeat * 0.35;

    vec3 col = mix(bandColor(band, uKeyHue), vec3(1.0, 0.96, 0.88),
                   clamp(loud * 0.9 + spd * 0.12, 0.0, 0.6));   // keep the band colour
    vCol = col * (0.5 + spd * 0.45) * react * tw;
    gl_PointSize = uPx * depth * (0.5 + h * 0.7 + loud * 1.7);  // swells when band is loud
  }`;

  const FADE_FRAG = M.FRAG_HEADER + `
  uniform sampler2D uPrev; uniform float uDecay;
  void main() { fragColor = vec4(texture(uPrev, vUV).rgb * uDecay, 1.0); }`;

  // composite over a computed cinematic sky (gradient + faint stars) + bloom
  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform sampler2D uTex, uBloom;
  void main() {
    vec3 glow = texture(uTex, vUV).rgb + texture(uBloom, vUV).rgb * 0.6;
    vec3 sky = mix(vec3(0.018, 0.022, 0.032), vec3(0.002, 0.003, 0.008),
                   smoothstep(0.0, 1.0, vUV.y));
    vec2 g = vUV * vec2(220.0, 130.0);
    vec2 id = floor(g);
    float star = pow(hash12(id), 240.0);
    float sd = length(fract(g) - 0.5);
    sky += vec3(0.6, 0.7, 0.9) * star * exp(-sd * sd * 26.0) * 0.6 * step(0.45, vUV.y);
    vec3 c = sky + glow;
    float v = length(vUV - 0.5);
    c *= 1.0 - v * v * 0.85;                 // vignette
    fragColor = vec4(aces(c), 1.0);
  }`;

  M.registerScene({
    name: 'two-body · warped spacetime',
    modes: ['music'],
    create(glc) {
      const gl = glc.gl;
      const G = 140;
      const GRID_VERTS = 2 * 2 * G * (G + 1);
      const tr = glc.pingpong(DIM_T, DIM_T, { nearest: true });
      const pGrid = glc.program(GRID_FRAG, GRID_VERT);
      const pBody = glc.program(SUN_FRAG, BODY_VERT);
      const pTInit = glc.program(TINIT_FRAG);
      const pTUpd = glc.program(TUPDATE_FRAG);
      const pTracer = glc.program(SPRITE_FRAG, TRACER_VERT);
      const pFade = glc.program(FADE_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const bloom = M.makeBloom(glc, { div: 4, passes: 3 });
      const emptyVAO = gl.createVertexArray();
      const trVAO = gl.createVertexArray();

      const EXTENT = 7.0, DEPTH = 0.42, MAXDIP = 3.0, SPAWNR = 2.6;
      const massBuf = new Float32Array(MAXM * 4);
      const bandBuf = new Float32Array(MAXM);     // each body's frequency band
      const BANDS = [0.12, 0.5, 0.85];            // bass · mid · treble
      let glow = null, seeded = false, keyHue = 0;
      let az = 0.4, camDist = 2.9, camH = 2.3;
      let cx = 0, cz = 0;                          // smoothed followed centre
      let sLevel = 0, sBass = 0, sTreble = 0, flare = 0, burstCD = 0;

      // softening scales with ∛mass (denser, more massive → bigger radius), so
      // the well a body carves reads its mass: heavy = deep & wide, light = shallow
      const softFor = (m) => 0.10 + 0.13 * Math.cbrt(m);

      // ---- a genuine N-body system (leapfrog) ----
      const bodies = [];
      function initSystem() {
        bodies.length = 0;
        const D = 1.35, m = 1.0;
        const vy = Math.sqrt(GSCALE * m / (2 * D));           // circular binary
        // the two suns own different bands (bass + mid), the companion the treble
        bodies.push({ x: -D / 2, z: 0, vx: 0, vz: vy, m, soft: softFor(m), band: BANDS[0] });
        bodies.push({ x:  D / 2, z: 0, vx: 0, vz: -vy, m, soft: softFor(m), band: BANDS[1] });
        const R = 2.5, mc = 0.3;
        const vc = Math.sqrt(GSCALE * (2 * m) / R);
        bodies.push({ x: 0, z: R, vx: -vc, vz: 0, m: mc, soft: softFor(mc), band: BANDS[2] });
        recenter();
      }
      // pin the centre of mass to the origin (position AND velocity) so the
      // system never drifts off-screen, even after a capture adds momentum
      function recenter() {
        let mx = 0, mz = 0, px = 0, pz = 0, mt = 0;
        for (const b of bodies) {
          mx += b.m * b.x; mz += b.m * b.z;
          px += b.m * b.vx; pz += b.m * b.vz; mt += b.m;
        }
        mx /= mt; mz /= mt; px /= mt; pz /= mt;
        for (const b of bodies) { b.x -= mx; b.z -= mz; b.vx -= px; b.vz -= pz; }
      }
      initSystem();

      function accelAll() {
        for (const b of bodies) { b.ax = 0; b.az = 0; }
        for (let i = 0; i < bodies.length; i++) {
          for (let j = i + 1; j < bodies.length; j++) {
            const a = bodies[i], b = bodies[j];
            const dx = b.x - a.x, dz = b.z - a.z;
            const s = Math.max(a.soft, b.soft);
            const r2 = dx * dx + dz * dz + s * s;
            const inv = GSCALE / (r2 * Math.sqrt(r2));
            a.ax += b.m * dx * inv; a.az += b.m * dz * inv;
            b.ax -= a.m * dx * inv; b.az -= a.m * dz * inv;
          }
        }
      }
      function integrate(dt) {
        const SUB = 4, h = dt / SUB;
        for (let s = 0; s < SUB; s++) {
          accelAll();
          for (const b of bodies) {
            b.vx += b.ax * h * 0.5; b.vz += b.az * h * 0.5;
            b.x += b.vx * h; b.z += b.vz * h;
          }
          accelAll();
          for (const b of bodies) { b.vx += b.ax * h * 0.5; b.vz += b.az * h * 0.5; }
        }
        for (let i = bodies.length - 1; i >= 3; i--) {     // cull escaped captures
          if (Math.hypot(bodies[i].x, bodies[i].z) > EXTENT) bodies.splice(i, 1);
        }
        recenter();
      }
      function totalMass() { let m = 0; for (const b of bodies) m += b.m; return m; }

      function packMasses() {
        const n = Math.min(MAXM, bodies.length);
        for (let i = 0; i < n; i++) {
          const b = bodies[i];
          massBuf[i * 4] = b.x; massBuf[i * 4 + 1] = b.z;
          massBuf[i * 4 + 2] = b.m; massBuf[i * 4 + 3] = b.soft * b.soft;
          bandBuf[i] = b.band;
        }
        return n;
      }

      function bindField(prog, audio) {
        const n = packMasses();
        prog.f4v('uMass', massBuf).fv('uBodyBand', bandBuf).i('uMassN', n)
            .f('uDepth', DEPTH).f('uExtent', EXTENT).f('uMaxDip', MAXDIP)
            .v2('uCenter', cx, cz)
            .v3('uCamPos', cx + Math.sin(az) * camDist, camH, cz + Math.cos(az) * camDist)
            .v3('uCamTarget', cx, -0.5, cz)
            .f('uFocal', 1.9).f('uAspect', glc.width / glc.height);
        M.spectrumUniforms(prog, audio, 1);
        return n;
      }

      function seedTracers(audio) {
        packMasses();
        pTInit.use().f('uSeed', Math.random() * 100).f('uGScale', GSCALE)
              .f('uTotM', totalMass()).f('uSpawnR', SPAWNR);
        bindField(pTInit, audio);
        glc.draw(pTInit, tr.read);
        seeded = true;
      }

      return {
        resize(w, h) {
          if (!glow) glow = glc.pingpong(w, h);
          else glow.resize(w, h);
          glow.a.clear(); glow.b.clear();
          bloom.resize(w, h);
        },
        update(dt, audio, t) {
          if (!glow) return;
          if (!seeded) seedTracers(audio);
          dt = Math.min(dt, 1 / 30);
          const f = audio.f;
          keyHue = M.chromaHue(f.chroma, keyHue, dt);
          const restful = f.quiet > 0.6;

          // snappier-but-smooth envelopes → reactive without bouncing the bodies
          sLevel += (f.level - sLevel) * (1 - Math.exp(-dt / 0.22));
          sBass += (f.bass - sBass) * (1 - Math.exp(-dt / 0.20));
          sTreble += (f.treble - sTreble) * (1 - Math.exp(-dt / 0.14));
          flare *= Math.exp(-dt / 0.5);
          if (f.burst === 1) flare = 1;

          integrate(dt);                                   // the orbit is the rhythm

          // the camera dynamically follows the binary's centre (the heavy bodies'
          // centroid), smoothed for a cinematic lag, and slowly orbits it
          let hx = 0, hz = 0, hm = 0;
          for (const b of bodies) if (b.m > 0.5) { hx += b.m * b.x; hz += b.m * b.z; hm += b.m; }
          if (hm > 0) { hx /= hm; hz /= hm; }
          cx += (hx - cx) * (1 - Math.exp(-dt / 0.5));
          cz += (hz - cz) * (1 - Math.exp(-dt / 0.5));
          az += dt * (0.06 + sLevel * 0.05);
          camDist += ((2.9 - sBass * 0.4) - camDist) * (1 - Math.exp(-dt / 0.8));
          camH = 2.3 + 0.22 * Math.sin(t * 0.13);

          // big burst → capture a new body that streaks in and is caught
          burstCD -= dt;
          if (f.burst === 1 && burstCD <= 0 && bodies.length < MAXM) {
            const ang = Math.random() * Math.PI * 2, r = EXTENT * 0.7;
            const vt = Math.sqrt(GSCALE * totalMass() / r) * 0.85, m = 0.32;
            bodies.push({
              x: Math.cos(ang) * r, z: Math.sin(ang) * r,
              vx: -Math.sin(ang) * vt - Math.cos(ang) * 0.25,
              vz: Math.cos(ang) * vt - Math.sin(ang) * 0.25,
              m, soft: softFor(m), band: BANDS[bodies.length % BANDS.length],
            });
            burstCD = 4.0;
          }

          // ---- step the tracers through the real field ----
          pTUpd.use();
          bindField(pTUpd, audio);
          pTUpd.f('uDt', dt).f('uGScale', GSCALE).f('uTotM', totalMass())
               .f('uSpawnR', SPAWNR).f('uConfK', 2.0);
          for (let it = 0; it < 2; it++) {
            pTUpd.f('uSeed', (t * 60.0 + it * 17.0) % 1000.0 + 0.5)
                 .tex('uParts', tr.read.tex, 0);
            glc.draw(pTUpd, tr.write);
            tr.swap();
          }
          this._s = { sLevel, sBass, sTreble, flare, restful };
        },
        render(out, audio, t) {
          if (!glow) this.resize(glc.width, glc.height);
          const f = audio.f;
          const s = this._s || { sLevel: 0, sBass: 0, sTreble: 0, flare: 0, restful: false };
          const dim = s.restful ? 0.55 : 1.0;

          pFade.use().f('uDecay', 0.82).tex('uPrev', glow.read.tex, 0);
          glc.draw(pFade, glow.write);

          gl.bindFramebuffer(gl.FRAMEBUFFER, glow.write.fbo);
          gl.viewport(0, 0, glow.write.w, glow.write.h);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);

          // 1. warped fabric — calm, music-static, translucent
          pGrid.use();
          bindField(pGrid, audio);
          pGrid.i('uG', G).f('uKeyHue', keyHue).f('uRim', 0.95)
               .f('uBright', 0.5 * dim);
          pGrid.bind();
          gl.bindVertexArray(emptyVAO);
          gl.drawArrays(gl.LINES, 0, GRID_VERTS);

          // 2. orbiting-star tracers
          pTracer.use();
          bindField(pTracer, audio);
          pTracer.i('uDim', DIM_T).f('uKeyHue', keyHue).f('uPx', 3.2)
                 .f('uShimmer', s.sTreble * 1.1 + s.flare).f('uBeat', f.beat).f('uTime4', t)
                 .f('uBright', (0.6 + s.sLevel * 0.25) * dim)
                 .f('uFalloff', 3.0);
          pTracer.tex('uParts', tr.read.tex, 0).bind();
          gl.bindVertexArray(trVAO);
          gl.drawArrays(gl.POINTS, 0, DIM_T * DIM_T);

          // 3. the bodies — cores flare on onsets (brightness only, never position)
          const nMass = packMasses();
          pBody.use();
          bindField(pBody, audio);
          pBody.f('uKeyHue', keyHue).f('uPx', 13.0).f('uOnsetP', f.onset)
               .f('uBright', (0.65 + f.level * 0.4) * dim + s.flare * 0.6);
          pBody.bind();
          gl.bindVertexArray(emptyVAO);
          gl.drawArrays(gl.POINTS, 0, nMass);

          gl.disable(gl.BLEND);
          glow.swap();

          bloom.render(glow.read.tex, glc.width, glc.height, 0.35);
          pShow.use().tex('uTex', glow.read.tex, 0).tex('uBloom', bloom.tex, 1);
          glc.draw(pShow, out);
        },
        dispose() {
          tr.dispose();
          if (glow) glow.dispose();
          bloom.dispose();
          gl.deleteVertexArray(emptyVAO); gl.deleteVertexArray(trVAO);
          for (const p of [pGrid, pBody, pTInit, pTUpd, pTracer, pFade, pShow]) p.dispose();
        },
      };
    },
  });
})();
