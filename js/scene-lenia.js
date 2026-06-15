/* ORPHIC scene — LENIA · alien garden
 * Bert Chan's continuous cellular automaton (Lenia, 2019) — Game of Life
 * generalized to continuous space/time/state. A ring-shaped convolution
 * kernel feeds a gaussian growth bell; at the canonical Orbium parameters
 * (R=13, mu=0.15, sigma=0.015, T=10) a specific seed becomes a *glider* —
 * a coherent creature that travels across the dish.
 *
 * The whole scene is built on those gliders. Random "soup" at these
 * parameters only ever condenses into a static carpet of spots or a frozen
 * labyrinth — beautiful for a frame, dead for a minute. So instead of
 * seeding noise we stamp the real Orbium pattern, a handful of creatures on
 * a black field, each gliding in its own direction. They drift, collide,
 * merge and die; the music sows new ones.
 *
 * The dish stays mostly black (negative space) for free, because we never
 * try to fill it. A motion-aware containment keeps it that way: a slow
 * per-cell exposure average erodes anything that sits still (the carpet
 * attractor), while a moving creature — transient at every cell it crosses —
 * is spared. The only things that persist are the things that travel.
 *
 * Audio: level sets the glide clock, beats and onsets birth fresh orbia
 * along a precessing ring, a burst floods a centre flock, bass pumps the
 * light, treble electrifies the membranes. Quiet nearly freezes the dish
 * into a calm aquarium.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;

  const R = 13;        // kernel radius in cells — the native Orbium scale
  const SIM_DIV = 8;   // sim grid = screen / SIM_DIV; bigger ⇒ larger creatures

  // Canonical Orbium unicaudatus (Chakazul/Lenia animals.json, decoded). A
  // 20×20 patch of cell densities; stamped at native scale so it matches the
  // R=13 dynamics exactly and glides instead of dissolving.
  const ORB_W = 20, ORB_H = 20;
  const ORBIUM = [
    0,0,0,0,0,0,0,.051,.016,0,0,0,0,0,0,.235,0,0,0,0,
    0,0,0,0,0,0,.137,.208,.212,.082,.071,.098,.102,.071,.004,.255,0,0,0,0,
    0,0,0,0,0,.086,.267,.357,.384,.341,.188,.184,.173,.184,.176,.106,.349,0,0,0,
    0,0,0,0,.012,.067,.349,.455,.467,.38,.129,.078,.055,.063,.122,.216,.706,0,0,0,
    0,0,0,.035,.129,.184,.341,.404,.384,.282,.133,0,0,0,0,.047,.4,.329,0,0,
    .004,0,.016,.137,.169,.133,.11,.247,.271,.263,.208,0,0,0,0,0,.02,.863,0,0,
    .235,0,.102,.173,.078,0,0,.2,.31,.369,.373,.239,0,0,0,0,0,.455,.157,0,
    0,.122,.184,.11,0,0,0,.271,.427,.506,.537,.51,0,0,0,0,0,0,.518,0,
    0,.588,.216,.031,0,0,0,.188,.529,.635,.682,.682,.42,0,0,0,0,0,.427,0,
    0,.553,.235,0,0,0,0,.027,.62,.757,.839,.855,.808,.106,0,0,0,0,.282,.098,
    0,0,.596,0,0,0,0,0,.667,.875,.961,.992,.973,.561,0,0,0,0,.224,.141,
    0,0,.839,0,0,0,0,0,.506,.969,1,1,1,.914,.278,0,0,.024,.22,.133,
    0,0,.553,.075,0,0,0,0,.333,1,1,.98,1,.973,.557,.157,.051,.118,.243,.086,
    0,0,.031,.447,0,0,0,0,.176,.851,1,.894,.863,.867,.651,.333,.196,.216,.231,.039,
    0,0,0,.424,.114,0,0,0,.114,.62,.878,.824,.78,.741,.612,.408,.294,.267,.165,0,
    0,0,0,.078,.333,.075,0,0,.118,.424,.675,.722,.678,.627,.525,.404,.31,.224,.063,0,
    0,0,0,0,.165,.259,.149,.118,.173,.337,.498,.557,.545,.498,.427,.337,.243,.118,0,0,
    0,0,0,0,0,.145,.231,.235,.259,.318,.388,.424,.412,.361,.306,.227,.125,.02,0,0,
    0,0,0,0,0,0,.071,.169,.227,.251,.275,.278,.259,.231,.165,.094,.02,0,0,0,
    0,0,0,0,0,0,0,0,.059,.102,.129,.133,.118,.078,.043,0,0,0,0,0,
  ];

  // Lenia step. State packs A (life) in r and the convolution potential u in
  // g. At mu=0.15/sigma=0.015 the rule wants to fill the dish with budding
  // creatures that run away to a static carpet — so a drifting erosion "wind"
  // (broad inhibition fronts that flow across the dish) keeps carving life
  // back into the void, and a global mu brake (driven from coverage on the
  // CPU) firmly caps the runaway. Together they hold a sparse band of a few
  // big organisms on deep black.
  const SIM_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uState;
  uniform sampler2D uDensity;          // coarse local coverage field
  uniform vec2 uTexel;
  uniform float uMu, uSigma, uDtL, uHab, uKillOut, uDensLo, uDensHi, uGlobalEro;
  const int R = ${R};
  void main() {
    vec3 s = texture(uState, vUV).rgb;
    float A = s.r;

    // ring-kernel convolution (gaussian shell at r=0.5, width 0.15)
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
    // gentle LOCAL throttle: ease *growth* (never decay) down only where the
    // wide NEIGHBOURHOOD is already very crowded, so structures keep open,
    // mazey interiors instead of packing into solid lumps. It is permissive on
    // purpose — clashing creatures must still be able to merge and grow (that's
    // the whole point); the real anti-carpet guard is the global backstop below.
    float localDens = texture(uDensity, vUV).r;
    float throttle = smoothstep(uDensLo, uDensHi, localDens);
    if (growth > 0.0) growth *= 1.0 - throttle;
    A = clamp(A + uDtL * growth, 0.0, 1.0);

    // drifting habitat: life is only permitted inside slow-flowing continents;
    // everywhere else a strong inhibition keeps the void black. The continents
    // drift, so creatures bloom at a leading edge and dissolve at a trailing
    // edge — the dish is forever ebbing and the black negative space dominates.
    float habn = fbm(vUV * vec2(2.2, 1.8) + vec2(uPhaseLevel * 0.06, uPhaseBass * 0.035));
    // centre bias: life is harder to sustain toward the frame edges, so the
    // composition keeps a black margin and creatures never clip off-screen.
    float rad = length((vUV - 0.5) * vec2(1.7, 1.0));
    float habThr = uHab + smoothstep(0.42, 0.92, rad) * 0.26;
    float kill = smoothstep(habThr, habThr - 0.13, habn);
    A = clamp(A - kill * uKillOut * uDtL, 0.0, 1.0);

    // global backstop: a carpet can never hold. Only above a ceiling coverage
    // does the CPU raise uGlobalEro, biting the densest tissue (high u) until
    // the dish relents — rare, since normal clash-blooms sit well below it.
    A = clamp(A - uGlobalEro * smoothstep(0.08, 0.16, u) * uDtL, 0.0, 1.0);

    fragColor = vec4(A, u, 0.0, 1.0);
  }`;

  // Stamp the Orbium texture into the field at a position, angle and amount
  // (negative carves). Works in cell space so rotations stay rigid; cells are
  // square (gw,gh both = screen/SIM_DIV) so no aspect correction is needed.
  const STAMP_FRAG = M.FRAG_HEADER + `
  uniform sampler2D uState;
  uniform sampler2D uOrb;
  uniform vec2 uGrid;        // sim grid size in cells
  uniform vec2 uPos;         // stamp centre (uv)
  uniform float uAngle, uScale, uAmt;
  void main() {
    vec3 s = texture(uState, vUV).rgb;
    vec2 off = (vUV - uPos) * uGrid;                 // offset in cells
    float c = cos(uAngle), sn = sin(uAngle);
    vec2 rc = mat2(c, -sn, sn, c) * off;             // rotate into orbium frame
    vec2 luv = rc / (vec2(${ORB_W}.0, ${ORB_H}.0) * uScale) + 0.5;
    float add = 0.0;
    if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0)
      add = texture(uOrb, luv).r * uAmt;
    float A = uAmt >= 0.0 ? max(s.r, add) : clamp(s.r + add, 0.0, 1.0);
    fragColor = vec4(A, s.g, s.b, 1.0);
  }`;

  // 4×4 mass probe: fraction of cells alive, read back to gate spawning
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

  // local-density field: at each (coarse) texel, average A over a fixed-size
  // neighbourhood (~2× a creature). Sampled by the sim for a *local* carrying
  // capacity. The neighbourhood is wider than one creature, so a lone creature
  // reads low (and is spared) while a packed carpet reads high (and is capped).
  const DENS_FRAG = M.FRAG_HEADER + `
  uniform sampler2D uState;
  const float STEP = 0.038;            // window ~3-4× a creature, so a lone
  void main() {                        // creature reads low, a carpet reads high
    float sum = 0.0;
    for (int y = -4; y <= 4; y++)
      for (int x = -4; x <= 4; x++)
        sum += texture(uState, vUV + vec2(float(x), float(y)) * STEP).r;
    fragColor = vec4(sum / 81.0);
  }`;

  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uState;
  uniform vec2 uTexel;
  void main() {
    vec3 st = texture(uState, vUV).rgb;
    float A = st.r, u = st.g;
    float Ax = texture(uState, vUV + vec2(uTexel.x, 0.0)).r - texture(uState, vUV - vec2(uTexel.x, 0.0)).r;
    float Ay = texture(uState, vUV + vec2(0.0, uTexel.y)).r - texture(uState, vUV - vec2(0.0, uTexel.y)).r;
    vec3 n = normalize(vec3(-Ax * 5.0, -Ay * 5.0, 1.0));
    float diff = max(dot(n, normalize(vec3(0.4, 0.5, 0.85))), 0.0);

    // body: interior potential tints the organism; centroid sweeps the hue
    float hue = 0.55 + u * 0.28 + uCentroid * 0.16 + uPhaseLevel * 0.012;
    vec3 body = pal(hue, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
    float grad = length(vec2(Ax, Ay));
    float rim = smoothstep(0.02, 0.3, grad);

    vec3 col = body * A * (0.35 + diff * 0.95);
    col += body * rim * (0.7 + uTreble * 1.6);              // electric membrane
    col += vec3(0.9, 1.0, 0.97) * smoothstep(0.7, 1.0, A) * 0.25; // hot core
    col *= 1.0 + uBass * 0.45;                              // bass pumps the light
    col += col * uBeat * 0.3;                               // beat pop
    col *= 1.0 - uQuiet * 0.45;                             // rests dim the garden
    col *= 1.0 + uBurst * 0.6;                              // the return floods it

    // a deep, faintly cool void so the negative space reads as real depth
    float d = length(vUV - 0.5);
    vec3 bg = vec3(0.006, 0.010, 0.022) * (1.0 - d * 0.5);
    col += bg * (1.0 - A);
    col *= 1.0 - d * d * 0.7;                               // vignette
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'lenia · alien garden',
    modes: ['music', 'speech', 'ambient'],
    create(glc) {
      const gl = glc.gl;
      let state = null;
      const pSim = glc.program(SIM_FRAG);
      const pStamp = glc.program(STAMP_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const pCover = glc.program(COVER_FRAG);
      const pDens = glc.program(DENS_FRAG);
      const coverT = glc.target(4, 4);
      let densT = null; // coarse local-density field, ~sim/6
      const coverBuf = new Float32Array(64);

      // upload Orbium as an 8-bit luminance patch (values 0..1 → 0..255)
      const orbTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, orbTex);
      const orbBytes = new Uint8Array(ORB_W * ORB_H * 4);
      for (let i = 0; i < ORB_W * ORB_H; i++) orbBytes[i * 4] = Math.round(ORBIUM[i] * 255);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ORB_W, ORB_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, orbBytes);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      let beatCount = 0, spawnTimer = 0, coverTimer = 0, resizeDebounce = 0;
      let mass = 0.06, massRaw = -1, uHab = 0.55; // alive-fraction + habitat thr

      // place one Orbium at a uv position, given orientation, ±amount
      function stamp(x, y, angle, scale, amt) {
        pStamp.use()
          .v2('uGrid', state.read.w, state.read.h)
          .v2('uPos', x, y).f('uAngle', angle).f('uScale', scale).f('uAmt', amt)
          .tex('uState', state.read.tex, 0).tex('uOrb', orbTex, 1);
        glc.draw(pStamp, state.write);
        state.swap();
      }

      function rand(a, b) { return a + Math.random() * (b - a); }

      // a fresh dish: a few well-spread orbia gliding in random directions
      function seed() {
        state.read.clear(0, 0, 0, 1);
        state.write.clear(0, 0, 0, 1);
        const n = 5 + (Math.random() * 3 | 0);
        for (let i = 0; i < n; i++)
          stamp(rand(0.15, 0.85), rand(0.15, 0.85), rand(0, 6.2832), 1.0, 0.95);
      }

      function probeMass() {
        if (!glc.floatOK) return;
        pCover.use().tex('uState', state.read.tex, 0);
        glc.draw(pCover, coverT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, coverT.fbo);
        gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.FLOAT, coverBuf);
        let c = 0;
        for (let i = 0; i < 16; i++) c += coverBuf[i * 4];
        massRaw = c / 16;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      return {
        resize(w, h) {
          const sw = Math.max(2, Math.round(w / SIM_DIV));
          const sh = Math.max(2, Math.round(h / SIM_DIV));
          const dw = Math.max(4, Math.round(sw / 6)), dh = Math.max(4, Math.round(sh / 6));
          if (!densT) densT = glc.target(dw, dh); else densT.resize(dw, dh);
          if (!state) { state = glc.pingpong(sw, sh, { repeat: true }); seed(); }
          else { state.resize(sw, sh); resizeDebounce = 0.35; }
        },

        update(dt, audio, t) {
          if (!state) return;
          const f = audio.f;

          if (resizeDebounce > 0 && (resizeDebounce -= dt) <= 0) seed();

          coverTimer += dt;
          if (coverTimer >= 0.4) { coverTimer = 0; probeMass(); }
          if (massRaw >= 0) mass += (massRaw - mass) * (1 - Math.exp(-dt / 0.6));

          // the life clock: louder ⇒ faster, rests nearly freeze it. Kept near
          // the native T=10 (dt≈0.1) so the creatures stay coherent.
          const dtL = (0.075 + f.level * 0.05) * (1 - f.quiet * 0.7);

          // The rule wants to fill to a static carpet (~0.31). Two cooperating
          // limiters keep it sparse instead, neither of which fights existing
          // life (so no boom/bust). 1) The habitat threshold: a FIXED, slowly
          // breathing field — no feedback loop to oscillate — that just sets
          // how much of the dish is habitable (a rest tightens it, loud music
          // opens it a touch).
          uHab = 0.30 + 0.03 * Math.sin(f.phaseLevel * 0.11)
               + f.quiet * 0.08 - f.level * 0.03;
          // 2) A gentle LOCAL throttle keeps any one neighbourhood from packing
          // solid, but is permissive enough that creatures still clash and merge
          // into growing chains (the whole point). densLo/densHi ramp the local
          // throttle; set high so merging is allowed.
          const densLo = 0.105 - f.quiet * 0.020;

          // 3) A global backstop ONLY above a ceiling — guarantees the rare
          // runaway can never lock into a full carpet, without touching the
          // normal clash-blooms that live well below it.
          const globalEro = Math.max(0, mass - 0.15) * 9.0;

          // births ride the beat — and each one sows a PAIR of orbia right next
          // to each other so they immediately clash and grow something. The pair
          // drifts around a golden-angle ring at a small radius so successive
          // clashes happen all over the centred zone. A burst floods a flock; a
          // near-dead dish gets a lifeline.
          const floor = 0.030, cap = 0.16;
          spawnTimer += dt;
          const onBeat = f.beat > 0.9 || (f.onset > 0.9 && f.voiced > 0.4);

          if (f.burst === 1) {
            for (let i = 0; i < 5; i++) {
              const a = i * 1.2566 + rand(-0.3, 0.3);
              stamp(0.5 + Math.cos(a) * 0.11, 0.5 + Math.sin(a) * 0.11, a, 1.0, 0.95);
            }
            spawnTimer = 0;
          } else if (mass < floor && spawnTimer > 0.5) {
            stamp(rand(0.3, 0.7), rand(0.3, 0.7), rand(0, 6.2832), 1.0, 0.95);
            spawnTimer = 0;
          } else if (onBeat && mass < cap && spawnTimer > 0.22) {
            beatCount++;
            const ang = beatCount * 2.399963;
            const r = rand(0.05, 0.20) * (0.6 + 0.4 * Math.sin(f.phaseLevel * 0.09));
            const px = 0.5 + Math.cos(ang) * r, py = 0.5 + Math.sin(ang) * r * 0.8;
            // a clashing pair, set ~one creature-width apart at opposed headings
            const sep = 0.05, pa = rand(0, 6.2832);
            stamp(px + Math.cos(pa) * sep, py + Math.sin(pa) * sep, pa, 1.0, 0.92);
            stamp(px - Math.cos(pa) * sep, py - Math.sin(pa) * sep, pa + 3.14159, 1.0, 0.92);
            spawnTimer = 0;
          }
          // refresh the local-density field from the current state
          pDens.use().tex('uState', state.read.tex, 0);
          glc.draw(pDens, densT);

          pSim.use();
          M.audioUniforms(pSim, audio, t);
          pSim.v2('uTexel', 1 / state.read.w, 1 / state.read.h)
              .f('uMu', 0.15).f('uSigma', 0.015).f('uDtL', dtL)
              .f('uHab', uHab).f('uKillOut', 1.5)
              .f('uDensLo', densLo).f('uDensHi', densLo + 0.085).f('uGlobalEro', globalEro)
              .tex('uState', state.read.tex, 0).tex('uDensity', densT.tex, 1);
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

        dispose() {
          if (state) state.dispose();
          if (densT) densT.dispose();
          coverT.dispose();
          gl.deleteTexture(orbTex);
          for (const p of [pSim, pStamp, pShow, pCover, pDens]) p.dispose();
        },
      };
    },
  });
})();
