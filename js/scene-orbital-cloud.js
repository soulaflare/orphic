/* ORPHIC scene — ORBITAL CLOUD · hydrogen wavefunction
 * 262k+ walkers do a Metropolis–Hastings random walk on the hydrogen electron
 * probability density |ψ|², so the cloud *is* the orbital — the glowing, lobed
 * shapes of real quantum mechanics, kept clean and defined.
 *
 * One orbital-state machine drives TWO layers locked to the same shape, so the
 * cloud is both defined AND alive:
 *   - the BODY layer: a calm, evenly-lit, full point cloud — the defined
 *     electron-cloud form you actually read.
 *   - the SKIN layer: a second, agitated set of walkers sampling the SAME
 *     density, rendered mostly dark except where the live spectrum lights its
 *     lobe tips — it jitters, twinkles and pulses outward on onsets, a reactive
 *     halo riding on the body without ever disagreeing with its shape.
 *
 * The music never makes it jump. Between transitions the cloud holds one pure
 * orbital. On a real musical moment (a return from a rest, a strong beat, or a
 * sustained harmonic shift — gated to every few seconds) the electron
 * transitions the way it physically does: through a COHERENT SUPERPOSITION
 * ψ = √(1-w)·ψ_A + √w·ψ_B, whose interference term makes the density slosh
 * directionally from the old shape into the new one over ~1 s (a smooth morph,
 * not a snap and not a symmetric blur); the slosh phase rides loudness.
 * Register (pitch + centroid) → shell n, harmonic richness → angular index l
 * (s→p→d→f), dominant pitch class → m. Particles are tinted by the sign of ψ.
 *
 * Inspiration (concept only — wavefunctions reimplemented from scratch,
 * public-domain physics, no code borrowed): Kavan Patel's "Atoms".
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const DIM_BODY = 512; // 262k calm walkers (the defined body)
  const DIM_SKIN = 384; // 147k agitated walkers (the reactive skin)

  // ψ(n,l,m): verified closed forms, atomic units (a0=1), ρ = 2r/n.
  const ORB_LIB = `
  float orbRadial(int n, int l, float r) {
    float rho = 2.0 * r / float(n);
    float decay = exp(-0.5 * rho);
    float poly = 1.0;
    if (n == 2)      poly = (l == 0) ? (2.0 - rho) : rho;
    else if (n == 3) poly = (l == 0) ? (6.0 - 6.0 * rho + rho * rho)
                          : (l == 1) ? (rho * (4.0 - rho)) : (rho * rho);
    else if (n == 4) poly = (l == 0) ? (24.0 - 36.0 * rho + 12.0 * rho * rho - rho * rho * rho)
                          : (l == 1) ? (rho * (20.0 - 10.0 * rho + rho * rho))
                          : (l == 2) ? (rho * rho * (6.0 - rho)) : (rho * rho * rho);
    return poly * decay;
  }
  float orbAngular(int l, int m, vec3 d) {
    float x = d.x, y = d.y, z = d.z;
    if (l == 0) return 0.5;
    if (l == 1) return (m < 0) ? y : (m == 0) ? z : x;
    if (l == 2) {
      if (m == -2) return x * y;
      if (m == -1) return y * z;
      if (m ==  0) return 3.0 * z * z - 1.0;
      if (m ==  1) return x * z;
      return x * x - y * y;
    }
    if (m == -3) return y * (3.0 * x * x - y * y);
    if (m == -2) return x * y * z;
    if (m == -1) return y * (5.0 * z * z - 1.0);
    if (m ==  0) return z * (5.0 * z * z - 3.0);
    if (m ==  1) return x * (5.0 * z * z - 1.0);
    if (m ==  2) return z * (x * x - y * y);
    return x * (x * x - 3.0 * y * y);
  }
  float orbPsi(int n, int l, int m, vec3 p) {
    float r = length(p);
    return orbRadial(n, l, r) * orbAngular(l, m, p / max(r, 1e-5));
  }
  // coherent superposition amplitude of orbital A and B (weight w, phase c).
  // dens = |ψ|² >= 0 = (cA·a + c·cB·b)² + (1-c²)·w·b². Pure A at w=0, pure B at 1.
  float orbField(int nA, int lA, int mA, int nB, int lB, int mB,
                 float w, float c, vec3 p, out float dens) {
    float a = orbPsi(nA, lA, mA, p);
    float b = orbPsi(nB, lB, mB, p);
    float cA = sqrt(max(1.0 - w, 0.0)), cB = sqrt(max(w, 0.0));
    float s = cA * a + c * cB * b;
    dens = s * s + (1.0 - c * c) * w * b * b;
    return s;
  }`;

  const INIT_FRAG = M.FRAG_HEADER + M.GLSL_NOISE + `
  uniform float uSeed; uniform int uN;
  void main() {
    vec2 s = gl_FragCoord.xy + uSeed;
    vec2 u = hash22(s);
    float ph = u.x * 6.28318, ct = u.y * 2.0 - 1.0, st = sqrt(max(1.0 - ct * ct, 0.0));
    vec3 dir = vec3(st * cos(ph), st * sin(ph), ct);
    float rad = (0.4 + hash12(s + 7.0) * 1.4) * float(uN * uN);
    fragColor = vec4(dir * rad, 1.0);
  }`;

  // one Metropolis step on the (super)position density (shared by both layers)
  const UPDATE_FRAG = M.FRAG_HEADER + M.GLSL_NOISE + ORB_LIB + `
  uniform sampler2D uParts;
  uniform int uNA, uLA, uMA, uNB, uLB, uMB, uNmax;
  uniform float uW, uC, uStep, uT;
  void main() {
    vec3 pos = texelFetch(uParts, ivec2(gl_FragCoord.xy), 0).xyz;
    vec2 seed = gl_FragCoord.xy + uT * 70.7;
    vec3 jit = vec3(hash22(seed), hash12(seed + 5.0)) - 0.5;
    vec3 prop = pos + jit * 2.0 * uStep;

    float dOld, dNew;
    orbField(uNA, uLA, uMA, uNB, uLB, uMB, uW, uC, pos, dOld);
    orbField(uNA, uLA, uMA, uNB, uLB, uMB, uW, uC, prop, dNew);
    if (hash12(seed + 13.0) * (dOld + 1e-9) < dNew) pos = prop;

    if (dOld < 1e-7 && hash12(seed + 21.0) < 0.05) {
      vec2 u = hash22(seed + 31.0);
      float ph = u.x * 6.28318, ct = u.y * 2.0 - 1.0, st = sqrt(max(1.0 - ct * ct, 0.0));
      pos = vec3(st * cos(ph), st * sin(ph), ct) * float(uNmax * uNmax) * 0.7;
    }
    fragColor = vec4(pos, 1.0);
  }`;

  // 3D point splat. Character (body vs skin) is set entirely by uniforms:
  // uGlowBase (even fill), uTipGain (per-frequency lobe-tip lighting),
  // uWhiten (hot-band whitening), uHueBias.
  const DEPOSIT_VERT = `#version 300 es
  precision highp float;
  uniform sampler2D uParts;
  uniform int uDim, uNA, uLA, uMA, uNB, uLB, uMB;
  uniform float uW, uC, uYaw, uTilt, uBreath, uSizeNorm, uAspect, uPointBase;
  uniform float uKeyHue, uColEnergy, uGlowBase, uTipGain, uWhiten, uHueBias;
  out vec3 vCol; out float vDepth;
  ` + M.GLSL_COLOR + M.GLSL_SPECTRUM + ORB_LIB + `
  void main() {
    ivec2 tc = ivec2(gl_VertexID % uDim, gl_VertexID / uDim);
    vec3 p = texelFetch(uParts, tc, 0).xyz;
    float dens;
    float s = orbField(uNA, uLA, uMA, uNB, uLB, uMB, uW, uC, p, dens);
    float az = atan(p.z, p.x) / 6.28318 + 0.5;

    vec3 q = (p / uSizeNorm) * uBreath;
    float cy = cos(uYaw), sy = sin(uYaw);   q.xz = mat2(cy, -sy, sy, cy) * q.xz;
    float ct = cos(uTilt), st = sin(uTilt); q.yz = mat2(ct, -st, st, ct) * q.yz;

    gl_Position = vec4(q.x / uAspect, q.y, 0.0, 1.0);
    float depth = clamp(q.z * 0.5 + 0.5, 0.0, 1.0);
    vDepth = depth;
    gl_PointSize = uPointBase * (0.7 + 0.6 * depth);

    float band = specLog(az);
    float glow = uGlowBase + band * uTipGain * uColEnergy;
    float hue = (s >= 0.0 ? uKeyHue : uKeyHue + 0.5) + uHueBias;
    vec3 c = pal(hue, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
    c += band * band * vec3(0.55, 0.7, 1.0) * uWhiten;
    vCol = c * glow * (0.45 + 0.55 * depth);
  }`;

  const DEPOSIT_FRAG = `#version 300 es
  precision highp float;
  in vec3 vCol; in float vDepth; out vec4 fragColor;
  uniform float uBright;
  void main() {
    vec2 pc = gl_PointCoord - 0.5;
    float a = exp(-dot(pc, pc) * 8.0);
    fragColor = vec4(vCol * a * uBright, 1.0);
  }`;

  const FADE_FRAG = M.FRAG_HEADER + `
  uniform sampler2D uPrev; uniform float uDecay;
  void main() { fragColor = vec4(texture(uPrev, vUV).rgb * uDecay, 1.0); }`;

  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_COLOR + `
  uniform sampler2D uTex, uBloom;
  void main() {
    vec3 c = texture(uTex, vUV).rgb + texture(uBloom, vUV).rgb * 0.9;
    float v = length(vUV - 0.5);
    c *= 1.0 - v * v * 0.72;
    fragColor = vec4(aces(c), 1.0);
  }`;

  M.registerScene({
    name: 'orbital cloud · hydrogen wavefunction',
    modes: ['music'],
    create(glc) {
      const gl = glc.gl;
      const body = glc.pingpong(DIM_BODY, DIM_BODY, { nearest: true });
      const skin = glc.pingpong(DIM_SKIN, DIM_SKIN, { nearest: true });
      const pInit = glc.program(INIT_FRAG);
      const pUpdate = glc.program(UPDATE_FRAG);
      const pDeposit = glc.program(DEPOSIT_FRAG, DEPOSIT_VERT);
      const pFade = glc.program(FADE_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const bloom = M.makeBloom(glc, { div: 4, passes: 3 });
      const bodyVAO = gl.createVertexArray();
      const skinVAO = gl.createVertexArray();
      const ss = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

      let glow = null, seeded = false;
      let keyHue = 0, yaw = 0, tilt = 0.6, phi = 0;
      let richness = 0.3, register = 0.4, lastRich = 0.3, cooldown = 0;
      let A = { n: 2, l: 1, m: 0 };
      let B = { n: 2, l: 1, m: 0 };
      let transitioning = false, tw = 0, w = 0;
      let resting = false, excite = 0; // silent-mode ground state + return flash

      function seedField(field) {
        pInit.use().f('uSeed', Math.random() * 100).i('uN', A.n);
        glc.draw(pInit, field.read);
      }
      function seed() { seedField(body); seedField(skin); seeded = true; }

      function newOrbital(f) {
        const ch = f.chroma;
        let pc = 0, mx = 0;
        for (let i = 0; i < 12; i++) { if (ch[i] > ch[pc]) pc = i; if (ch[i] > mx) mx = ch[i]; }
        const n = Math.min(4, Math.max(2, 2 + Math.round(register * 2)));
        const l = Math.min(n - 1, Math.max(0, Math.round(richness * (n - 1))));
        const m = l === 0 ? 0 : Math.max(-l, Math.min(l, Math.round((pc / 11 - 0.5) * 2 * l)));
        return { n, l, m };
      }
      function startTransition(f) {
        B = newOrbital(f);
        tw = 0; transitioning = true; cooldown = 3.0; lastRich = richness; resting = false;
      }
      // silent mode: relax toward the ground state (a calm 2s sphere)
      function relaxToGround() {
        B = { n: 2, l: 0, m: 0 };
        tw = 0; transitioning = true; resting = true; cooldown = 2.0;
      }

      // run the Metropolis sim for one field at a given step (shared state must
      // already be set on pUpdate)
      function stepField(field, vao, step, iters, t) {
        pUpdate.f('uStep', step);
        for (let it = 0; it < iters; it++) {
          pUpdate.f('uT', t + it * 0.137).tex('uParts', field.read.tex, 0);
          glc.draw(pUpdate, field.write);
          field.swap();
        }
      }

      // splat one field with a given character
      function drawField(field, vao, dim, opts, audio) {
        pDeposit.use()
          .i('uDim', dim)
          .i('uNA', A.n).i('uLA', A.l).i('uMA', A.m)
          .i('uNB', B.n).i('uLB', B.l).i('uMB', B.m)
          .f('uW', w).f('uC', Math.cos(phi))
          .f('uYaw', yaw).f('uTilt', tilt).f('uBreath', opts.breath)
          .f('uSizeNorm', opts.sizeNorm).f('uAspect', opts.aspect).f('uPointBase', opts.pointBase)
          .f('uKeyHue', keyHue).f('uColEnergy', opts.colEnergy)
          .f('uGlowBase', opts.glowBase).f('uTipGain', opts.tipGain)
          .f('uWhiten', opts.whiten).f('uHueBias', opts.hueBias)
          .f('uBright', opts.bright);
        M.spectrumUniforms(pDeposit, audio, 3);
        pDeposit.tex('uParts', field.read.tex, 0).bind();
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.POINTS, 0, dim * dim);
      }

      return {
        resize(w2, h) {
          if (!glow) glow = glc.pingpong(w2, h);
          else glow.resize(w2, h);
          glow.a.clear(); glow.b.clear();
          bloom.resize(w2, h);
          if (!seeded) seed();
        },
        update(dt, audio, t) {
          if (!glow) return;
          const f = audio.f, ch = f.chroma;
          keyHue = M.chromaHue(ch, keyHue, dt);

          let mx = 0; for (let i = 0; i < 12; i++) if (ch[i] > mx) mx = ch[i];
          let active = 0; for (let i = 0; i < 12; i++) if (ch[i] > mx * 0.4) active++;
          const richRaw = Math.min(1, 0.5 * ((active - 1) / 5) + 0.3 * f.harmonic + 0.3 * f.centroid);
          richness += (richRaw - richness) * (1 - Math.exp(-dt / 1.3));
          register += ((0.45 * f.pitchNorm + 0.55 * f.centroid) - register) * (1 - Math.exp(-dt / 2.0));

          yaw += dt * (0.18 * (1 - 0.5 * f.quiet) + f.level * 0.7); // idle: slow drift
          tilt += dt * 0.04 * Math.sin(f.phaseLevel * 0.04);
          phi += dt * (3.5 + f.level * 6.0);
          excite *= Math.exp(-dt / 0.7); // return-flash envelope decays

          cooldown -= dt;
          if (f.quiet > 0.6) {
            // silence: the electron relaxes to its ground state (once)
            if (!resting && !transitioning) relaxToGround();
          } else if (f.quiet < 0.4 && !transitioning) {
            // music playing: excite up. A return from rest always fires and
            // flashes; otherwise transition on real moments, gated by cooldown.
            if (resting && f.burst === 1) { startTransition(f); excite = 1; }
            else if (cooldown <= 0 &&
                     (f.burst === 1 || f.beat > 0.9 || Math.abs(richness - lastRich) > 0.25))
              startTransition(f);
          }
          if (transitioning) {
            tw += dt / 0.9;
            if (tw >= 1) { A = { ...B }; transitioning = false; tw = 0; }
          }
          w = transitioning ? ss(tw) : 0;
          const nmax = Math.max(A.n, B.n);

          // shared state on the update program, then step both fields
          pUpdate.use()
            .i('uNA', A.n).i('uLA', A.l).i('uMA', A.m)
            .i('uNB', B.n).i('uLB', B.l).i('uMB', B.m).i('uNmax', nmax)
            .f('uW', w).f('uC', Math.cos(phi));
          const stepBody = (0.10 * nmax * nmax + 0.12) * (1.0 + f.level * 0.25);
          const stepSkin = stepBody * (1.9 + f.onset * 2.1 + f.treble * 0.85); // agitated → twinkle
          stepField(body, bodyVAO, stepBody, 3, t);
          stepField(skin, skinVAO, stepSkin, 2, t + 11.0);
        },
        render(out, audio, t) {
          if (!glow) this.resize(glc.width, glc.height);
          const f = audio.f;
          const aspect = glc.width / glc.height;
          const nEff2 = A.n * A.n + (B.n * B.n - A.n * A.n) * w;
          const sizeNorm = nEff2 * 1.8 + 2.0;
          // breathe with bass; in silence a slow autonomous zero-point pulse
          const breath = 1.0 + f.bass * 0.22 + 0.06 * Math.sin(f.phaseBass * 0.1)
                       + f.quiet * 0.12 * Math.sin(t * 0.7);
          const transFlash = transitioning ? 4 * w * (1 - w) * 0.05 : 0;

          // 1. fade previous frame (soft phosphor glow)
          pFade.use().f('uDecay', 0.82).tex('uPrev', glow.read.tex, 0);
          glc.draw(pFade, glow.write);

          // 2. additive splats into the faded frame: body first, skin on top
          gl.bindFramebuffer(gl.FRAMEBUFFER, glow.write.fbo);
          gl.viewport(0, 0, glow.write.w, glow.write.h);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          // BODY — calm, evenly lit, defined. In silence keep a soft glowing
          // ground-state sphere (quiet floor + gentle pulse); flash on return.
          drawField(body, bodyVAO, DIM_BODY, {
            aspect, sizeNorm, breath, pointBase: 2.0,
            colEnergy: 0.6 + f.harmonic * 0.8,
            glowBase: 0.8, tipGain: 0.5, whiten: 0.35, hueBias: 0.0,
            bright: 0.05 * (0.7 + f.harmonic * 1.0 + f.level * 0.6) + transFlash
                  + f.quiet * (0.05 + 0.02 * Math.sin(t * 0.9)) + excite * 0.18,
          }, audio);
          // SKIN — agitated, mostly dark, lit by the live spectrum, onset-pulsed.
          // base stays dark (definition-safe); pronounced via tip lighting, the
          // onset halo expansion, twinkle and hue separation — with tipGain/
          // whiten/bright dialed back a notch so it reads strong but not busy.
          drawField(skin, skinVAO, DIM_SKIN, {
            aspect, sizeNorm, breath: breath * (1.1 + f.onset * 0.38), pointBase: 3.2,
            colEnergy: 0.85 + f.treble * 1.1,
            glowBase: 0.1 + f.quiet * 0.12, tipGain: 1.9, whiten: 0.7, hueBias: 0.13,
            bright: 0.045 * (0.5 + f.treble * 1.4 + f.level * 0.85) + f.onset * 0.06
                  + f.quiet * 0.015 + excite * 0.06,
          }, audio);
          gl.disable(gl.BLEND);
          glow.swap();

          // 3. bloom + composite
          bloom.render(glow.read.tex, glc.width, glc.height, 0.3);
          pShow.use().tex('uTex', glow.read.tex, 0).tex('uBloom', bloom.tex, 1);
          glc.draw(pShow, out);
        },
        dispose() {
          body.dispose(); skin.dispose();
          if (glow) glow.dispose();
          bloom.dispose();
          gl.deleteVertexArray(bodyVAO); gl.deleteVertexArray(skinVAO);
          for (const p of [pInit, pUpdate, pDeposit, pFade, pShow]) p.dispose();
        },
      };
    },
  });
})();
