/* ORPHIC scene — VOCAL TRACT · resonant cavity
 * The voice is drawn as the instrument that makes it. A 2D acoustic wave
 * field (FDTD leapfrog of the scalar wave equation p'' = c²∇²p) rings inside
 * a tube shaped like the vocal tract: closed at the glottis (bottom), open at
 * the lips (top). A glottal pulse train at the live pitch drives the inlet;
 * its harmonics excite the cavity, and the tube's standing-wave resonances —
 * the formants — bloom as bright vertical lobes. The vowel reshapes the tube:
 * F2 (frontness) slides the constriction up/down the tract, F1 (openness)
 * relaxes the pinch and flares the lips, so /i/ and /a/ resonate as visibly
 * different bodies. Unvoiced sibilants inject turbulent noise at the
 * constriction (a hiss of speckle); silence lets the field damp to black.
 * The resonator floats in the old scene's salvaged ember field.
 *
 * GPU: ping-pong RGBA16F grid (p in R, previous p in G), a once-per-frame
 * baked cavity mask (air / damping / source / constriction), N leapfrog
 * substeps per frame. Local 5-point stencil — the project's Gray-Scott /
 * Stable Fluids pattern. Reflecting walls via masked (Neumann) neighbours.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const W = 224, H = 336;        // portrait sim grid (square cells, aspect 2:3)
  const SIM_ASPECT = W / H;
  const STEPS = 6;               // leapfrog substeps per frame
  const C2 = 0.45;               // (c·dt/dx)² — under the 0.5 2D CFL limit

  // bake the tract cavity once per frame: r=air, g=damping, b=glottal source,
  // a=constriction (noise-injection site). A vertical tube, pinched at the
  // vowel's constriction, closed at the glottis, radiating at the lips.
  const MASK_FRAG = M.FRAG_HEADER + `
  uniform float uConHeight, uConTight, uLipOpen, uRest;
  void main() {
    float x = vUV.x, y = vUV.y, cx = 0.5;
    float dC = y - uConHeight;
    float pinch = uConTight * exp(-dC * dC / (2.0 * 0.08 * 0.08));
    float flare = uLipOpen * smoothstep(0.62, 0.90, y);
    float hw = 0.17 * (1.0 - 0.62 * pinch) + 0.055 * flare;  // tube half-width
    // round both ends into a capsule: a soft glottis base, a domed lip opening
    float ends = smoothstep(0.05, 0.13, y) * smoothstep(0.985, 0.90, y);
    float dist = abs(x - cx);
    float e = 0.012;
    float air = (1.0 - smoothstep(hw - e, hw + e, dist)) * ends;
    // damping: a touch everywhere (decay to black on silence), more by the
    // outer walls, strong at the lips so the open end radiates away.
    // the baseline sets the interior ring-down — how long the field shimmers
    // after a kick — uniformly, so the standing-wave heights don't shift.
    float wall = smoothstep(hw - 0.05, hw, dist);
    float damp = 0.0030 + 0.020 * wall + 0.060 * smoothstep(0.88, 0.99, y) + uRest;
    // glottal source: a small inlet patch at bottom centre
    float src = exp(-dist * dist / (2.0 * 0.05 * 0.05))
              * exp(-pow((y - 0.10) / 0.05, 2.0));
    // constriction marker: where unvoiced turbulence is born
    float con = exp(-dC * dC / (2.0 * 0.05 * 0.05));
    fragColor = vec4(air, damp, src * air, con * air);
  }`;

  // one FDTD leapfrog step of the scalar wave equation, reflecting at walls
  const SIM_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform sampler2D uState, uMask;
  uniform vec2 uTexel, uRes;
  uniform float uSourceAmp, uNoiseAmp, uSeed;
  void main() {
    vec4 s = texture(uState, vUV);
    float p = s.r, pPrev = s.g;
    vec4 mk = texture(uMask, vUV);
    float air = mk.r;
    vec2 dx = vec2(uTexel.x, 0.0), dy = vec2(0.0, uTexel.y);
    // reflecting (Neumann) walls: a wall neighbour contributes the centre
    // value, so the gradient across it is zero and the wave bounces
    float pl = mix(p, texture(uState, vUV - dx).r, step(0.5, texture(uMask, vUV - dx).r));
    float pr = mix(p, texture(uState, vUV + dx).r, step(0.5, texture(uMask, vUV + dx).r));
    float pd = mix(p, texture(uState, vUV - dy).r, step(0.5, texture(uMask, vUV - dy).r));
    float pu = mix(p, texture(uState, vUV + dy).r, step(0.5, texture(uMask, vUV + dy).r));
    float lap = pl + pr + pd + pu - 4.0 * p;
    float pNext = 2.0 * p - pPrev + uC2 * lap;
    pNext *= (1.0 - mk.g);                                  // damping / radiation
    pNext += uSourceAmp * mk.b;                             // glottal drive
    pNext += uNoiseAmp * mk.a * (hash12(vUV * uRes + uSeed) * 2.0 - 1.0); // hiss
    pNext *= air;                                           // no field in walls
    fragColor = vec4(pNext, p * air, 0.0, 1.0);
  }`.replace('uC2', C2.toFixed(3));

  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + M.GLSL_EMBERS + `
  uniform sampler2D uState, uMask;
  uniform vec2 uRes, uTexel;
  uniform float uKeyHue, uLife;
  const float SA = ${SIM_ASPECT.toFixed(5)};
  vec3 cav(float t) { return pal(t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)); }
  void main() {
    float aspect = uRes.x / uRes.y;
    // ---- salvaged backdrop: deep-space gradient, nebula, rising embers ----
    vec3 col = mix(vec3(0.012, 0.010, 0.028), vec3(0.004, 0.004, 0.012), vUV.y);
    vec2 q = vec2(fbm(vUV * vec2(aspect, 1.0) * 2.6 + uTime * 0.015),
                  fbm(vUV * vec2(aspect, 1.0) * 2.6 - uTime * 0.020 + 7.3));
    float neb = fbm(vUV * vec2(aspect * 1.6, 2.8) + q * 0.9);
    col += cav(uKeyHue + 0.45 + neb * 0.18) * neb * neb * (0.10 + uLevel * 0.08);
    col += vec3(0.85, 0.9, 1.0) * embers(vUV, aspect, 42.0, 0.0, 0.06, 3.1) * 0.10;
    col += vec3(0.95, 0.9, 1.0) * embers(vUV, aspect, 21.0, 0.0, 0.04, 9.7) * 0.16;
    col += cav(uKeyHue + 0.08) * embers(vUV, aspect, 26.0, 0.045, 0.30, 1.7)
         * (uTreble * 0.9 + uOnset * 1.4 + 0.06) * 0.5;

    // ---- the resonator: centred portrait cavity, the rest is negative space
    vec2 P = vUV - 0.5; P.x *= aspect;
    const float H2 = 0.46;
    vec2 suv = vec2(P.x / (2.0 * H2 * SA), P.y / (2.0 * H2)) + 0.5;
    if (all(greaterThan(suv, vec2(0.0))) && all(lessThan(suv, vec2(1.0)))) {
      float p = texture(uState, suv).r;
      float air = texture(uMask, suv).r;
      float mag = abs(p);
      // pressure glow: compression vs rarefaction split the hue (Schlieren).
      // a quadratic response keeps the standing-wave nodes dark, so the lobes
      // breathe instead of fusing into solid discs
      float glow = mag * mag * 9.0 + mag * 0.8;
      vec3 body = cav(uKeyHue + sign(p) * 0.05 + p * 0.12) * glow;
      body += vec3(1.0, 0.97, 0.92) * smoothstep(0.28, 0.6, mag) * 0.6; // hot core
      // luminous membrane along the tube wall (gradient of the air mask)
      float ml = texture(uMask, suv - vec2(uTexel.x, 0.0)).r;
      float mr = texture(uMask, suv + vec2(uTexel.x, 0.0)).r;
      float mdn = texture(uMask, suv - vec2(0.0, uTexel.y)).r;
      float mup = texture(uMask, suv + vec2(0.0, uTexel.y)).r;
      float edge = length(vec2(mr - ml, mup - mdn));
      vec3 rim = cav(uKeyHue + 0.5) * edge * (0.20 + mag * 2.2);
      col += (body * air + rim) * uLife;
    }

    float v = length(vUV - 0.5);
    col *= 1.0 - v * v * 0.6;
    col = aces(col);
    col += (hash12(vUV * uRes + fract(uTime) * 311.0) - 0.5) * (3.0 / 255.0);
    fragColor = vec4(col, 1.0);
  }`;

  M.registerScene({
    name: 'vocal tract · resonant cavity',
    modes: ['speech'],
    create(glc) {
      const pMask = glc.program(MASK_FRAG);
      const pSim = glc.program(SIM_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const state = glc.pingpong(W, H, {});
      const maskT = glc.target(W, H, {});
      state.a.clear(0, 0, 0, 0);
      state.b.clear(0, 0, 0, 0);

      let keyHue = 0.55;
      let conHeight = 0.5, conTight = 0.6, lipOpen = 0.3;
      let glottPhase = 0;
      let life = 0.22;               // eased brightness — swells in, lingers out

      return {
        resize() {},
        update(dt, audio) {
          const f = audio.f;
          keyHue = M.chromaHue(f.chroma, keyHue, dt);

          // vowel articulation from the formants, eased for silky motion.
          // F2 (frontness): front vowels constrict high in the tract (near the
          // lips), back vowels low (the pharynx). F1 (openness): open vowels
          // relax the pinch and flare the lips.
          const k = 1 - Math.exp(-dt * 6);
          conHeight += ((0.30 + 0.48 * f.f2) - conHeight) * k;
          conTight  += ((0.60 - 0.40 * f.f1) - conTight) * k;
          lipOpen   += ((0.15 + 0.45 * f.f1) - lipOpen) * k;

          // rest: during sustained silence, damp the whole field harder so it
          // settles to black instead of shimmering on (active speech is untouched)
          pMask.use()
               .f('uConHeight', conHeight).f('uConTight', conTight).f('uLipOpen', lipOpen)
               .f('uRest', 0.006 * f.quiet);
          glc.draw(pMask, maskT);

          // leapfrog substeps, each advancing the glottal pulse train
          const dtSub = Math.min(dt, 1 / 30) / STEPS;
          const pitchHz = f.pitchHz > 0 ? f.pitchHz : 110;
          const duty = 0.35;
          for (let i = 0; i < STEPS; i++) {
            glottPhase = (glottPhase + pitchHz * dtSub) % 1;
            // zero-mean glottal pulse: a rich-harmonic inlet flow that rings
            // every tube resonance (the formants) rather than a single tone
            const pulse = (glottPhase < duty ? 1.0 : 0.0) - duty;
            // voiced gate with a deadzone: ignore marginal/lingering voicing, and
            // scale the drive by loudness so quiet passages stop humming the cavity.
            // the old always-on 0.16 floor is gone — silence no longer fires.
            const vg = Math.max(0, Math.min(1, (f.voiced - 0.38) / 0.30));
            const gate = vg * vg * (3 - 2 * vg);
            let src = pulse * (0.03 + 0.58 * f.level) * gate;
            if (i === 0) src += f.onset * 0.5 + f.burst * 0.8; // consonant/return puff
            // unvoiced turbulence: sibilant hiss born at the constriction
            const noise = (0.10 + 0.5 * f.flux) * Math.max(0, 1 - f.voiced)
                        * (0.4 + f.treble * 0.9 + f.flatness * 0.6);
            pSim.use()
                .v2('uTexel', 1 / W, 1 / H).v2('uRes', W, H)
                .f('uSourceAmp', src).f('uNoiseAmp', noise)
                .f('uSeed', (glottPhase * 9173 + i * 131) % 1000)
                .tex('uState', state.read.tex, 0).tex('uMask', maskT.tex, 1);
            glc.draw(pSim, state.write);
            state.swap();
          }

          // ease brightness toward its target: rise readily, fall slowly, so the
          // body breathes instead of flashing on every onset (asymmetric attack)
          const lifeTarget = Math.min(2.0, 0.22 + f.voiced * 1.0 + f.level * 0.6
                              + f.onset * 0.6 + f.burst * 1.2) * (1 - f.quiet * 0.6);
          const lk = 1 - Math.exp(-dt * (lifeTarget > life ? 7 : 2.5));
          life += (lifeTarget - life) * lk;
        },
        render(out, audio, t) {
          pShow.use()
               .tex('uState', state.read.tex, 0).tex('uMask', maskT.tex, 1)
               .v2('uRes', glc.width, glc.height).v2('uTexel', 1 / W, 1 / H)
               .f('uKeyHue', keyHue).f('uLife', life);
          M.audioUniforms(pShow, audio, t);
          glc.draw(pShow, out);
        },
        dispose() {
          state.dispose();
          maskT.dispose();
          for (const p of [pMask, pSim, pShow]) p.dispose();
        },
      };
    },
  });
})();
