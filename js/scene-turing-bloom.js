/* ORPHIC scene — REACTION-DIFFUSION · turing bloom
 * Gray-Scott (Pearson 1993 / Karl Sims) on a half-res float grid, 13 sim
 * steps/frame (8 when quiet). The trick that keeps it alive: feed & kill are
 * not one global pair but a SPATIAL FIELD — a slowly drifting fbm carves the
 * screen into continents of living tissue and oceans of bare black, with some
 * regions pushed past the saddle-node fold into the dead regime (V→0) so they
 * decay to black on their own. The field's centre still wanders the Pearson
 * regimes (mitosis, worms, coral, chaos) and audio drives how fast the field
 * drifts, so the coastlines migrate and the pattern never parks at full
 * coverage. "Destruction" is the oceans themselves: as the field drifts, water
 * flows into tissue and erases it while fresh tissue grows in its wake — a
 * natural, continuous churn rather than a violent reset (which collapses the
 * field). On bursts and bass hits the tide goes OUT — the void threshold drops
 * so the oceans widen and swathes of tissue dissolve in sync with the music,
 * then regrow as the pulse decays. A warm-up ramp lets the first tissue fill
 * the screen before the oceans open, so the cold start isn't an empty void. In
 * silence the drift slows to a crawl and soft self-seeds keep a drifting dotted
 * archipelago alive.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;

  // feed/kill field — drifting fbm spans the Pearson regimes (and the dead
  // zone) across the screen, so living tissue and black voids coexist and the
  // coastlines between them migrate. Rendered once per frame, sampled by SIM.
  const FIELD_FRAG = M.FRAG_HEADER + M.GLSL_NOISE + `
  uniform float uFeedBase, uKillBase, uFeedSpan, uKillSpan;
  uniform vec2  uOffset;
  uniform float uScale, uAspect, uVoid, uWarp, uFeedDip;
  void main() {
    vec2 p = vec2(vUV.x * uAspect, vUV.y) * uScale + uOffset;
    // domain warp: a slow low-frequency flow swirls and reshapes the coastlines
    // over time, so continents are continuously carved and revealed rather than
    // a rigid mask sliding by — the interiors never lock into a static map.
    vec2 flow = vec2(vnoise(p * 0.6 + vec2(uWarp * 0.05, 1.3)),
                     vnoise(p * 0.6 + vec2(5.2, -uWarp * 0.04)));
    p += (flow - 0.5) * 1.4;
    float n1 = fbm(p);                     // subtle feed texture in the tissue
    float n2 = fbm(p + vec2(31.7, 11.3));  // where the oceans open up
    // continents stay in the base (filling) regime; where n2 crosses the
    // threshold an ocean opens — kill is pushed decisively past the fold and
    // feed starved, so V dies to clean black. A fairly sharp transition keeps
    // the coastlines crisp instead of leaving a marginal half-dead margin.
    float vd = smoothstep(uVoid, uVoid + 0.16, n2);
    // oceans elevate kill (always) and starve feed (music only). Mitosis — the
    // silent regime — sits near the low-feed existence edge, so starving feed
    // there would kill the whole garden; in silence the dead water is carved by
    // kill alone, leaving the living dots their full feed so they hold.
    float feed = uFeedBase + (n1 - 0.5) * uFeedSpan - vd * uFeedDip;
    float kill = uKillBase + vd * uKillSpan;
    // keep inside a sane band: the living arc plus a dead margin, never unstable
    feed = clamp(feed, 0.012, 0.090);
    kill = clamp(kill, 0.045, 0.075);
    fragColor = vec4(feed, kill, 0.0, 1.0);
  }`;

  const SIM_FRAG = M.FRAG_HEADER + `
  uniform sampler2D uState;
  uniform sampler2D uField;
  uniform vec2 uTexel;
  uniform vec4 uSplat;     // xy: pos (uv), z: radius, w: amount
  void main() {
    vec2 c = texture(uState, vUV).rg;
    vec2 lap =
        texture(uState, vUV + vec2(-1,  0) * uTexel).rg * 0.2
      + texture(uState, vUV + vec2( 1,  0) * uTexel).rg * 0.2
      + texture(uState, vUV + vec2( 0, -1) * uTexel).rg * 0.2
      + texture(uState, vUV + vec2( 0,  1) * uTexel).rg * 0.2
      + texture(uState, vUV + vec2(-1, -1) * uTexel).rg * 0.05
      + texture(uState, vUV + vec2( 1, -1) * uTexel).rg * 0.05
      + texture(uState, vUV + vec2(-1,  1) * uTexel).rg * 0.05
      + texture(uState, vUV + vec2( 1,  1) * uTexel).rg * 0.05
      - c;
    vec2 fk = texture(uField, vUV).rg;
    float feed = fk.r, kill = fk.g;
    float aspect = uTexel.y / uTexel.x;

    float A = c.r, B = c.g;
    float ABB = A * B * B;
    A += 1.0 * lap.r - ABB + feed * (1.0 - A);
    B += 0.5 * lap.g + ABB - (kill + feed) * B;
    if (uSplat.w > 0.0) {
      float d = length((vUV - uSplat.xy) * vec2(aspect, 1.0));
      B += uSplat.w * smoothstep(uSplat.z, uSplat.z * 0.3, d);
    }
    fragColor = vec4(clamp(A, 0.0, 1.0), clamp(B, 0.0, 1.0), 0.0, 1.0);
  }`;

  const INIT_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform float uSeed;
  void main() {
    float B = 0.0;
    // scatter starter blobs generously
    for (int i = 0; i < 22; i++) {
      vec2 p = hash22(vec2(float(i) * 7.31, uSeed));
      p = p * 0.86 + 0.07;
      if (length(vUV - p) < 0.028) B = 1.0;
    }
    fragColor = vec4(1.0, B, 0.0, 1.0);
  }`;

  // The render layer carries the FAST music reactivity — the chemistry is too
  // slow to read a beat, so once the screen is full the response lives here:
  //  (1) bass/kick pumps the relief depth + glow so the tissue swells & flares,
  //  (2) treble glints sparkle on the fine worms.
  //  (NB: a beat-driven ripple/UV-displacement and an energy-driven light sweep
  //  were both tried and removed — they distract from the growth that is the
  //  point of this scene. The ripple is parked for a future pulse/liquid scene.)
  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uState;
  uniform sampler2D uField;
  uniform vec2 uTexel;
  void main() {
    float B = texture(uState, vUV).g;
    float Bx = texture(uState, vUV + vec2(uTexel.x, 0.0)).g - texture(uState, vUV - vec2(uTexel.x, 0.0)).g;
    float By = texture(uState, vUV + vec2(0.0, uTexel.y)).g - texture(uState, vUV - vec2(0.0, uTexel.y)).g;

    // (1) bass relief pump — emboss deepens on the kick so highlights flare
    float relief = 6.0 * (1.0 + uBassFast * 1.1);
    vec3 n = normalize(vec3(-Bx * relief, -By * relief, 1.0));

    vec3 lightDir = normalize(vec3(0.5, 0.6, 0.8));
    float diff = max(dot(n, lightDir), 0.0);
    float spec = pow(max(dot(reflect(-lightDir, n), vec3(0, 0, 1)), 0.0), 28.0);

    float m = smoothstep(0.05, 0.34, B);
    // local kill sets the regime, so each continent reads a touch different
    float kloc = texture(uField, vUV).g;
    float hue = uCentroid * 0.4 + uTime * 0.01 + B * 0.18 + (kloc - 0.06) * 3.0;
    vec3 base = pal(hue, vec3(0.46), vec3(0.45), vec3(1.0), vec3(0.02, 0.36, 0.70));
    vec3 bg = vec3(0.012, 0.01, 0.03) + vec3(0.04, 0.02, 0.08) * (1.0 - length(vUV - 0.5));
    vec3 col = mix(bg, base * (0.45 + diff * 1.1), m);
    // (2) treble sparkle — fine glints twinkle with the highs
    col += spec * m * (0.4 + uTreble * 2.2);
    // (1) bass glow + beat bloom — the tissue flares on the low end and the hit
    col += base * m * (uBassFast * 0.35 + uBeat * 0.30);
    col *= 0.8 + uLevel * 0.7;
    col *= 1.0 - uQuiet * 0.35;
    col *= 1.0 + uBurst * 0.5;
    float d = length(vUV - 0.5);
    col *= 1.0 - d * d * 0.8;
    fragColor = vec4(aces(col), 1.0);
  }`;

  // (feed, kill) waypoints — the field's drifting CENTRE; the spatial fbm
  // spreads ±span around whichever point we sit on, so each regime becomes a
  // sea of that pattern threaded with neighbouring regimes and dead voids.
  // All MUSIC waypoints sit in the stripe/worm/labyrinth band (Munafo/Pearson:
  // F≈0.042–0.058, k≈0.060–0.065) so the living tissue always reads as flowing
  // lines and maze texture, never relaxing into a field of plain dots — only
  // the silent REST below is a dotted regime.
  const REGIMES = [
    [0.0460, 0.0630], // worms
    [0.0540, 0.0622], // coral
    [0.0580, 0.0648], // dense labyrinth / maze
    [0.0500, 0.0608], // fat branching cells
    [0.0430, 0.0615], // loose curling worms
  ];
  // rest regime: mitosis spots, where the pattern locks in and holds. Silence
  // settles here so the dotted bloom stays alive instead of wilting away.
  const REST = [0.0367, 0.0649]; // mitosis

  M.registerScene({
    name: 'turing bloom · reaction-diffusion',
    modes: ['music', 'ambient'],
    create(glc) {
      let state = null, field = null;
      const pSim = glc.program(SIM_FRAG);
      const pField = glc.program(FIELD_FRAG);
      const pInit = glc.program(INIT_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      let regime = 0, regimeBlend = 0;  // start in worms — fills fast on cold start
      const off = { x: 0, y: 0 };       // drifting field offset (migrating coastlines)
      let splat = { x: 0.5, y: 0.5, r: 0, amt: 0 };
      let clearPulse = 0;               // tide-out: bursts/beats open the oceans wider
      let age = 0;                      // seconds since (re)seed — warms the oceans in
      let warpPhase = 0;                // field-warp clock — near-frozen in silence
      let beatCount = 0;
      let restSeedT = 0;                // countdown to the next gentle silence seed

      function seed() {
        pInit.use().f('uSeed', Math.random() * 100);
        glc.draw(pInit, state.read);
        age = 0; // let the fresh tissue fill before the oceans warm in
      }

      return {
        resize(w, h) {
          const sw = Math.max(2, Math.round(w / 2)), sh = Math.max(2, Math.round(h / 2));
          if (!state) { state = glc.pingpong(sw, sh, { repeat: true }); seed(); }
          else { state.resize(sw, sh); seed(); }
          if (!field) field = glc.target(sw, sh, { repeat: true });
          else field.resize(sw, sh);
        },
        update(dt, audio, t) {
          if (!state) return;
          const f = audio.f;

          // drift between regimes (~20s per leg), nudged by bass
          regimeBlend += dt / 20;
          if (regimeBlend >= 1) { regimeBlend = 0; regime = (regime + 1) % REGIMES.length; }
          const a = REGIMES[regime], b = REGIMES[(regime + 1) % REGIMES.length];
          const s = regimeBlend * regimeBlend * (3 - 2 * regimeBlend);
          const q = Math.min(1, f.quiet); // 0 = music, 1 = settled silence
          // DEEP-quiet gate: the silent dotted garden is only for near-total
          // silence. A merely quiet/slow song (or a fade-out still in progress)
          // must stay in the music world — flowing lines + oceans — instead of
          // being dragged a fraction of the way into mitosis spots. So remap the
          // raw quiet envelope through a smoothstep that holds at 0 until q≈0.6.
          const rt = Math.max(0, Math.min(1, (q - 0.6) / 0.32));
          const rest = rt * rt * (3 - 2 * rt); // 0 for music & quiet songs, 1 only near silence
          let feed = a[0] + (b[0] - a[0]) * s + f.bass * 0.006;
          // keep the kill nudge small so bright/trebly passages can't shove the
          // tissue up out of the stripe band into spots
          let kill = a[1] + (b[1] - a[1]) * s + f.centroid * 0.0008;
          // near silence only: settle toward the mitosis regime so a calm dotted
          // archipelago locks in and holds through the dark
          feed += (REST[0] - feed) * rest;
          kill += (REST[1] - kill) * rest;

          // drift & warp the feed/kill field so the continents and voids migrate
          // and reshape — but FREEZE both toward silence. The silent garden runs
          // a slow 8-step chemistry that can't regrow fast enough under a moving
          // field, so a near-static field lets the calm dots lock in and hold;
          // music thaws it back into churning, swirling coastlines.
          const calm = 1 - rest;       // 0 only near silence, 1 for music & quiet songs
          const energy = Math.min(1, f.level * 1.5 + f.flux * 4);
          const driftSpeed = (0.005 + energy * 0.016) * (0.12 + 0.88 * calm);
          off.x += dt * driftSpeed;
          off.y += dt * driftSpeed * 0.6;
          warpPhase += dt * (0.15 + 0.85 * calm);
          // the tide goes out on bursts (music returns) and bass hits — oceans
          // widen, tissue dissolves, then regrows as the pulse decays. This is
          // the safe, musical "destroy big portions" lever (violent kill waves
          // collapsed the whole field instead).
          clearPulse *= Math.pow(0.5, dt / 0.7);
          if (f.burst === 1) clearPulse = 1;
          else if (f.beat > 0.9 && f.bass > 0.55) clearPulse = Math.max(clearPulse, 0.55);

          // warm-up: hold the oceans nearly shut for the first few seconds so the
          // fresh seed fills the screen, then ease them open
          age += dt;
          const warm = Math.min(1, age / 7);

          // feedSpan: subtle texture across the living tissue. killSpan: how deep
          // the void regions are pushed past the fold. voidThresh: the noise
          // threshold for an ocean — higher = less negative space. Silence pulls
          // it up (calmer, fuller garden); the warm-up pulls it up early; bass and
          // clearPulse pull it down so the oceans breathe and widen with the music.
          const feedSpan = 0.006 * calm;
          const killSpan = 0.016 * (1 - rest * 0.4) * warm * calm;
          const feedDip = 0.020 * calm * warm; // music only — see FIELD_FRAG
          // near silence keeps smaller, calmer oceans (higher threshold) so the
          // dotted garden mostly holds; music & quiet songs open them up and let
          // bass / clearPulse pull the tide out wider.
          const voidThresh = (0.49 + rest * 0.25) + (1 - warm) * 0.30
            - f.bass * 0.025 - clearPulse * 0.10;

          pField.use()
            .f('uFeedBase', feed).f('uKillBase', kill)
            .f('uFeedSpan', feedSpan).f('uKillSpan', killSpan)
            .f('uFeedDip', feedDip)
            .v2('uOffset', off.x, off.y)
            .f('uScale', 2.0).f('uAspect', field.w / field.h)
            .f('uVoid', voidThresh).f('uWarp', warpPhase);
          glc.draw(pField, field);

          // seeds
          splat.amt = 0;
          if (f.burst === 1) {
            splat.x = 0.5; splat.y = 0.5;
            splat.r = 0.07;
            splat.amt = 0.9;
          } else if (f.beat > 0.9) {
            const ang = ++beatCount * 2.399963; // golden angle, walks the screen
            splat.x = 0.5 + Math.cos(ang) * (0.18 + f.bass * 0.2);
            splat.y = 0.5 + Math.sin(ang) * (0.18 + f.bass * 0.2);
            splat.r = 0.012 + f.bass * 0.03;
            splat.amt = 0.6;
          } else if (f.onset > 0.9) {
            splat.x = Math.random(); splat.y = Math.random();
            splat.r = 0.008 + f.flux * 0.1;
            splat.amt = 0.45;
          } else if (rest > 0.5) {
            // near silence has no onsets to nucleate from — drop a soft seed now
            // and then so the archipelago slowly repopulates as voids drift through
            restSeedT -= dt;
            if (restSeedT <= 0) {
              restSeedT = 1.0 + Math.random() * 1.3;
              splat.x = 0.5 + (Math.random() - 0.5) * 0.66;
              splat.y = 0.5 + (Math.random() - 0.5) * 0.66;
              splat.r = 0.02;
              splat.amt = 0.7;
            }
          }

          // chemistry rate: a calm crawl only near silence, a brisk churn for
          // music and quiet songs alike (so the lines stay sharp at low energy)
          const STEPS = rest > 0.5 ? 8 : 13;
          for (let i = 0; i < STEPS; i++) {
            pSim.use()
              .v2('uTexel', 1 / state.read.w, 1 / state.read.h)
              .v4('uSplat', splat.x, splat.y, splat.r, i === 0 ? splat.amt : 0)
              .tex('uState', state.read.tex, 0)
              .tex('uField', field.tex, 1);
            glc.draw(pSim, state.write);
            state.swap();
          }
        },
        render(out, audio, t) {
          if (!state) return;
          pShow.use()
            .v2('uTexel', 1 / state.read.w, 1 / state.read.h)
            .tex('uState', state.read.tex, 0)
            .tex('uField', field.tex, 1);
          M.audioUniforms(pShow, audio, t);
          glc.draw(pShow, out);
        },
        dispose() {
          if (state) state.dispose();
          if (field) field.dispose();
          for (const p of [pSim, pField, pInit, pShow]) p.dispose();
        },
      };
    },
  });
})();
