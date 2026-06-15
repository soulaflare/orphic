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
    // twinkling stars, gliding slowly leftward so the sky reads as the camera
    // panning right through space (steady on uTime, not the music, so it never
    // stalls in quiet passages)
    vec2 sgrid = (p + vec2(uTime * 0.005, 0.0)) * uRes / 4.0;
    float sh = hash12(floor(sgrid));
    // independent hash for the twinkle: the existence hash is ~1.0 for every
    // visible star, so reusing it makes them all blink in unison
    float th = hash12(floor(sgrid) + 17.31);
    float tw = 0.6 + 0.4 * sin(uTime * (0.8 + th * 4.0) + th * 40.0);
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

    // idle arc: in true silence the spectrum curtains vanish (curtain() ends in
    // * eq), leaving a dead starfield. Restore the veil's stated rest state —
    // one faint green arc bowing over the horizon, its crest undulating on uTime
    // (uPhaseLevel crawls to a near-standstill in silence, like the stars it
    // sits among). Fixed height: it never grows or pulses with audio, and uQuiet
    // alone gates it so the spectrum curtains reclaim the sky the instant sound
    // returns. Borrows the live veil's fold warp + ray combing so it reads as
    // the same aurora resting, not a separate band.
    float arcCrest = 0.20
                   + 0.040 * sin(p.x * 5.0 + uTime * 0.16)
                   + 0.022 * sin(p.x * 11.0 - uTime * 0.11)
                   + (w1.y - 0.5) * 0.05;
    float arcBow = 0.5 + 0.5 * cos((p.x - 0.5) * 3.14159); // one centered arc, not a flat band
    float idleArc = (1.0 - smoothstep(arcCrest - 0.06, arcCrest, p.y)) // soft wavy crest
                  * smoothstep(0.03, 0.10, p.y)                        // fade up out of the horizon
                  * arcBow * rays * uQuiet;
    col += a1 * idleArc * 0.16;

    // faint snowfield horizon catching the glow
    float ground = smoothstep(0.085, 0.075, p.y);
    vec3 glow = a1 * (c1 + 0.15) * 0.22 * life + a1 * idleArc * 0.10;
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
        dispose() { prog.dispose(); },
      };
    },
  });
})();
