/* ORPHIC scene — ORBITAL CLOUD · hydrogen wavefunction
 * 262k walkers do a Metropolis–Hastings random walk on the hydrogen electron
 * probability density |ψ(n,l,m)|², so the particle cloud *is* the orbital —
 * the glowing, lobed shapes of real quantum mechanics. Built visualizer-first:
 * the structure morphs *continuously*, not in discrete jumps.
 *
 *  - harmony grows the lobes: a smoothed "richness" signal (chord density +
 *    harmonic energy + brightness) drives a continuous shape parameter that
 *    blends between adjacent orbitals (s→p→d→f), so a thickening chord visibly
 *    sprouts lobes out of the sphere in real time.
 *  - the spectrum plays the orbital: each lobe is lit by the frequency at its
 *    azimuth, so individual sounds pulse individual lobes; hot bands whiten.
 *  - it breathes and spins every frame: bass inflates the cloud, loudness
 *    spins it, and a rotating angular "current" reads as the electron orbiting.
 *  - measurement is rare and earned: only on a real return-from-rest or a
 *    sustained harmonic shift (with a cooldown) does the electron get
 *    "measured" — the cloud collapses to a bright core and blooms into a fresh
 *    shell (new n) and orientation. Particles are tinted by the sign of ψ, so
 *    lobes and radial-node shells read in two tones.
 *
 * Inspiration (concept only — wavefunctions reimplemented from scratch,
 * public-domain physics, no code borrowed): Kavan Patel's "Atoms".
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const DIM = 512; // DIM*DIM walkers

  // ψ(n,l,m): verified closed forms, atomic units (a0=1), ρ = 2r/n. Only the
  // node-setting polynomials + decay matter (Metropolis works on ratios).
  // A canonical m per l picks the most striking in-plane multi-lobe arrangement
  // so the continuous l-blend reads as lobes multiplying as they spin.
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
  int mCanon(int l) { return l <= 0 ? 0 : l == 1 ? 1 : l == 2 ? -2 : -3; }
  float orbPsi(int n, int l, int m, vec3 p) {
    float r = length(p);
    return orbRadial(n, l, r) * orbAngular(l, m, p / max(r, 1e-5));
  }
  // continuous blend between orbital l0 and l0+1 (shape in [0, n-1])
  float orbDensity(int n, float shape, vec3 p) {
    int l0 = max(int(floor(shape)), 0);
    int l1 = min(l0 + 1, n - 1);
    float fr = clamp(shape - float(l0), 0.0, 1.0);
    float a = orbPsi(n, l0, mCanon(l0), p);
    float b = orbPsi(n, l1, mCanon(l1), p);
    return mix(a * a, b * b, fr);
  }
  float orbSigned(int n, float shape, vec3 p) {
    int l0 = max(int(floor(shape)), 0);
    int l1 = min(l0 + 1, n - 1);
    float fr = clamp(shape - float(l0), 0.0, 1.0);
    return fr < 0.5 ? orbPsi(n, l0, mCanon(l0), p) : orbPsi(n, l1, mCanon(l1), p);
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

  // one Metropolis step on the (integer) orbital density; when the shape
  // changes at a measurement the walkers relax into the new clean orbital
  const UPDATE_FRAG = M.FRAG_HEADER + M.GLSL_NOISE + ORB_LIB + `
  uniform sampler2D uParts;
  uniform int uN;
  uniform float uShape, uStep, uT;
  void main() {
    vec3 pos = texelFetch(uParts, ivec2(gl_FragCoord.xy), 0).xyz;
    vec2 seed = gl_FragCoord.xy + uT * 70.7;
    vec3 jit = vec3(hash22(seed), hash12(seed + 5.0)) - 0.5;
    vec3 prop = pos + jit * 2.0 * uStep;

    float pOld = orbDensity(uN, uShape, pos);
    float pNew = orbDensity(uN, uShape, prop);
    if (hash12(seed + 13.0) * (pOld + 1e-9) < pNew) pos = prop;

    // revive stranded walkers (e.g. left far out after the shell shrinks)
    if (pOld < 1e-7 && hash12(seed + 21.0) < 0.05) {
      vec2 u = hash22(seed + 31.0);
      float ph = u.x * 6.28318, ct = u.y * 2.0 - 1.0, st = sqrt(max(1.0 - ct * ct, 0.0));
      pos = vec3(st * cos(ph), st * sin(ph), ct) * float(uN * uN) * 0.7;
    }
    fragColor = vec4(pos, 1.0);
  }`;

  // 3D point splat: rotate into view, light each lobe by its azimuthal
  // frequency, tint by sign of ψ, shimmer an angular current around the lobes
  const DEPOSIT_VERT = `#version 300 es
  precision highp float;
  uniform sampler2D uParts;
  uniform int uDim, uN;
  uniform float uShape, uYaw, uTilt, uBreath, uSizeNorm, uAspect, uPointBase;
  uniform float uKeyHue, uShimmer, uColEnergy;
  out vec3 vCol; out float vDepth;
  ` + M.GLSL_COLOR + M.GLSL_SPECTRUM + ORB_LIB + `
  void main() {
    ivec2 tc = ivec2(gl_VertexID % uDim, gl_VertexID / uDim);
    vec3 p = texelFetch(uParts, tc, 0).xyz;
    float r = length(p);
    float psi = orbSigned(uN, uShape, p);          // sign in the body frame
    float az = atan(p.z, p.x) / 6.28318 + 0.5;     // lobe azimuth → frequency

    vec3 q = (p / uSizeNorm) * uBreath;
    float cy = cos(uYaw), sy = sin(uYaw);   q.xz = mat2(cy, -sy, sy, cy) * q.xz;
    float ct = cos(uTilt), st = sin(uTilt); q.yz = mat2(ct, -st, st, ct) * q.yz;

    gl_Position = vec4(q.x / uAspect, q.y, 0.0, 1.0);
    float depth = clamp(q.z * 0.5 + 0.5, 0.0, 1.0);
    vDepth = depth;
    gl_PointSize = uPointBase * (0.7 + 0.6 * depth);

    float band = specLog(az);                      // this lobe's live energy
    float shimmer = 0.88 + 0.12 * sin(az * 12.566 - uShimmer); // gentle current
    // keep the whole cloud well-lit (defined); frequency is an accent, not the
    // dominant brightness, so lobes never drop dark
    float glow = (0.75 + band * 1.1 * uColEnergy) * shimmer;

    float hue = psi >= 0.0 ? uKeyHue : uKeyHue + 0.5;
    vec3 c = pal(hue, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
    c += band * band * vec3(0.55, 0.7, 1.0) * 0.4;  // hot frequencies whiten
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
    vec3 c = texture(uTex, vUV).rgb + texture(uBloom, vUV).rgb * 0.6;
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
      let keyHue = 0, yaw = 0, tilt = 0.5, shimmer = 0, seeded = false;
      let n = 3;                       // shell (changes only on a measurement)
      let shape = 1.0;                 // continuous orbital index [0, n-1]
      let richness = 0.3, register = 0.4; // smoothed harmony drivers
      let collapse = 0;                // measurement implode/bloom envelope
      let cooldown = 0;                // min time between measurements
      let lastRich = 0.3;

      function seed() {
        pInit.use().f('uSeed', Math.random() * 100).i('uN', n);
        glc.draw(pInit, parts.read);
        seeded = true;
      }

      // a rare, earned "measurement": commit a fresh, *clean* orbital — integer
      // shell n and angular index l (= shape) from the current harmony — plus a
      // new orientation. The cloud then relaxes into that defined shape.
      function measure() {
        n = Math.min(4, Math.max(2, 2 + Math.round(register * 2)));
        shape = Math.min(n - 1, Math.max(0, Math.round(richness * (n - 1) * 1.05)));
        tilt = 0.4 + Math.random() * 0.8;
        yaw += Math.PI * (0.4 + Math.random() * 0.6);
        collapse = 1.0; // brightness flash only (no implode → no streaks)
        cooldown = 6.0;
        lastRich = richness;
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
          const f = audio.f, ch = f.chroma;
          keyHue = M.chromaHue(ch, keyHue, dt);

          // smoothed harmony drivers (heavy smoothing → no jitter)
          let mx = 0; for (let i = 0; i < 12; i++) if (ch[i] > mx) mx = ch[i];
          let active = 0; for (let i = 0; i < 12; i++) if (ch[i] > mx * 0.4) active++;
          const richRaw = Math.min(1, 0.5 * ((active - 1) / 5) + 0.3 * f.harmonic + 0.3 * f.centroid);
          const regRaw = 0.45 * f.pitchNorm + 0.55 * f.centroid;
          richness += (richRaw - richness) * (1 - Math.exp(-dt / 1.3));
          register += (regRaw - register) * (1 - Math.exp(-dt / 2.0));

          // motion every frame: spin on loudness, gentle current shimmer.
          // (shape is NOT updated here — it's a clean integer set at measurement,
          // so the cloud holds a defined orbital between measurements.)
          yaw += dt * (0.18 + f.level * 0.7);
          tilt += dt * 0.04 * Math.sin(f.phaseLevel * 0.04);
          shimmer += dt * (1.2 + f.level * 4.0);

          // rare measurement: only a real return-from-rest, or a big sustained
          // harmonic shift, and never more often than the cooldown allows
          cooldown -= dt;
          if (cooldown <= 0 && (f.burst === 1 || Math.abs(richness - lastRich) > 0.32)) measure();
          collapse *= Math.exp(-dt / 0.5);

          // Metropolis iterations; keep the step calm so the cloud stays defined
          const step = (0.10 * n * n + 0.12) * (1.0 + f.level * 0.25);
          pUpdate.use().i('uN', n).f('uShape', shape).f('uStep', step);
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
          const sizeNorm = n * n * 1.7 + 1.8; // fill more of the frame
          const breath = 1.0 + f.bass * 0.18 + 0.08 * Math.sin(f.phaseBass * 0.1);

          // 1. fade previous frame (phosphor trails as walkers migrate)
          pFade.use().f('uDecay', 0.78).tex('uPrev', glow.read.tex, 0);
          glc.draw(pFade, glow.write);

          // 2. additively splat the walkers into the faded frame
          gl.bindFramebuffer(gl.FRAMEBUFFER, glow.write.fbo);
          gl.viewport(0, 0, glow.write.w, glow.write.h);
          pDeposit.use()
            .i('uDim', DIM).i('uN', n).f('uShape', shape)
            .f('uYaw', yaw).f('uTilt', tilt).f('uBreath', breath)
            .f('uSizeNorm', sizeNorm).f('uAspect', aspect).f('uPointBase', 2.0)
            .f('uKeyHue', keyHue).f('uShimmer', shimmer)
            .f('uColEnergy', 0.6 + f.harmonic * 0.8)
            .f('uBright', 0.05 * (0.7 + f.harmonic * 1.1 + f.level * 0.5) + collapse * 0.12);
          M.spectrumUniforms(pDeposit, audio, 3);
          pDeposit.tex('uParts', parts.read.tex, 0).bind();
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.bindVertexArray(depositVAO);
          gl.drawArrays(gl.POINTS, 0, DIM * DIM);
          gl.disable(gl.BLEND);
          glow.swap();

          // 3. bloom + composite
          bloom.render(glow.read.tex, glc.width, glc.height, 0.3);
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
