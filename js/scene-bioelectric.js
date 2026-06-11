/* ORPHIC scene — BIOELECTRIC · oscillating tissue
 * A sheet of cells that pulses in voltage as one oscillating field. Every cell
 * is a little chemical clock (the lambda–omega / complex Ginzburg–Landau model)
 * and gap-junction diffusion couples them, so the whole sheet self-organises
 * into rotating spiral waves — the iconic vivid swirl of the Belousov–Zhabotinsky
 * reaction and of bioelectric pre-pattern fields (Levin lab). The phase of each
 * cell's oscillation is drawn straight to hue, so the tissue is a living rainbow
 * of spirals turning around dark singular cores where the amplitude vanishes.
 *
 * The music drives the chemistry: loudness spins the clocks faster and brightens
 * the field, pitch sets the spiral wavelength, beats carve fresh phase
 * singularities that bloom into new spiral pairs, and rests dim the sheet toward
 * dark. Rendered crisp at high resolution with a bloom b, the colour keyed to
 * the music so the whole field shifts palette with the song.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const GRID = 512;

  const HEAD = M.FRAG_HEADER;
  const TEX = `uniform vec2 uTexel;`;

  // small random field — the limit cycle amplifies it into spiral turbulence
  const INIT_FRAG = HEAD + M.GLSL_LIB + `
  uniform float uSeed;
  void main() {
    vec2 h = hash22(vUV * 40.0 + uSeed) - 0.5;
    // many seeded phase windings → a field of finer spirals to start
    float a = fbm(vUV * 5.0 + uSeed) * 22.0;
    fragColor = vec4(0.15 * h + 0.25 * vec2(cos(a), sin(a)), 0.0, 1.0);
  }`;

  // lambda-omega reaction-diffusion (CGLE form): rotating spiral waves
  const SIM_FRAG = HEAD + M.GLSL_LIB + TEX + `
  uniform sampler2D uState;
  uniform float uDt, uD, uOmega, uBeta;
  uniform vec4 uSplat;   // xy, radius, amount (carves a phase defect)
  void main() {
    vec2 w = texture(uState, vUV).xy;
    vec2 l = texture(uState, vUV - vec2(uTexel.x, 0)).xy;
    vec2 r = texture(uState, vUV + vec2(uTexel.x, 0)).xy;
    vec2 d = texture(uState, vUV - vec2(0, uTexel.y)).xy;
    vec2 u = texture(uState, vUV + vec2(0, uTexel.y)).xy;
    vec2 lap = l + r + d + u - 4.0 * w;

    float A2 = dot(w, w);
    float lam = 1.0 - A2;                 // amplitude relaxes to the unit cycle
    float om = uOmega - uBeta * A2;       // rotation frequency (amplitude-detuned)
    vec2 react = vec2(lam * w.x - om * w.y, om * w.x + lam * w.y);
    w += uDt * (react + uD * lap);

    if (uSplat.w > 0.0) {
      float dd = length((vUV - uSplat.xy) * vec2(uTexel.y / uTexel.x, 1.0));
      w *= 1.0 - uSplat.w * smoothstep(uSplat.z, 0.0, dd);  // carve → new defect
    }
    fragColor = vec4(w, 0.0, 1.0);
  }`;

  const SHOW_FRAG = HEAD + M.GLSL_LIB + M.GLSL_AUDIO + TEX + `
  uniform sampler2D uState;
  uniform float uKeyHue, uRes;
  void main() {
    vec2 w = texture(uState, vUV).xy;
    float amp = length(w);
    float phase = atan(w.y, w.x);

    // neighbouring amplitude → crisp wavefront ridges + emboss
    float al = length(texture(uState, vUV - vec2(uTexel.x, 0)).xy);
    float ar = length(texture(uState, vUV + vec2(uTexel.x, 0)).xy);
    float ad = length(texture(uState, vUV - vec2(0, uTexel.y)).xy);
    float au = length(texture(uState, vUV + vec2(0, uTexel.y)).xy);
    vec2 ga = vec2(ar - al, au - ad);
    vec3 n = normalize(vec3(-ga * 6.0, 1.0));
    float diff = max(dot(n, normalize(vec3(0.4, 0.55, 0.8))), 0.0);

    // phase → vivid colour through the cosine rainbow, keyed to the music; with
    // the negative space restored, distinct arm colours read as rich, not clashy
    float pp = phase / 6.28318;
    vec3 base = pal(uKeyHue * 0.5 + pp * 0.92 + uPhaseLevel * 0.01,
                    vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));

    // brightness rides ONLY the depolarised crest band: troughs fall to black,
    // so the field reads as defined coloured wave-arms over negative space (the
    // merge of crisp excitable waves with the vivid oscillating colour field)
    float volt = w.x;
    float bright = smoothstep(0.04, 0.62, volt);
    bright = pow(bright, 1.4);

    float core = smoothstep(0.04, 0.42, amp);
    vec3 col = vec3(0.006, 0.01, 0.022);
    col += base * core * bright * (1.25 + diff * 0.7);          // vivid coloured arms
    // thin white sparkle only at the very crest peak (keeps colour intact)
    col += vec3(1.0) * smoothstep(0.82, 0.99, volt) * core * (0.3 + uTreble * 0.5 + uBeat * 0.4);

    col *= 0.9 + uLevel * 0.4;
    col *= 1.0 - uQuiet * 0.45;            // rests dim the sheet toward dark
    float vg = length(vUV - 0.5);
    col *= 1.0 - vg * vg * 0.6;
    col += (hash12(vUV * uRes) - 0.5) / 255.0;
    fragColor = vec4(col, 1.0);
  }`;

  const POST_FRAG = HEAD + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uScene, uBloom;
  void main() {
    vec3 c = texture(uScene, vUV).rgb + texture(uBloom, vUV).rgb * (0.6 + uLevel * 0.5);
    fragColor = vec4(aces(c), 1.0);
  }`;

  M.registerScene({
    name: 'oscillating tissue · bioelectric',
    modes: ['music', 'ambient'],
    create(glc) {
      const state = glc.pingpong(GRID, GRID);
      let scene = null;
      const bloom = M.makeBloom(glc, { div: 3, passes: 2 });
      const pInit = glc.program(INIT_FRAG);
      const pSim = glc.program(SIM_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const pPost = glc.program(POST_FRAG);
      const texel = [1 / GRID, 1 / GRID];
      let keyHue = 0.5, beatCount = 0;

      function seed() {
        pInit.use().f('uSeed', Math.random() * 100);
        glc.draw(pInit, state.read);
      }
      seed();

      return {
        resize(w, h) {
          if (!scene) scene = glc.target(w, h);
          else scene.resize(w, h);
          bloom.resize(w, h);
        },
        update(dt, audio, t) {
          const f = audio.f;
          keyHue = M.chromaHue(f.chroma, keyHue, dt);

          // loudness spins the clocks; pitch sets the spiral wavelength via D
          const omega = 1.1 + f.level * 1.2 + f.treble * 0.6;
          const D = 0.30 + f.pitchNorm * 0.28;   // smaller → finer, denser spirals
          const beta = 0.9 + f.centroid * 0.7;

          // beats carve fresh phase singularities → new spiral pairs bloom
          let splat = [0, 0, 0, 0];
          if (f.burst === 1) {
            splat = [0.5, 0.5, 0.18, 1.0];
          } else if (f.beat > 0.9) {
            beatCount++;
            const ang = beatCount * 2.399963;
            splat = [0.5 + Math.cos(ang) * 0.33, 0.5 + Math.sin(ang) * 0.33,
                     0.05 + f.bass * 0.05, 1.0];
          } else if (f.onset > 0.9) {
            splat = [Math.random(), Math.random(), 0.04, 0.9];
          }

          const STEPS = 2;
          for (let s = 0; s < STEPS; s++) {
            pSim.use().v2('uTexel', texel[0], texel[1])
              .f('uDt', 0.06).f('uD', D).f('uOmega', omega).f('uBeta', beta)
              .v4('uSplat', splat[0], splat[1], splat[2], s === 0 ? splat[3] : 0)
              .tex('uState', state.read.tex, 0);
            glc.draw(pSim, state.write);
            state.swap();
          }
        },
        render(out, audio, t) {
          if (!scene) return;
          pShow.use().v2('uTexel', texel[0], texel[1])
            .f('uKeyHue', keyHue).f('uRes', glc.height)
            .tex('uState', state.read.tex, 0);
          M.audioUniforms(pShow, audio, t);
          glc.draw(pShow, scene);

          bloom.render(scene.tex, glc.width, glc.height, 0.55);

          pPost.use().tex('uScene', scene.tex, 0).tex('uBloom', bloom.tex, 1);
          M.audioUniforms(pPost, audio, t);
          glc.draw(pPost, out);
        },
        dispose() {
          state.dispose();
          if (scene) scene.dispose();
          bloom.dispose();
          for (const p of [pInit, pSim, pShow, pPost]) p.dispose();
        },
      };
    },
  });
})();
