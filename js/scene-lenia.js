/* ORPHIC scene — LENIA · alien garden
 * Bert Chan's continuous cellular automaton (Lenia, 2019) — Game of Life
 * generalized to continuous space/time/state. A ring-shaped convolution
 * kernel feeds a gaussian growth function; lifeforms bloom, glide and
 * dissolve. Audio: bass shifts the growth optimum (denser growth), spectral
 * centroid widens growth tolerance, level speeds up time, beats sow new
 * organisms along a precessing ring — or carve them away when the dish is
 * crowded. A slow tide moves the homeostasis target itself between sparse
 * and lush, so the garden perpetually pushes out and pulls back. Periodic
 * reseeding keeps it from going extinct.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;

  const R = 13; // kernel radius in cells — with the 1/7 sim grid this sets creature size

  const SIM_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uState;
  uniform vec2 uTexel;
  uniform float uMu, uSigma, uDtL, uErosion;
  uniform vec4 uSplat; // xy pos, z radius(uv), w amount (negative = carve)
  const int R = ${R};
  void main() {
    float A = texture(uState, vUV).r;

    // ring kernel convolution
    float sum = 0.0, wsum = 0.0;
    for (int y = -R; y <= R; y++) {
      for (int x = -R; x <= R; x++) {
        float r = length(vec2(x, y)) / float(R);
        if (r > 1.0 || r < 1e-5) continue;
        float w = exp(-pow((r - 0.5) / 0.15, 2.0) * 0.5);
        sum += texture(uState, vUV + vec2(x, y) * uTexel).r * w;
        wsum += w;
      }
    }
    float u = sum / wsum;

    float growth = 2.0 * exp(-pow((u - uMu) / uSigma, 2.0) * 0.5) - 1.0;
    A = clamp(A + uDtL * growth, 0.0, 1.0);

    // drifting erosion wind: broad inhibition fronts that keep carving the
    // garden into moving continents of life and void — a "full" dish is
    // impossible, it must keep regrowing behind the wind forever
    float wind = smoothstep(0.52, 0.80,
        vnoise(vUV * vec2(2.2, 1.8) + vec2(uPhaseLevel * 0.14, uPhaseBass * 0.08)));
    A = clamp(A - uErosion * wind * uDtL, 0.0, 1.0);

    if (uSplat.w != 0.0) {
      vec2 d = (vUV - uSplat.xy) * vec2(uTexel.y / uTexel.x, 1.0);
      float blob = exp(-dot(d, d) / (uSplat.z * uSplat.z));
      // noisy blob — Lenia needs structure, not flat discs
      A = clamp(A + uSplat.w * blob * (0.4 + 0.6 * vnoise(vUV * 100.0)), 0.0, 1.0);
    }
    fragColor = vec4(A, u, 0.0, 1.0);
  }`;

  const INIT_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform float uSeed;
  void main() {
    float A = 0.0;
    for (int i = 0; i < 16; i++) {
      vec2 p = hash22(vec2(float(i) * 13.7, uSeed));
      p = p * 0.8 + 0.1;
      float d = length(vUV - p);
      if (d < 0.10) A = max(A, vnoise(vUV * 110.0 + uSeed) * 0.6 * smoothstep(0.10, 0.03, d));
    }
    fragColor = vec4(A, 0.0, 0.0, 1.0);
  }`;

  // 4×4 coverage probe: each pixel averages an 8×8 grid of its region,
  // read back to the CPU for the homeostasis loop
  const COVER_FRAG = M.FRAG_HEADER + `
  uniform sampler2D uState;
  void main() {
    vec2 base = floor(gl_FragCoord.xy) / 4.0;
    float sum = 0.0;
    for (int y = 0; y < 8; y++)
      for (int x = 0; x < 8; x++)
        sum += step(0.12, texture(uState, base + (vec2(x, y) + 0.5) / 32.0).r);
    fragColor = vec4(sum / 64.0);
  }`;

  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uState;
  uniform vec2 uTexel;
  void main() {
    vec2 s = texture(uState, vUV).rg;
    float A = s.r, u = s.g;
    float Ax = texture(uState, vUV + vec2(uTexel.x, 0.0)).r - texture(uState, vUV - vec2(uTexel.x, 0.0)).r;
    float Ay = texture(uState, vUV + vec2(0.0, uTexel.y)).r - texture(uState, vUV - vec2(0.0, uTexel.y)).r;
    vec3 n = normalize(vec3(-Ax * 5.0, -Ay * 5.0, 1.0));
    float diff = max(dot(n, normalize(vec3(0.4, 0.5, 0.85))), 0.0);

    // body: potential u tints the interior — organs glow where growth is active
    float hue = 0.48 + u * 0.30 + uCentroid * 0.15 + uPhaseLevel * 0.010;
    vec3 body = pal(hue, vec3(0.45), vec3(0.5), vec3(1.0), vec3(0.0, 0.3, 0.65));
    float rim = smoothstep(0.02, 0.3, length(vec2(Ax, Ay)));
    vec3 col = body * A * (0.3 + diff * 0.9);
    col += body * rim * (0.6 + uTreble * 1.4);          // electric membrane
    col += vec3(0.9, 1.0, 0.95) * smoothstep(0.75, 1.0, A) * 0.22;
    col += col * uBeat * 0.25;
    col *= 1.0 - uQuiet * 0.4;   // rests dim the garden
    col *= 1.0 + uBurst * 0.5;   // the return floods it with light
    vec3 bg = vec3(0.008, 0.012, 0.025);
    col += bg * (1.0 - A);
    float d = length(vUV - 0.5);
    col *= 1.0 - d * d * 0.85;
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'lenia · alien garden',
    modes: ['music', 'speech', 'ambient'],
    create(glc) {
      let state = null;
      const pSim = glc.program(SIM_FRAG);
      const pInit = glc.program(INIT_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const pCover = glc.program(COVER_FRAG);
      const coverT = glc.target(4, 4);
      const coverBuf = new Float32Array(64);
      let beatCount = 0, reseedTimer = 0, coverTimer = 0;
      // covSmooth starts low so the establishment shield (gentle regime, no
      // erosion) covers the young colony until real probe readings arrive
      let muBias = 0, covOver = 0, covUnder = 0, covSmooth = 0.15, covRaw = -1; // homeostasis state
      let covVel = 0, covPrev = 0.15, deadT = 0; // collapse detection
      const splat = { x: 0.5, y: 0.5, r: 0, amt: 0 };

      function seed() {
        // warm-up survival is luck-of-the-draw (the blob boundary has to
        // carve viable rings before the interior dies), so verify the dish
        // came out alive and redraw the lottery if not — a dead start used
        // to mean a black screen with flashing reseeds for many seconds
        for (let attempt = 0; attempt < 4; attempt++) {
          pInit.use().f('uSeed', Math.random() * 100);
          glc.draw(pInit, state.read);
          for (let i = 0; i < 100; i++) {
            // anneal sigma wide→native: a wide growth zone accepts whatever
            // density the noisy seed lands at (the native zone is ±0.015 —
            // a knife edge no seed amplitude reliably hits), then tightens
            // so the blobs differentiate into creatures
            const sg = 0.030 - 0.0155 * Math.min(1, i / 60);
            pSim.use()
                .v2('uTexel', 1 / state.read.w, 1 / state.read.h)
                .f('uMu', 0.140).f('uSigma', sg).f('uDtL', 0.22)
                .f('uErosion', 0).v4('uSplat', 0, 0, 0, 0)
                .tex('uState', state.read.tex, 0);
            glc.draw(pSim, state.write);
            state.swap();
          }
          pCover.use().tex('uState', state.read.tex, 0);
          glc.draw(pCover, coverT);
          const gl = glc.gl;
          gl.bindFramebuffer(gl.FRAMEBUFFER, coverT.fbo);
          let cov = 1; // if readback is unsupported, accept the attempt
          try {
            gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.FLOAT, coverBuf);
            cov = 0;
            for (let i = 0; i < 16; i++) cov += coverBuf[i * 4];
            cov /= 16;
          } catch (e) { /* run unverified */ }
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          if (cov > 0.08) break;
        }
      }

      // homeostasis: measure coverage (~every 0.6s), smooth it heavily, and
      // steer toward the tide's target density. Lenia answers over seconds,
      // so the controller is damped — but it must out-muscle the bass push
      // on mu (+0.014) and the breathing sine (+0.014), or a loud song parks
      // the dish at full coverage forever (hence the -0.05 clamp).
      function homeostasis(dt, target) {
        coverTimer += dt;
        if (coverTimer >= 0.6) {
          coverTimer = 0;
          pCover.use().tex('uState', state.read.tex, 0);
          glc.draw(pCover, coverT);
          const gl = glc.gl;
          gl.bindFramebuffer(gl.FRAMEBUFFER, coverT.fbo);
          try {
            gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.FLOAT, coverBuf);
            let cov = 0;
            for (let i = 0; i < 16; i++) cov += coverBuf[i * 4];
            covRaw = cov / 16;
          } catch (e) { /* float readback unsupported — run unregulated */ }
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        if (covRaw < 0) return;
        covSmooth += (covRaw - covSmooth) * (1 - Math.exp(-dt / 2.5));
        covVel += ((covSmooth - covPrev) / Math.max(dt, 1e-3) - covVel) * (1 - Math.exp(-dt / 1.0));
        covPrev = covSmooth;
        let err = covSmooth - target;
        err = Math.abs(err) < 0.025 ? 0 : err - Math.sign(err) * 0.025;
        // over target: lower mu, gently — the patchy erosion wind does the
        // visible carving (shed a positive lift much faster: releasing is
        // not pulling). Under target: raise mu toward a small lift — an
        // ESTABLISHED colony packs denser at higher mu, which is the only
        // way past the rule's natural ~0.33 saturation toward "almost full".
        // A sparse colony dies at higher mu (u can't reach it), so the lift
        // is only allowed above 0.24 and forced off when starving.
        const lift = covSmooth > 0.24 ? 0.026 : 0;
        // shallow mu clamp: the global pull only trims — the spatial work of
        // the retreat belongs to the erosion wind (covOver below), which
        // carves continents and voids instead of thinning uniformly
        if (err > 0) muBias = Math.max(-0.028, muBias - err * dt * (muBias > 0 ? 0.10 : 0.075));
        else if (muBias > 0 && covVel < -0.015) {
          // release valve: coverage falling while lifted means the lift is
          // outrunning what the colony can densify to — holding it because
          // "we're under target" is the death spiral that killed the dish
          muBias = Math.max(0, muBias - dt * 0.10);
        } else if (err < 0) muBias = Math.min(lift, muBias - err * dt * 0.080);
        if (covSmooth < 0.15) muBias = Math.min(0, muBias + dt * 0.06); // never let it die
        covOver += ((err > 0 ? err : 0) - covOver) * (1 - Math.exp(-dt / 2.0));
        covUnder += ((err < 0 ? -err : 0) - covUnder) * (1 - Math.exp(-dt / 2.0));
      }

      return {
        resize(w, h) {
          // coarse grid: creatures span ~2R cells, so 1/7 of the screen makes
          // them big, visible organisms (and the convolution 3x cheaper)
          const sw = Math.max(2, Math.round(w / 7)), sh = Math.max(2, Math.round(h / 7));
          if (!state) state = glc.pingpong(sw, sh, { repeat: true });
          else { state.a.resize(sw, sh); state.b.resize(sw, sh); }
          seed();
        },
        update(dt, audio, t) {
          if (!state) return;
          const f = audio.f;

          // the tide: the density target swings between sparse and lush over
          // ~25s of loud music (slower when quiet). Probe units undercount
          // what the eye sees — 0.50 already reads ~80% full, 0.18 ~20%
          const tide = 0.32 + 0.18 * Math.sin(f.phaseLevel * 0.16);
          homeostasis(dt, tide);

          // dead-man's watchdog: empty for 4s despite the lifeline means the
          // dish is unrecoverable by splats alone — redo the verified seed
          deadT = covSmooth < 0.05 ? deadT + dt : 0;
          if (deadT > 4) {
            deadT = 0;
            seed();
            covSmooth = 0.15; covPrev = 0.15; covRaw = -1;
            covVel = 0; muBias = 0; covOver = 0; covUnder = 0;
          }

          // establishment: a young colony (probe < ~0.22) gets the textbook
          // regime — music swings on mu/sigma can kill fresh blobs, which
          // reads as a black screen with flashes. Modulation fades in as the
          // colony takes hold.
          const est = Math.max(0, Math.min(1, (covSmooth - 0.10) / 0.12));
          const mu = 0.138 + est * (0.014 * Math.sin(f.phaseLevel * 0.21)
                   + f.bass * 0.014 - f.treble * 0.008) + muBias;
          const sigma = 0.0145 + est * (0.0030 * Math.sin(f.phaseBass * 0.16 + 1.0)
                      + f.centroid * 0.005 + audio.c.speechProb * 0.004);
          // rests nearly freeze time — the garden holds its breath
          // (slightly slower clock overall: the colony should creep, not flood)
          const dtL = (0.09 + f.level * 0.12) * (1 - f.quiet * 0.85);

          splat.amt = 0;
          reseedTimer += dt;
          if (f.burst === 1) {
            // music returns: a big bloom erupts dead centre
            splat.x = 0.5; splat.y = 0.5;
            splat.r = 0.11;
            splat.amt = 0.9;
            reseedTimer = 0;
          } else if (f.beat > 0.9 || (f.onset > 0.9 && f.voiced > 0.4)) {
            beatCount++;
            const ang = beatCount * 2.399963;
            splat.x = 0.5 + Math.cos(ang) * 0.28;
            splat.y = 0.5 + Math.sin(ang) * 0.28;
            // blob viability scales with the kernel: below ~2R cells (~0.08
            // uv on the 1/7 grid) a sown blob just flashes and dies
            splat.r = 0.08 + f.bass * 0.05;
            // beats carve craters when the dish is over the tide's target,
            // sow when under — the push and pull rides the music itself.
            // Every third beat carves too, but never near the 20% floor.
            const crowded = covSmooth > tide + 0.10;
            splat.amt = ((beatCount % 3 === 2 && covSmooth > 0.25) || crowded) ? -0.9 : 0.5;
            reseedTimer = 0;
          } else if (reseedTimer > 7 || (covSmooth < 0.15 && reseedTimer > 1.0)) {
            // extinction insurance — and a fast lifeline when the dish is
            // starving, so "black screen with blobs" never lingers
            splat.x = 0.15 + Math.random() * 0.7;
            splat.y = 0.15 + Math.random() * 0.7;
            splat.r = 0.10; // must be kernel-viable or the lifeline is a lie
            splat.amt = 0.5; // near the growth optimum, not far above it
            reseedTimer = 0;
          }

          // resistance grows with the colony: erosion scales with coverage
          // (logistic deceleration — fast early creep, hard fight near full),
          // slams in above the ~80%-visual ceiling, and is gated off entirely
          // near the 20% floor so the battle never collapses to black
          // (covUnder eases the resistance off when the tide invites growth —
          // mu can only suppress, so without relief the colony never climbs)
          const ceiling = Math.max(0, covSmooth - 0.52);
          const floorGate = Math.max(0, Math.min(1, (covSmooth - 0.12) / 0.08));
          const erosion = floorGate * Math.max(0, 0.05 + covSmooth * 0.22
              + f.percussive * 0.08 + covOver * 1.6 + ceiling * 2.0
              - covUnder * 0.8);

          pSim.use();
          M.audioUniforms(pSim, audio, t);
          pSim.v2('uTexel', 1 / state.read.w, 1 / state.read.h)
              .f('uMu', mu).f('uSigma', sigma).f('uDtL', dtL)
              .f('uErosion', erosion)
              .v4('uSplat', splat.x, splat.y, splat.r, splat.amt)
              .tex('uState', state.read.tex, 0);
          glc.draw(pSim, state.write);
          state.swap();
        },
        render(out, audio, t) {
          if (!state) return;
          pShow.use()
            .v2('uTexel', 1 / state.read.w, 1 / state.read.h)
            .tex('uState', state.read.tex, 0);
          M.audioUniforms(pShow, audio, t);
          glc.draw(pShow, out);
        },
        dispose() { if (state) state.dispose(); coverT.dispose(); },
      };
    },
  });
})();
