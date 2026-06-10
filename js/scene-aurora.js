/* ORPHIC scene — AURORA SILK · domain-warped liquid light
 * IQ-style nested domain warping (f(p + g(p + h(p)))) rendered as iridescent
 * silk. Each frequency band owns a structural layer of the warp: bass folds
 * the large sheets, mids drive the second warp's turbulence, treble adds fine
 * crackle — and each silk filament is lit by its own slice of the live
 * spectrum, so a melody runs glints along different threads than the kick.
 * Palette follows the musical key on the circle of fifths.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;

  const FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + M.GLSL_SPECTRUM + `
  uniform vec2 uRes;
  uniform float uKeyHue;

  void main() {
    vec2 p = (vUV - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 1.7;

    // layer 1 — slow sheets, folded harder when the bass leans in
    float t1 = uPhaseLevel * 0.10;
    vec2 q = vec2(fbm(p * 1.1 + vec2(0.0, t1)),
                  fbm(p * 1.1 + vec2(5.2, t1 * 1.31)));

    // layer 2 — mid-band turbulence
    float warp1 = 1.1 + uBass * 2.2 + uOnset * 0.5;
    vec2 r = vec2(fbm(p * 2.1 + q * warp1 + vec2(1.7, 9.2 + uPhaseBass * 0.08)),
                  fbm(p * 2.1 + q * warp1 + vec2(8.3, 2.8 + uPhaseBass * 0.06)));

    // layer 3 — the silk itself
    float warp2 = 1.4 + uMid * 2.0;
    float v = fbm(p * 2.6 + r * warp2 + vec2(uPhaseTreble * 0.05));

    // treble crackle: fine grain that only exists when highs are present
    v += (vnoise(p * 16.0 + uPhaseTreble * 1.4) - 0.5) * uTreble * 0.14;

    // every filament v is lit by its own frequency slice (3-tap soften)
    float bx = clamp(v * 1.45 - 0.2, 0.0, 1.0);
    float band = specLog(bx) * 0.5 + specLog(min(bx + 0.045, 1.0)) * 0.25
               + specLog(max(bx - 0.045, 0.0)) * 0.25;

    float hue = uKeyHue + v * 0.34 + q.x * 0.14 + r.y * 0.10;
    vec3 col = pal(hue, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
    // deep blacks between the lit filaments — contrast carries the silk look
    col *= 0.03 + pow(band, 3.0) * 2.3 + uLevel * 0.08;

    // sheen along the steepest folds
    float sheen = pow(clamp(1.0 - abs(v - 0.5) * 3.2, 0.0, 1.0), 5.0);
    col += pal(hue + 0.4, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67))
           * sheen * (0.08 + uFlux * 1.6 + uBeat * 0.25);

    float d = length(vUV - 0.5);
    col *= 1.0 - d * d * 0.75;
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'aurora silk · liquid light',
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
