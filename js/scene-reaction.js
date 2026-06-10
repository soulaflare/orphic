/* ORPHIC scene — REACTION-DIFFUSION · turing bloom
 * Gray-Scott model (Pearson 1993, Karl Sims' formulation) on a half-res
 * float grid, 10 sim steps/frame. The feed/kill pair drifts between known
 * pattern regimes (mitosis, worms, coral); bass perturbs the feed rate,
 * beats stamp fresh seeds, and the relief is lit from the B-field gradient
 * so the patterns read as embossed, growing tissue.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;

  const SIM_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform sampler2D uState;
  uniform vec2 uTexel;
  uniform float uFeed, uKill;
  uniform vec4 uSplat;   // xy: pos (uv), z: radius, w: amount
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
    float A = c.r, B = c.g;
    float ABB = A * B * B;
    A += 1.0 * lap.r - ABB + uFeed * (1.0 - A);
    B += 0.5 * lap.g + ABB - (uKill + uFeed) * B;
    if (uSplat.w > 0.0) {
      float d = length((vUV - uSplat.xy) * vec2(uTexel.y / uTexel.x, 1.0));
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

  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uState;
  uniform vec2 uTexel;
  void main() {
    float B = texture(uState, vUV).g;
    float Bx = texture(uState, vUV + vec2(uTexel.x, 0.0)).g - texture(uState, vUV - vec2(uTexel.x, 0.0)).g;
    float By = texture(uState, vUV + vec2(0.0, uTexel.y)).g - texture(uState, vUV - vec2(0.0, uTexel.y)).g;
    vec3 n = normalize(vec3(-Bx * 6.0, -By * 6.0, 1.0));
    vec3 lightDir = normalize(vec3(0.5, 0.6, 0.8));
    float diff = max(dot(n, lightDir), 0.0);
    float spec = pow(max(dot(reflect(-lightDir, n), vec3(0, 0, 1)), 0.0), 24.0);

    float m = smoothstep(0.05, 0.34, B);
    float hue = uCentroid * 0.4 + uTime * 0.01 + B * 0.18;
    vec3 base = pal(hue, vec3(0.46), vec3(0.45), vec3(1.0), vec3(0.02, 0.36, 0.70));
    vec3 bg = vec3(0.012, 0.01, 0.03) + vec3(0.04, 0.02, 0.08) * (1.0 - length(vUV - 0.5));
    vec3 col = mix(bg, base * (0.45 + diff * 1.1), m);
    col += spec * m * (0.5 + uTreble * 1.2);
    col += base * uBeat * m * 0.30;
    col *= 0.8 + uLevel * 0.7;
    col *= 1.0 - uQuiet * 0.35;
    col *= 1.0 + uBurst * 0.5;
    float d = length(vUV - 0.5);
    col *= 1.0 - d * d * 0.8;
    fragColor = vec4(aces(col), 1.0);
  }`;

  // (feed, kill) waypoints — all inside pattern-forming regimes
  const REGIMES = [
    [0.0367, 0.0649], // mitosis
    [0.0460, 0.0630], // worms
    [0.0545, 0.0620], // coral growth
    [0.0300, 0.0620], // solitons
    [0.0260, 0.0580], // pulsing chaos
  ];

  M.registerScene({
    name: 'turing bloom · reaction-diffusion',
    modes: ['music', 'ambient'],
    create(glc) {
      let state = null;
      const pSim = glc.program(SIM_FRAG);
      const pInit = glc.program(INIT_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      let regime = 0, regimeBlend = 0;
      let splat = { x: 0.5, y: 0.5, r: 0, amt: 0 };
      let beatCount = 0;

      function seed() {
        pInit.use().f('uSeed', Math.random() * 100);
        glc.draw(pInit, state.read);
      }

      return {
        resize(w, h) {
          const sw = Math.max(2, Math.round(w / 2)), sh = Math.max(2, Math.round(h / 2));
          if (!state) { state = glc.pingpong(sw, sh, { repeat: true }); seed(); }
          else { state.a.resize(sw, sh); state.b.resize(sw, sh); seed(); }
        },
        update(dt, audio, t) {
          if (!state) return;
          const f = audio.f;

          // drift between regimes (~20s per leg), nudged by bass
          regimeBlend += dt / 20;
          if (regimeBlend >= 1) { regimeBlend = 0; regime = (regime + 1) % REGIMES.length; }
          const a = REGIMES[regime], b = REGIMES[(regime + 1) % REGIMES.length];
          const s = regimeBlend * regimeBlend * (3 - 2 * regimeBlend);
          let feed = a[0] + (b[0] - a[0]) * s + f.bass * 0.006;
          // in a rest the kill rate creeps up: the tissue visibly wilts back
          let kill = a[1] + (b[1] - a[1]) * s + f.centroid * 0.0015 + f.quiet * 0.0035;

          // beat → stamp a new seed along a slowly precessing ring
          splat.amt = 0;
          if (f.burst === 1) {
            // music returns: a fat bloom right where the wilt left room
            splat.x = 0.5; splat.y = 0.5;
            splat.r = 0.07;
            splat.amt = 0.9;
          } else if (f.beat > 0.9) {
            beatCount++;
            const ang = beatCount * 2.399963; // golden angle
            splat.x = 0.5 + Math.cos(ang) * (0.18 + f.bass * 0.2);
            splat.y = 0.5 + Math.sin(ang) * (0.18 + f.bass * 0.2);
            splat.r = 0.012 + f.bass * 0.03;
            splat.amt = 0.6;
          } else if (f.onset > 0.9) {
            splat.x = Math.random(); splat.y = Math.random();
            splat.r = 0.008 + f.flux * 0.1;
            splat.amt = 0.45;
          }

          // rests slow the chemistry to a crawl — growth visibly pauses
          const STEPS = f.quiet > 0.5 ? 3 : 13;
          for (let i = 0; i < STEPS; i++) {
            pSim.use()
              .v2('uTexel', 1 / state.read.w, 1 / state.read.h)
              .f('uFeed', feed).f('uKill', kill)
              .v4('uSplat', splat.x, splat.y, splat.r, i === 0 ? splat.amt : 0)
              .tex('uState', state.read.tex, 0);
            glc.draw(pSim, state.write);
            state.swap();
          }
        },
        render(out, audio, t) {
          if (!state) return;
          pShow.use()
            .v2('uTexel', 1 / state.read.w, 1 / state.read.h)
            .tex('uState', state.read.tex, 0);
          M.audioUniforms(pShow, audio, t);
          glc.draw(pShow, out);
        },
        dispose() { if (state) state.dispose(); },
      };
    },
  });
})();
