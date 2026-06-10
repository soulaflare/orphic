/* ORPHIC scene — AURORA VEIL · spectral curtains
 * A night-sky aurora whose curtains ARE the equalizer: horizontal position
 * is log frequency (bass curtains on the left, treble shimmer on the right)
 * and each curtain's brightness and height follow its band's peak-decay
 * envelope — temporally smooth, so the veil breathes instead of strobing.
 * Domain-warped folds give the silk; kicks send a ripple along the curtain,
 * sustained harmonic content raises the whole veil, and in a rest it fades
 * to one faint arc over the horizon — the music's return floods the sky.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;

  const FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + M.GLSL_SPECTRUM + `
  uniform vec2 uRes;
  uniform float uKeyHue;

  // one aurora layer: az/height profile lit by the smoothed spectrum
  float curtain(float az, float y, float base, float sharp, vec2 warp) {
    float a = clamp(az + (warp.x - 0.5) * (0.16 + uBass * 0.10), 0.0, 1.0);
    // peak-decay channel of the newest spectrogram row: calm, no strobe
    float eq = texture(uSpectrogram, vec2(a, 0.985)).b;
    // kick ripple traveling along the veil
    eq *= 1.0 + uBassFast * 0.30 * sin(a * 24.0 - uTime * 5.0);
    float b = base + (warp.y - 0.5) * 0.14 + 0.05 * sin(a * 6.28318 + uPhaseLevel * 0.23);
    float h = y - b;
    float lift = 0.35 + eq * 0.9 + uHarmonic * 0.5; // loud bands rise higher
    return exp(-max(h, 0.0) * sharp / lift) * smoothstep(-0.05, 0.015, h) * eq;
  }

  void main() {
    vec2 p = vUV;
    float t1 = uPhaseLevel * 0.06;

    // night sky: near-black with a whisper of color, stars above
    vec3 col = mix(vec3(0.012, 0.014, 0.030), vec3(0.002, 0.002, 0.008),
                   pow(p.y, 0.7));
    // twinkling stars, drifting almost imperceptibly with the music's time
    vec2 sgrid = (p + vec2(uPhaseLevel * 0.0015, 0.0)) * uRes / 4.0;
    float sh = hash12(floor(sgrid));
    float tw = 0.55 + 0.45 * sin(uTime * (1.0 + sh * 4.0) + sh * 40.0);
    float star = step(0.997, sh)
               * smoothstep(0.5, 0.1, length(fract(sgrid) - 0.5)) * tw;
    col += vec3(0.85, 0.9, 1.0) * star * smoothstep(0.35, 0.8, p.y)
           * (0.45 + uTreble * 0.35);

    // silky folds, drifting on the loudness phase
    vec2 w1 = vec2(fbm(vec2(p.x * 2.1, p.y * 1.2) + t1),
                   fbm(vec2(p.x * 2.3 + 5.2, p.y * 1.3) - t1 * 0.8));
    vec2 w2 = vec2(fbm(vec2(p.x * 1.6 + 9.1, p.y * 1.1) - t1 * 0.6),
                   fbm(vec2(p.x * 1.8 + 2.7, p.y * 0.9) + t1 * 1.2));

    // two curtain layers for depth; ray streaks comb them vertically
    float c1 = curtain(p.x, p.y, 0.22, 5.0, w1);
    float c2 = curtain(p.x * 0.92 + 0.05, p.y, 0.40, 7.0, w2) * 0.55;
    float rays = 0.55 + 0.45 * fbm(vec2(p.x * 16.0 + w1.x * 2.0, p.y * 1.6 - t1 * 2.5));

    // aurora colors: green base rising into violet tips, nudged by the key
    float hueBase = 0.30 + 0.12 * sin(uKeyHue * 6.28318);
    float tip1 = clamp((p.y - 0.22) * 2.0, 0.0, 1.0);
    float tip2 = clamp((p.y - 0.40) * 2.0, 0.0, 1.0);
    vec3 a1 = mix(hsv(hueBase, 0.9, 1.0), hsv(hueBase + 0.42, 0.65, 1.0), tip1);
    vec3 a2 = mix(hsv(hueBase + 0.06, 0.85, 1.0), hsv(hueBase + 0.50, 0.6, 1.0), tip2);

    // rests: the veil dies down to a faint arc; the return floods the sky
    float life = (1.0 - uQuiet * 0.8) * (0.55 + uLevel * 0.65) + uBurst * 1.2;
    col += a1 * c1 * rays * life;
    col += a2 * c2 * rays * life * 0.8;

    // faint snowfield horizon catching the glow
    float ground = smoothstep(0.085, 0.075, p.y);
    vec3 glow = a1 * (c1 + 0.15) * 0.22 * life;
    col = mix(col, vec3(0.010, 0.012, 0.022) + glow, ground);

    float v = length(vUV - 0.5);
    col *= 1.0 - v * v * 0.5;
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'aurora veil · spectral curtains',
    modes: ['music', 'speech', 'ambient'],
    create(glc) {
      const prog = glc.program(FRAG);
      let keyHue = 0.55;
      return {
        resize() {},
        update(dt, audio) {
          keyHue = M.chromaHue(audio.f.chroma, keyHue, dt);
        },
        render(out, audio, t) {
          prog.use();
          M.audioUniforms(prog, audio, t);
          M.spectrumUniforms(prog, audio, 0);
          prog.v2('uRes', glc.width, glc.height).f('uKeyHue', keyHue);
          glc.draw(prog, out);
        },
        dispose() {},
      };
    },
  });
})();
