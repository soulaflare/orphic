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

  float ribbon(float y, float center, float halfW) {
    float d = (y - center) / max(halfW, 1e-4);
    return exp(-d * d);
  }

  // soft round ember/star field; drift moves cells upward over time
  float embers(vec2 uv, float aspect, float scale, float drift, float density, float seed) {
    vec2 g = (uv * vec2(aspect, 1.0) + vec2(0.0, -uTime * drift)) * scale;
    vec2 id = floor(g);
    float acc = 0.0;
    for (int oy = -1; oy <= 1; oy++)
    for (int ox = -1; ox <= 1; ox++) {
      vec2 cid = id + vec2(ox, oy);
      vec2 h = hash22(cid + seed);
      if (h.x > density) continue;
      vec2 p = cid + 0.5 + (h - 0.5) * 0.8;
      float d = length(g - p);
      float tw = 0.55 + 0.45 * sin(uTime * (2.0 + h.y * 4.0) + h.x * 40.0);
      acc += exp(-d * d * 9.0) * tw;
    }
    return acc;
  }

  void main() {
    vec2 uv = vUV;
    float aspect = uRes.x / uRes.y;
    vec4 h0 = hist(uv.x);
    // wide neighbourhood average → smooth arcs, not jitter
    vec4 hs = (hist(uv.x - 0.016) + hist(uv.x - 0.008) + h0
             + hist(uv.x + 0.008) + hist(uv.x + 0.016)) / 5.0;

    float pitchY = 0.30 + hs.x * 0.45;
    float voiced = hs.y;
    float loud = hs.z;
    float age = 1.0 - uv.x;                 // 0 = now, 1 = oldest
    float fade = exp(-age * 1.8);
    float hue = 0.62 - hs.x * 0.45 + uSpeech * 0.05;
    vec3 ribCol = pal(hue, vec3(0.55), vec3(0.45), vec3(1.0), vec3(0.0, 0.33, 0.67));

    // ---- deep-space background: gradient + domain-warped nebula ----
    vec3 col = mix(vec3(0.012, 0.010, 0.032), vec3(0.030, 0.016, 0.055), uv.y);
    vec2 q = vec2(fbm(uv * vec2(aspect, 1.0) * 2.6 + uTime * 0.015),
                  fbm(uv * vec2(aspect, 1.0) * 2.6 - uTime * 0.020 + 7.3));
    float neb = fbm(uv * vec2(aspect * 1.6, 2.8) + q * 0.9);
    col += pal(hue + 0.45 + neb * 0.18, vec3(0.5), vec3(0.4), vec3(1.0), vec3(0.0, 0.3, 0.6))
           * neb * neb * (0.10 + uLevel * 0.10);

    // ---- starfield, two depths, gentle twinkle ----
    col += vec3(0.85, 0.9, 1.0) * embers(uv, aspect, 42.0, 0.0, 0.06, 3.1) * 0.10;
    col += vec3(0.95, 0.9, 1.0) * embers(uv, aspect, 21.0, 0.0, 0.04, 9.7) * 0.16;

    // ---- aurora curtains hanging beneath the contour ----
    float below = pitchY - uv.y;
    if (below > 0.0 && voiced > 0.01) {
      float streaks = fbm(vec2(uv.x * 9.0, uv.y * 1.6 - uTime * 0.22));
      streaks = streaks * streaks * 1.6;
      float falloff = exp(-below * (5.5 - loud * 2.0));
      col += ribCol * streaks * falloff * voiced * fade * 0.45;
    }

    // ---- pitch ribbon: filament core + halo + harmonic echoes ----
    float w = 0.0045 + loud * 0.030;
    // pitch axis is log-scaled, so harmonics sit at fixed offsets above f0
    const float OCT = 0.45 / 3.644;
    float fil = 0.90 + 0.10 * sin(uv.x * 340.0 + uTime * 1.7 + hs.x * 30.0);
    float core = ribbon(uv.y, pitchY, w) * fil;
    float halo = ribbon(uv.y, pitchY, w * 5.0) * 0.22;
    float harm2 = ribbon(uv.y, pitchY + OCT, w * 0.7) * 0.34 * fil;
    float harm3 = ribbon(uv.y, pitchY + OCT * 1.585, w * 0.55) * 0.16;
    col += ribCol * (core * 1.7 + halo) * voiced * fade * (0.45 + loud * 1.6);
    col += pal(hue - 0.07, vec3(0.55), vec3(0.45), vec3(1.0), vec3(0.0, 0.33, 0.67))
           * harm2 * voiced * fade * (0.4 + loud * 1.2);
    col += pal(hue - 0.13, vec3(0.55), vec3(0.45), vec3(1.0), vec3(0.0, 0.33, 0.67))
           * harm3 * voiced * fade * (0.4 + loud);
    // hot white centre line
    col += vec3(1.0, 0.97, 0.92) * ribbon(uv.y, pitchY, w * 0.35) * voiced * fade * loud * 0.9;

    // ---- sibilance shimmer: thin noisy thread up top ----
    float ty = 0.84 + (fbm(vec2(uv.x * 14.0, uTime * 0.6)) - 0.5) * 0.05;
    float trebRib = ribbon(uv.y, ty, 0.004 + hs.w * 0.018)
                  * (0.88 + 0.12 * sin(uv.x * 160.0 - uTime * 2.0));
    col += pal(hue + 0.4, vec3(0.5), vec3(0.4), vec3(1.0), vec3(0.0, 0.33, 0.67))
           * trebRib * hs.w * fade * 1.1;

    // ---- consonant embers: soft motes rising off the fresh edge ----
    float emb = embers(uv, aspect, 26.0, 0.045, 0.30, 1.7);
    float edgeBias = smoothstep(0.35, 1.0, uv.x);
    col += pal(hue + 0.08, vec3(0.6), vec3(0.4), vec3(1.0), vec3(0.0, 0.33, 0.67))
           * emb * edgeBias * (uTreble * 0.9 + uOnset * 1.4 + 0.06) * 0.6;

    // ---- leading-edge bloom where the voice is being born ----
    float lead = exp(-pow((uv.x - 1.0) / 0.10, 2.0)) * voiced;
    col += ribCol * lead * ribbon(uv.y, pitchY, w * 9.0) * loud * 0.55;

    float vd = length(uv - 0.5);
    col *= 1.0 - vd * vd * 0.7;
    col = aces(col);
    // dither — kills banding in the dark gradients ("low-res" look)
    col += (hash12(uv * uRes + fract(uTime) * 311.0) - 0.5) * (3.0 / 255.0);
    fragColor = vec4(col, 1.0);
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
