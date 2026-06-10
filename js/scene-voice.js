/* MYTHOS scene — VOICE AURORA · pitch contour arcs
 * Built on a verified perceptual finding (IEEE/ACM TASLP 2020): speech forms
 * smooth arc-like harmonic trajectories in time-frequency space, unlike
 * music's stationary striations. So the voice is drawn as exactly that — a
 * luminous ribbon riding the live pitch contour, breaking at pauses,
 * thickening with loudness, hue rising with pitch. Band-energy echo ribbons
 * shadow it like aurora curtains; onsets (consonants) strike sparks.
 */
(function () {
  'use strict';
  const M = window.MYTHOS;
  const N = 512; // history samples (~8.5s at 60fps)

  const FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uHist;   // x: pitch, y: voiced, z: level, w: treble
  uniform vec2 uRes;
  const float N = ${N}.0;

  vec4 hist(float x) {        // x: 0 = oldest (left) .. 1 = now (right)
    float i = clamp(x, 0.0, 1.0) * (N - 1.0);
    vec4 a = texelFetch(uHist, ivec2(int(i), 0), 0);
    vec4 b = texelFetch(uHist, ivec2(min(int(i) + 1, ${N - 1}), 0), 0);
    return mix(a, b, fract(i));
  }

  float ribbon(float y, float center, float halfW, float soft) {
    float d = abs(y - center);
    return exp(-pow(d / max(halfW, 1e-4), 2.0) * soft);
  }

  void main() {
    vec2 uv = vUV;
    vec4 h = hist(uv.x);
    // small neighbourhood average → arcs, not jitter
    vec4 hs = (hist(max(uv.x - 0.008, 0.0)) + h + hist(min(uv.x + 0.008, 1.0))) / 3.0;

    float pitchY = 0.28 + hs.x * 0.5;
    float voiced = hs.y;
    float loud = hs.z;
    float age = 1.0 - uv.x;                 // 0 = now, 1 = oldest
    float fade = exp(-age * 2.2);

    vec3 col = vec3(0.0);

    // -- main pitch ribbon --
    float w = 0.006 + loud * 0.05;
    float core = ribbon(uv.y, pitchY, w, 1.0) * voiced;
    float halo = ribbon(uv.y, pitchY, w * 4.0, 1.0) * voiced * 0.25;
    float hue = 0.62 - hs.x * 0.45 + uSpeech * 0.05;
    vec3 ribCol = pal(hue, vec3(0.55), vec3(0.45), vec3(1.0), vec3(0.0, 0.33, 0.67));
    col += ribCol * (core * 1.6 + halo) * fade * (0.4 + loud * 1.6);

    // -- aurora curtains: energy hanging beneath the contour --
    float curtain = smoothstep(pitchY, pitchY - 0.45 * (0.3 + loud), uv.y)
                  * smoothstep(pitchY - 0.5, pitchY, uv.y);
    float flicker = fbm(vec2(uv.x * 7.0, uv.y * 3.0 - uTime * 0.4));
    col += ribCol * curtain * flicker * voiced * fade * 0.30;

    // -- treble shadow ribbon (consonant energy, sibilance) --
    float trebY = 0.82;
    float trebRib = ribbon(uv.y, trebY + sin(uv.x * 21.0 + uTime) * 0.015, 0.004 + hs.w * 0.03, 1.4);
    col += pal(hue + 0.4, vec3(0.5), vec3(0.4), vec3(1.0), vec3(0.0, 0.33, 0.67))
           * trebRib * hs.w * fade * 1.1;

    // -- waterline echo near the bottom --
    float refl = ribbon(uv.y, 0.10, w * 2.0, 1.0);
    col += ribCol * refl * voiced * fade * 0.12 * (1.0 + sin(uv.x * 90.0 + uTime * 3.0) * 0.3);

    // -- consonant sparks near the leading edge --
    vec2 cell = floor(vec2(uv.x * 90.0, uv.y * 50.0));
    float spark = step(0.985 - uOnset * 0.012, hash12(cell + floor(uTime * 20.0)));
    col += vec3(1.0, 0.95, 0.8) * spark * uOnset * smoothstep(0.6, 1.0, uv.x) * 0.8;

    // -- breathing background --
    float d = length(uv - vec2(0.72, 0.45));
    col += pal(hue + 0.52, vec3(0.06), vec3(0.05), vec3(1.0), vec3(0.0, 0.3, 0.6))
           * (1.0 - d) * (0.25 + uLevel * 0.5);

    float vd = length(uv - 0.5);
    col *= 1.0 - vd * vd * 0.8;
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'voice aurora · pitch contour',
    modes: ['speech'],
    create(glc) {
      const gl = glc.gl;
      const prog = glc.program(FRAG);
      const hist = new Float32Array(N * 4);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, 1, 0, gl.RGBA, gl.FLOAT, hist);

      let smoothPitch = 0.4;

      return {
        resize() {},
        update(dt, audio, t) {
          const f = audio.f;
          // hold last pitch through brief unvoiced gaps so arcs stay smooth
          if (f.voiced > 0.15 && f.pitchNorm > 0) {
            smoothPitch += (f.pitchNorm - smoothPitch) * (1 - Math.exp(-dt * 14));
          }
          hist.copyWithin(0, 4); // scroll left; newest sample lives at the end
          const o = (N - 1) * 4;
          hist[o] = smoothPitch;
          hist[o + 1] = f.voiced;
          hist[o + 2] = f.level;
          hist[o + 3] = f.treble;
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, 1, gl.RGBA, gl.FLOAT, hist);
        },
        render(out, audio, t) {
          prog.use().v2('uRes', glc.width, glc.height)
              .tex('uHist', tex, 0);
          M.audioUniforms(prog, audio, t);
          glc.draw(prog, out);
        },
        dispose() { gl.deleteTexture(tex); },
      };
    },
  });
})();
