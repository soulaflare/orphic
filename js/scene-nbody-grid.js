/* ORPHIC scene — N-BODY GRAVITY · spacetime sheet
 * Newtonian gravity drawn the iconic way: a rubber-sheet grid whose vertices
 * sag under the summed gravitational potential Φ(x) = -Σ mᵢ/|x-xᵢ| of the
 * bodies sitting on it. A central sun and a ring of orbiting "band masses"
 * (one fed by each region of the spectrum) carve moving wells; tens of
 * thousands of light tracer particles fall through the real field on the GPU,
 * stringing themselves into orbiting galaxy streams. Everything — grid, bodies,
 * tracers — is projected through one shared perspective camera so the wells, the
 * stars in them and the streams around them always agree.
 *
 * The music drives the gravity itself: bass deepens every well and the sun's
 * mass, each frequency band pulses its orbiter (the sheet ripples per-frequency),
 * the live waveform sends standing ripples radiating across the sheet, beats
 * inject a fresh orbiter, and a big burst flings a heavy intruder on a slingshot
 * pass that dents spacetime as it crosses. In silence the system relaxes to a
 * slow, calm three-body orbit with gentle standing ripples — never static — and
 * a burst re-ignites it.
 *
 * Inspiration (concept only — Newtonian gravity is public domain, all GLSL our
 * own, no code borrowed): kavan010's "gravity_sim".
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const MAXM = 24;            // max simultaneous bodies (packed into a uniform array)
  const DIM_T = 256;          // 65k tracer particles in a ping-pong float texture

  // shared world/camera/gravity GLSL — identical math in every pass so the grid,
  // the bodies and the tracers live in the same warped space.
  const FIELD_LIB = `
  uniform vec4 uMass[${MAXM}];   // xy = plane pos, z = mass, w = softening²
  uniform int  uMassN;
  uniform float uDepth, uExtent;
  uniform vec3 uCamPos, uCamTarget;
  uniform float uFocal, uAspect;

  // gravitational potential of all bodies at plane point p (negative = a well)
  float potential(vec2 p) {
    float phi = 0.0;
    for (int i = 0; i < ${MAXM}; i++) {
      if (i >= uMassN) break;
      vec2 d = p - uMass[i].xy;
      phi -= uMass[i].z * inversesqrt(dot(d, d) + uMass[i].w);
    }
    return phi;
  }
  // sheet height at p (potential dip, clamped so deep wells don't tear through)
  float sheetY(vec2 p) { return max(potential(p) * uDepth, -1.1); }

  // project a world point through the shared perspective camera into clip space
  vec4 project(vec3 wp) {
    vec3 fwd = normalize(uCamTarget - uCamPos);
    vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up  = cross(rgt, fwd);
    vec3 rel = wp - uCamPos;
    float zc = max(dot(rel, fwd), 0.02);          // depth in front of camera
    float xc = dot(rel, rgt), yc = dot(rel, up);
    return vec4(xc * uFocal / uAspect, yc * uFocal, 0.0, zc);
  }`;

  // ---- the warped grid (drawn as GL_LINES generated from gl_VertexID) ----
  const GRID_VERT = `#version 300 es
  precision highp float;
  ` + M.GLSL_COLOR + M.GLSL_NOISE + M.GLSL_SPECTRUM + FIELD_LIB + `
  uniform int uG;
  uniform float uRipple, uTime2, uKeyHue, uBass, uLevel;
  out vec3 vCol;
  void main() {
    int v = gl_VertexID;
    int seg = v >> 1, end = v & 1;
    int HV = uG * (uG + 1);                        // # horizontal segments
    ivec2 gi;
    if (seg < HV) { int row = seg / uG; gi = ivec2(seg - row * uG + end, row); }
    else { int s = seg - HV; int col = s / uG; gi = ivec2(col, s - col * uG + end); }

    vec2 g01 = vec2(gi) / float(uG);
    vec2 xz = (g01 * 2.0 - 1.0) * uExtent;
    float r = length(xz);
    float y = sheetY(xz);
    // waveform standing ripple radiating from the centre
    y += uRipple * wave(fract(r * 0.6 - uTime2 * 0.12)) * 0.05 / (1.0 + r * r);

    gl_Position = project(vec3(xz.x, y, xz.y));

    float well = clamp(-potential(xz) * 0.10, 0.0, 1.0);    // 0 flat .. 1 deep
    vec3 base = pal(uKeyHue + 0.5, vec3(0.5), vec3(0.45), vec3(1.0),
                    vec3(0.0, 0.33, 0.67));
    vec3 hot = pal(uKeyHue, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.15, 0.3));
    vec3 c = mix(base * 0.5, hot, well);
    c *= 0.30 + 1.4 * well + uLevel * 0.25;                 // wells glow brighter
    vCol = c;
  }`;

  const GRID_FRAG = `#version 300 es
  precision highp float;
  in vec3 vCol; out vec4 fragColor;
  uniform float uBright;
  void main() { fragColor = vec4(vCol * uBright, 1.0); }`;

  // ---- the bodies (one POINT per mass) ----
  const BODY_VERT = `#version 300 es
  precision highp float;
  ` + M.GLSL_COLOR + FIELD_LIB + `
  uniform float uKeyHue, uPx;
  out vec3 vCol;
  void main() {
    int i = gl_VertexID;
    vec4 mm = uMass[i];
    vec2 xz = mm.xy;
    vec3 wp = vec3(xz.x, sheetY(xz) + 0.02, xz.y);
    vec4 cl = project(wp);
    gl_Position = cl;
    float depth = clamp(8.0 / cl.w, 0.3, 2.2);
    gl_PointSize = uPx * (0.6 + sqrt(mm.z) * 3.0) * depth;
    // sun warm-white, orbiters tinted by key; brighter with mass
    float warm = clamp(mm.z * 1.5, 0.0, 1.0);
    vec3 col = pal(uKeyHue + 0.08, vec3(0.6), vec3(0.4), vec3(1.0), vec3(0.0, 0.2, 0.4));
    col = mix(col, vec3(1.0, 0.92, 0.78), warm);
    vCol = col * (0.8 + min(mm.z, 1.2) * 1.1);
  }`;

  const SPRITE_FRAG = `#version 300 es
  precision highp float;
  in vec3 vCol; out vec4 fragColor;
  uniform float uBright, uFalloff;
  void main() {
    vec2 pc = gl_PointCoord - 0.5;
    float a = exp(-dot(pc, pc) * uFalloff);
    fragColor = vec4(vCol * a * uBright, 1.0);
  }`;

  // ---- tracer particles: GPGPU gravity (pos.xy, vel.zw on the plane) ----
  const TINIT_FRAG = M.FRAG_HEADER + M.GLSL_NOISE + FIELD_LIB + `
  uniform float uSeed, uGScale;
  void main() {
    vec2 s = gl_FragCoord.xy + uSeed;
    vec2 u = hash22(s);
    float ang = u.x * 6.28318;
    float rad = (0.25 + u.y * 0.85) * uExtent;     // a disk around the centre
    vec2 p = vec2(cos(ang), sin(ang)) * rad;
    // tangential velocity = circular orbit speed about the central mass, with a
    // little spread so the streams take a range of slightly eccentric orbits
    float vmag = sqrt(uGScale * max(uMass[0].z, 0.05) / max(rad, 0.1))
               * (0.9 + hash12(s + 4.0) * 0.25);
    vec2 vel = vec2(-sin(ang), cos(ang)) * vmag;
    fragColor = vec4(p, vel);
  }`;

  const TUPDATE_FRAG = M.FRAG_HEADER + M.GLSL_NOISE + FIELD_LIB + `
  uniform sampler2D uParts;
  uniform float uDt, uSeed, uGScale;
  void main() {
    vec4 st = texelFetch(uParts, ivec2(gl_FragCoord.xy), 0);
    vec2 p = st.xy, vel = st.zw;
    vec2 acc = vec2(0.0);
    for (int i = 0; i < ${MAXM}; i++) {
      if (i >= uMassN) break;
      vec2 d = uMass[i].xy - p;
      float r2 = dot(d, d) + uMass[i].w * 4.0;
      acc += uMass[i].z * d / (r2 * sqrt(r2));
    }
    vel += acc * uGScale * uDt;
    vel *= 0.9997;                                 // a whisper of drag → streams settle
    p += vel * uDt;
    // respawn if flung far out or fallen into the singular core
    float rr = length(p);
    if (rr > uExtent * 1.8 || rr < 0.025) {
      vec2 s = gl_FragCoord.xy + uSeed;
      vec2 u = hash22(s);
      float ang = u.x * 6.28318, rad = (0.3 + u.y * 0.8) * uExtent;
      p = vec2(cos(ang), sin(ang)) * rad;
      float vmag = sqrt(uGScale * max(uMass[0].z, 0.05) / max(rad, 0.1))
                 * (0.9 + hash12(s + 4.0) * 0.25);
      vel = vec2(-sin(ang), cos(ang)) * vmag;
    }
    fragColor = vec4(p, vel);
  }`;

  const TRACER_VERT = `#version 300 es
  precision highp float;
  uniform sampler2D uParts;
  uniform int uDim;
  ` + M.GLSL_COLOR + FIELD_LIB + `
  uniform float uKeyHue, uPx;
  out vec3 vCol;
  void main() {
    ivec2 tc = ivec2(gl_VertexID % uDim, gl_VertexID / uDim);
    vec4 st = texelFetch(uParts, tc, 0);
    vec2 xz = st.xy;
    vec3 wp = vec3(xz.x, sheetY(xz) + 0.01, xz.y);
    vec4 cl = project(wp);
    gl_Position = cl;
    float depth = clamp(6.0 / cl.w, 0.4, 2.0);
    gl_PointSize = uPx * depth;
    float spd = length(st.zw);
    // slow streams cool/blue, fast (near a well) hot — key-tinted
    vec3 col = pal(uKeyHue + 0.45 - spd * 0.18, vec3(0.5), vec3(0.5),
                   vec3(1.0), vec3(0.0, 0.33, 0.67));
    vCol = col * (0.25 + spd * 0.6);
  }`;

  const FADE_FRAG = M.FRAG_HEADER + `
  uniform sampler2D uPrev; uniform float uDecay;
  void main() { fragColor = vec4(texture(uPrev, vUV).rgb * uDecay, 1.0); }`;

  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_COLOR + `
  uniform sampler2D uTex, uBloom;
  void main() {
    vec3 c = texture(uTex, vUV).rgb + texture(uBloom, vUV).rgb * 0.85;
    float v = length(vUV - 0.5);
    c *= 1.0 - v * v * 0.7;
    fragColor = vec4(aces(c), 1.0);
  }`;

  M.registerScene({
    name: 'n-body gravity · spacetime sheet',
    modes: ['music'],
    create(glc) {
      const gl = glc.gl;
      const G = 64;                                // grid resolution (cells/side)
      const GRID_VERTS = 2 * 2 * G * (G + 1);      // 2 dirs × (G+1) lines × G segs × 2
      const tr = glc.pingpong(DIM_T, DIM_T, { nearest: true });
      const pGrid = glc.program(GRID_FRAG, GRID_VERT);
      const pBody = glc.program(SPRITE_FRAG, BODY_VERT);
      const pTInit = glc.program(TINIT_FRAG);
      const pTUpd = glc.program(TUPDATE_FRAG);
      const pTracer = glc.program(SPRITE_FRAG, TRACER_VERT);
      const pFade = glc.program(FADE_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const bloom = M.makeBloom(glc, { div: 4, passes: 3 });
      const emptyVAO = gl.createVertexArray();
      const trVAO = gl.createVertexArray();

      const EXTENT = 1.7, DEPTH = 0.30, GSCALE = 0.45;
      const massBuf = new Float32Array(MAXM * 4);
      let glow = null, seeded = false, keyHue = 0;
      let yaw = 0, t2 = 0;

      // ---- CPU body model: a central sun + parametric band-orbiters + free
      //      transient bodies (injected orbiters, comets, burst intruders) ----
      const NBANDS = 6;
      const sun = { x: 0, z: 0, m: 0.8, soft: 0.10 };
      const orbiters = [];        // parametric, fed by spectrum bands
      const transients = [];      // free-integrated, finite lifetime
      for (let i = 0; i < NBANDS; i++) {
        orbiters.push({
          r: 0.55 + i * 0.18, ang: (i / NBANDS) * Math.PI * 2,
          ecc: 0.82 + Math.random() * 0.2, tilt: Math.random() * Math.PI,
          baseM: 0.09, m: 0.09, band: i,
        });
      }
      let injectCD = 0, burstCD = 0, restful = false;

      function seedTracers() {
        packMasses(0); // need uMass[0] for orbital-speed init
        pTInit.use().f('uSeed', Math.random() * 100).f('uGScale', GSCALE);
        bindField(pTInit);
        glc.draw(pTInit, tr.read);
        seeded = true;
      }

      // pack live bodies into the uniform buffer; returns the active count
      function packMasses() {
        let n = 0;
        const put = (x, z, m, soft) => {
          if (n >= MAXM) return;
          massBuf[n * 4] = x; massBuf[n * 4 + 1] = z;
          massBuf[n * 4 + 2] = m; massBuf[n * 4 + 3] = soft * soft;
          n++;
        };
        put(sun.x, sun.z, sun.m, sun.soft);                // index 0 = the sun
        for (const o of orbiters) {
          const x = sun.x + Math.cos(o.ang) * o.r;
          const z = sun.z + Math.sin(o.ang) * o.r * o.ecc;
          o.px = x; o.pz = z;
          put(x, z, o.m, 0.07);
        }
        for (const tb of transients) put(tb.x, tb.z, tb.m, tb.soft);
        return n;
      }

      function bindField(prog) {
        const n = packMasses();
        prog.f4v('uMass', massBuf).i('uMassN', n)
            .f('uDepth', DEPTH).f('uExtent', EXTENT)
            .v3('uCamPos', Math.sin(yaw) * 2.4, 1.9, Math.cos(yaw) * 2.4)
            .v3('uCamTarget', 0, -0.28, 0)
            .f('uFocal', 1.5).f('uAspect', glc.width / glc.height);
        return n;
      }

      return {
        resize(w, h) {
          if (!glow) glow = glc.pingpong(w, h);
          else glow.resize(w, h);
          glow.a.clear(); glow.b.clear();
          bloom.resize(w, h);
          if (!seeded) seedTracers();
        },
        update(dt, audio, t) {
          if (!glow) return;
          dt = Math.min(dt, 1 / 24);
          const f = audio.f, ch = f.chroma;
          keyHue = M.chromaHue(ch, keyHue, dt);
          t2 = t;
          yaw += dt * (0.05 + f.level * 0.12);            // slow living drift

          restful = f.quiet > 0.6;

          // sun mass swells with bass; gentle Lissajous wander keeps it alive
          sun.m = (restful ? 0.6 : 0.8) + f.bass * 0.6;
          sun.x = Math.sin(t * 0.13) * 0.05;
          sun.z = Math.cos(t * 0.17) * 0.05;

          // each orbiter is fed by its spectrum band: mass pulses the well,
          // angular speed is Keplerian (closer = faster). Calmer when restful.
          const bandE = (i) => {
            // average a slice of the chroma vector as a cheap per-band energy
            let s = 0; const lo = Math.floor(i / NBANDS * 12), hi = Math.floor((i + 1) / NBANDS * 12);
            for (let k = lo; k < Math.max(lo + 1, hi); k++) s += ch[k] || 0;
            return s / Math.max(1, Math.max(lo + 1, hi) - lo);
          };
          let kept = 0;
          for (const o of orbiters) {
            const e = bandE(o.band);
            const targetM = o.baseM + e * (restful ? 0.10 : 0.30) + f.level * 0.04;
            o.m += (targetM - o.m) * (1 - Math.exp(-dt / 0.25));
            const speed = (restful ? 0.45 : 0.7 + f.level * 0.5);
            o.ang += dt * speed / Math.pow(o.r, 1.5) * 0.5;
          }

          // beats inject a fresh short-lived orbiter; bursts fling an intruder
          injectCD -= dt; burstCD -= dt;
          if (!restful && f.beat > 0.85 && injectCD <= 0 && transients.length < 8) {
            const ang = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 0.7;
            const vmag = Math.sqrt(sun.m / r) * GSCALE * (0.8 + Math.random() * 0.5);
            transients.push({
              x: Math.cos(ang) * r, z: Math.sin(ang) * r,
              vx: -Math.sin(ang) * vmag, vz: Math.cos(ang) * vmag,
              m: 0.05 + f.beat * 0.06, soft: 0.06, life: 6 + Math.random() * 4,
            });
            injectCD = 0.25;
          }
          if (f.burst === 1 && burstCD <= 0) {
            // a heavy intruder slingshots across the sheet (the showpiece)
            const side = Math.random() < 0.5 ? -1 : 1;
            transients.push({
              x: side * EXTENT * 1.4, z: (Math.random() - 0.5) * 1.2,
              vx: -side * (1.4 + Math.random() * 0.6), vz: (Math.random() - 0.5) * 0.8,
              m: 0.35, soft: 0.09, life: 5,
            });
            burstCD = 1.5;
          }

          // integrate transient bodies under the sun + orbiters' gravity
          for (let i = transients.length - 1; i >= 0; i--) {
            const tb = transients[i];
            tb.life -= dt;
            // sub-step for stability
            const SUB = 3, h = dt / SUB;
            for (let s = 0; s < SUB; s++) {
              let ax = 0, az = 0;
              const pull = (mx, mz, mm, soft) => {
                const dx = mx - tb.x, dz = mz - tb.z;
                const r2 = dx * dx + dz * dz + soft * soft;
                const inv = 1 / (r2 * Math.sqrt(r2));
                ax += GSCALE * mm * dx * inv; az += GSCALE * mm * dz * inv;
              };
              pull(sun.x, sun.z, sun.m, 0.12);
              for (const o of orbiters) pull(o.px || 0, o.pz || 0, o.m, 0.12);
              tb.vx += ax * h; tb.vz += az * h;
              tb.x += tb.vx * h; tb.z += tb.vz * h;
            }
            const rr = Math.hypot(tb.x, tb.z);
            if (tb.life <= 0 || rr > EXTENT * 2.2) transients.splice(i, 1);
          }

          // ---- step the GPGPU tracers under the live field ----
          pTUpd.use();
          bindField(pTUpd);
          pTUpd.f('uDt', Math.min(dt, 1 / 30) * 1.0).f('uGScale', GSCALE)
               .f('uSeed', (t * 60.0) % 1000.0 + 0.5);
          const ITERS = 2;
          for (let it = 0; it < ITERS; it++) {
            pTUpd.f('uSeed', (t * 60.0 + it * 17.0) % 1000.0 + 0.5)
                 .tex('uParts', tr.read.tex, 0);
            glc.draw(pTUpd, tr.write);
            tr.swap();
          }
        },
        render(out, audio, t) {
          if (!glow) this.resize(glc.width, glc.height);
          const f = audio.f;

          // 1. fade the previous frame (phosphor trails)
          pFade.use().f('uDecay', 0.80 - f.quiet * 0.06).tex('uPrev', glow.read.tex, 0);
          glc.draw(pFade, glow.write);

          gl.bindFramebuffer(gl.FRAMEBUFFER, glow.write.fbo);
          gl.viewport(0, 0, glow.write.w, glow.write.h);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);

          // 2. the warped grid
          pGrid.use();
          bindField(pGrid);
          M.spectrumUniforms(pGrid, audio, 0);
          pGrid.i('uG', G).f('uKeyHue', keyHue).f('uBass', f.bass).f('uLevel', f.level)
               .f('uRipple', 0.5 + f.level * 1.4 + f.quiet * 0.3).f('uTime2', t)
               .f('uBright', 0.85 + f.level * 0.4);
          pGrid.bind();
          gl.bindVertexArray(emptyVAO);
          gl.drawArrays(gl.LINES, 0, GRID_VERTS);

          // 3. tracer streams
          pTracer.use();
          bindField(pTracer);
          pTracer.i('uDim', DIM_T).f('uKeyHue', keyHue)
                 .f('uPx', 2.2).f('uBright', (0.38 + f.level * 0.22) * (1.0 - f.quiet * 0.55))
                 .f('uFalloff', 6.5);
          pTracer.tex('uParts', tr.read.tex, 0).bind();
          gl.bindVertexArray(trVAO);
          gl.drawArrays(gl.POINTS, 0, DIM_T * DIM_T);

          // 4. the glowing bodies on top
          const nMass = packMasses();
          pBody.use();
          bindField(pBody);
          pBody.f('uKeyHue', keyHue).f('uPx', 8.0)
               .f('uBright', (0.45 + f.level * 0.4) * (1.0 - f.quiet * 0.4) + f.burst * 0.7)
               .f('uFalloff', 6.0);
          pBody.bind();
          gl.bindVertexArray(emptyVAO);
          gl.drawArrays(gl.POINTS, 0, nMass);

          gl.disable(gl.BLEND);
          glow.swap();

          // 5. bloom + composite
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
