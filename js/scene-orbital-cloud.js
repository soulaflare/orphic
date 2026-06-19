/* ORPHIC scene — ORBITAL CLOUD · hydrogen wavefunction
 * 262k walkers do a Metropolis–Hastings random walk on the hydrogen electron
 * probability density |ψ(n,l,m)|² = |R_nl(r)·Y_lm(θ,φ)|², so the particle
 * cloud *is* the orbital — the glowing, lobed shapes of real quantum
 * mechanics. The music's harmony sculpts the geometry: the register (pitch +
 * spectral centroid) picks the principal number n (size/shell), the number of
 * simultaneously-sounding pitch classes picks the angular number l (s-sphere →
 * p-dumbbell → d-cloverleaf → f), and the dominant pitch class picks m
 * (orientation) — so a sparse note is a simple sphere and a dense chord
 * resolves into an intricate multi-lobed orbital. Beats "measure" the
 * electron: a fresh (n,l,m) is committed and the walkers migrate into the new
 * shape. Particles are tinted by the sign of ψ, so lobes and radial-node
 * shells read in two tones; harmonic energy makes the cloud glow, loudness
 * agitates the walk.
 *
 * Inspiration (concept only — wavefunctions reimplemented from scratch,
 * public-domain physics, no code borrowed): Kavan Patel's "Atoms".
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const DIM = 512; // DIM*DIM walkers

  // ψ(n,l,m): verified closed forms, atomic units (a0=1), ρ = 2r/n.
  // Only the node-setting polynomials + decay matter (Metropolis uses ratios).
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
  // real spherical harmonics, Cartesian (d = unit direction)
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

  // one Metropolis step: propose a symmetric jump, accept with |ψ_new|²/|ψ_old|²
  const UPDATE_FRAG = M.FRAG_HEADER + M.GLSL_NOISE + ORB_LIB + `
  uniform sampler2D uParts;
  uniform int uN, uL, uM;
  uniform float uStep, uT;
  void main() {
    vec3 pos = texelFetch(uParts, ivec2(gl_FragCoord.xy), 0).xyz;
    vec2 seed = gl_FragCoord.xy + uT * 70.7;
    vec3 jit = vec3(hash22(seed), hash12(seed + 5.0)) - 0.5;
    vec3 prop = pos + jit * 2.0 * uStep;

    float pOld = orbPsi(uN, uL, uM, pos);  pOld *= pOld;
    float pNew = orbPsi(uN, uL, uM, prop); pNew *= pNew;
    if (hash12(seed + 13.0) * (pOld + 1e-9) < pNew) pos = prop;

    // revive stranded walkers (e.g. left far out after n shrinks)
    if (pOld < 1e-7 && hash12(seed + 21.0) < 0.05) {
      vec2 u = hash22(seed + 31.0);
      float ph = u.x * 6.28318, ct = u.y * 2.0 - 1.0, st = sqrt(max(1.0 - ct * ct, 0.0));
      pos = vec3(st * cos(ph), st * sin(ph), ct) * float(uN * uN) * 0.7;
    }
    fragColor = vec4(pos, 1.0);
  }`;

  // 3D point splat: rotate into view, color by sign of ψ (lobe / node shells)
  const DEPOSIT_VERT = `#version 300 es
  precision highp float;
  uniform sampler2D uParts;
  uniform int uDim, uN, uL, uM;
  uniform float uYaw, uTilt, uSizeNorm, uAspect, uPointBase, uKeyHue;
  out vec3 vCol; out float vDepth;
  ` + M.GLSL_COLOR + ORB_LIB + `
  void main() {
    ivec2 tc = ivec2(gl_VertexID % uDim, gl_VertexID / uDim);
    vec3 p = texelFetch(uParts, tc, 0).xyz;
    float psi = orbPsi(uN, uL, uM, p); // sign in the orbital's body frame

    vec3 q = p / uSizeNorm;
    float cy = cos(uYaw), sy = sin(uYaw);   q.xz = mat2(cy, -sy, sy, cy) * q.xz;
    float ct = cos(uTilt), st = sin(uTilt); q.yz = mat2(ct, -st, st, ct) * q.yz;

    gl_Position = vec4(q.x / uAspect, q.y, 0.0, 1.0);
    float depth = clamp(q.z * 0.5 + 0.5, 0.0, 1.0);
    vDepth = depth;
    gl_PointSize = uPointBase * (0.7 + 0.6 * depth);

    float hue = psi >= 0.0 ? uKeyHue : uKeyHue + 0.5;
    vec3 c = pal(hue, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
    vCol = c * (0.45 + 0.55 * depth);
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
      const parts = glc.pingpong(DIM, DIM, { nearest: true });
      const pInit = glc.program(INIT_FRAG);
      const pUpdate = glc.program(UPDATE_FRAG);
      const pDeposit = glc.program(DEPOSIT_FRAG, DEPOSIT_VERT);
      const pFade = glc.program(FADE_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const bloom = M.makeBloom(glc, { div: 4, passes: 3 });
      const depositVAO = gl.createVertexArray();

      let glow = null;
      let keyHue = 0, yaw = 0, tilt = 0.5, timer = 0, seeded = false;
      let n = 2, l = 1, m = 0;

      function seed() {
        pInit.use().f('uSeed', Math.random() * 100).i('uN', n);
        glc.draw(pInit, parts.read);
        seeded = true;
      }

      // "measure" the electron: choose (n,l,m) from the current harmony
      function remeasure(f) {
        const ch = f.chroma;
        let pc = 0, mx = 0;
        for (let i = 0; i < 12; i++) { if (ch[i] > ch[pc]) pc = i; if (ch[i] > mx) mx = ch[i]; }
        let active = 0;
        for (let i = 0; i < 12; i++) if (ch[i] > mx * 0.45) active++;
        n = Math.min(4, Math.max(1, 1 + Math.round((0.45 * f.pitchNorm + 0.55 * f.centroid) * 3)));
        l = Math.min(n - 1, Math.max(0, Math.round((active - 1) * 0.5)));
        m = l === 0 ? 0 : Math.max(-l, Math.min(l, Math.round((pc / 11 - 0.5) * 2 * l)));
      }

      return {
        resize(w, h) {
          if (!glow) glow = glc.pingpong(w, h);
          else glow.resize(w, h);
          glow.a.clear(); glow.b.clear();
          bloom.resize(w, h);
          if (!seeded) seed();
        },
        update(dt, audio, t) {
          if (!glow) return;
          const f = audio.f;
          keyHue = M.chromaHue(f.chroma, keyHue, dt);
          yaw += dt * (0.18 + f.level * 0.7);
          tilt += dt * 0.05 * Math.sin(f.phaseLevel * 0.04);

          // re-measure on beats (or every ~2.6 s) so the cloud has time to relax
          timer += dt;
          if (f.beat > 0.9 || f.burst === 1 || timer > 2.6) { remeasure(f); timer = 0; }

          // a few Metropolis iterations per frame; loudness agitates the walk
          const step = (0.10 * n * n + 0.12) * (1.0 + f.level * 0.6);
          pUpdate.use().i('uN', n).i('uL', l).i('uM', m).f('uStep', step);
          for (let it = 0; it < 3; it++) {
            pUpdate.f('uT', t + it * 0.137).tex('uParts', parts.read.tex, 0);
            glc.draw(pUpdate, parts.write);
            parts.swap();
          }
        },
        render(out, audio, t) {
          if (!glow) this.resize(glc.width, glc.height);
          const f = audio.f;
          const aspect = glc.width / glc.height;
          const sizeNorm = n * n * 3.0 + 2.5; // fit the cloud to the frame

          // 1. fade the previous frame (phosphor trails as walkers migrate)
          pFade.use().f('uDecay', 0.82).tex('uPrev', glow.read.tex, 0);
          glc.draw(pFade, glow.write);

          // 2. additively splat the walkers into the faded frame
          gl.bindFramebuffer(gl.FRAMEBUFFER, glow.write.fbo);
          gl.viewport(0, 0, glow.write.w, glow.write.h);
          pDeposit.use()
            .i('uDim', DIM).i('uN', n).i('uL', l).i('uM', m)
            .f('uYaw', yaw).f('uTilt', tilt).f('uSizeNorm', sizeNorm)
            .f('uAspect', aspect).f('uPointBase', 2.0)
            .f('uKeyHue', keyHue)
            .f('uBright', 0.045 * (0.7 + f.harmonic * 1.1 + f.level * 0.5))
            .tex('uParts', parts.read.tex, 0).bind();
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.bindVertexArray(depositVAO);
          gl.drawArrays(gl.POINTS, 0, DIM * DIM);
          gl.disable(gl.BLEND);
          glow.swap();

          // 3. bloom + composite
          bloom.render(glow.read.tex, glc.width, glc.height, 0.25);
          pShow.use().tex('uTex', glow.read.tex, 0).tex('uBloom', bloom.tex, 1);
          glc.draw(pShow, out);
        },
        dispose() {
          parts.dispose();
          if (glow) glow.dispose();
          bloom.dispose();
          gl.deleteVertexArray(depositVAO);
          for (const p of [pInit, pUpdate, pDeposit, pFade, pShow]) p.dispose();
        },
      };
    },
  });
})();
