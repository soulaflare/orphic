/* ORPHIC scene — SPECTRAL CANYON · spectrogram terrain
 * The landscape IS the music's spectrum: a raymarched heightfield over the
 * scrolling spectrogram history. Lateral position = log frequency (bass
 * ranges rise on the left, treble ripples on the right), depth = time, so
 * every sound erupts on the horizon and rides toward the camera.
 *
 * Performance design: ALL per-height work (blur of the spiky raw FFT, the
 * pow() shaping, the rocky fbm detail) is baked once per frame into a small
 * 512×256 pre-pass, so the march samples a single texture per step. Sky rays
 * never march (the camera is always above the terrain's max height), ray
 * length is clamped to the ground-plane crossing, and the internal render
 * scale adapts to the measured frame rate.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const RES_MAX = 0.75, RES_MIN = 0.4;

  // Blur + shape + detail the spectrogram once per frame. Raw byte-FFT rows
  // read as needle spikes, so terrain needs C1-smooth heights. The fbm detail
  // is anchored to uScroll so it rides with the scrolling mountains.
  const SMOOTH_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform sampler2D uSG;
  uniform vec2 uTexel;
  uniform float uScroll; // rows scrolled / height — keeps noise glued to content
  void main() {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int j = 0; j <= 2; j++) {
      float wy = j == 0 ? 0.5 : (j == 1 ? 0.3 : 0.2);
      for (int i = -2; i <= 2; i++) {
        float w = wy * exp(-float(i * i) * 0.5);
        acc += texture(uSG, vUV + vec2(float(i) * uTexel.x, float(j) * uTexel.y)).rgb * w;
        wsum += w;
      }
    }
    vec3 s = acc / wsum;
    // bake the height shaping + rocky multi-octave detail (world-scaled)
    vec2 wq = vec2(vUV.x * 12.0, (vUV.y + uScroll) * 24.0);
    float detail = (fbm(wq * vec2(3.0, 1.8)) - 0.5) * 0.14;
    float h = pow(s.r, 1.5) * (1.0 + detail);
    fragColor = vec4(h, s.g, s.b, 1.0);
  }`;

  const MARCH_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + M.GLSL_SPECTRUM + `
  uniform vec2 uRes;
  uniform float uAmp, uSway, uKeyHue;

  const float WIDTH = 6.0;   // lateral half-extent (frequency axis)
  const float DEPTH = 24.0;  // view distance (time axis)

  // single fetch: blur/pow/detail are pre-baked in the smoothing pass
  float hgt(vec2 q) {
    float fx = clamp(q.x / WIDTH * 0.5 + 0.5, 0.0, 1.0);
    float tz = clamp(q.y / DEPTH, 0.0, 1.0);
    // newest history row sits at the horizon: sounds approach the camera
    return texture(uSpectrogram, vec2(fx, mix(0.03, 0.985, tz))).r * uAmp;
  }

  float fbm3(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + 13.7; a *= 0.5; }
    return v;
  }

  vec3 skyColor(vec3 rd, float hue) {
    float y = max(rd.y, 0.0);
    vec3 sky = mix(vec3(0.040, 0.022, 0.085), vec3(0.006, 0.005, 0.022),
                   pow(min(y * 1.7, 1.0), 0.55));

    float az = clamp(rd.x * 0.55 + 0.5, 0.0, 1.0);
    // the smoothed newest history row: a calm live equalizer
    float eq = texture(uSpectrogram, vec2(az, 0.985)).r;

    // equalizer skyline: a thin ribbon whose height follows the spectrum
    float ribbon = exp(-pow((y - eq * 0.12) * 46.0, 2.0));
    sky += pal(hue + az * 0.5 + 0.45, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67))
           * ribbon * eq * (1.6 + uBeat * 1.6);

    // aurora curtains: vary fast across azimuth, smooth in height, so they
    // hang as vertical drapes instead of smearing sideways
    float curt = fbm3(vec2(az * 14.0 + uPhaseLevel * 0.18, y * 1.1 - uPhaseLevel * 0.03));
    float aur = pow(smoothstep(0.40, 0.85, curt), 2.0)
              * smoothstep(0.03, 0.22, y) * exp(-y * 1.3) * eq;
    sky += pal(hue + az * 0.35, vec3(0.45), vec3(0.45), vec3(1.0), vec3(0.0, 0.33, 0.67))
           * aur * (0.55 + uBeat * 0.6);

    // ground haze so the terrain silhouette reads against the sky
    sky += pal(hue + az * 0.5, vec3(0.4), vec3(0.4), vec3(1.0), vec3(0.0, 0.33, 0.67))
           * exp(-y * 8.0) * 0.06;

    // moon with a soft halo
    vec3 mdir = normalize(vec3(0.55, 0.42, 0.80));
    float md = max(dot(rd, mdir), 0.0);
    float moon = smoothstep(0.99955, 0.99985, md);
    sky += vec3(0.95, 0.88, 1.0) * (moon * 1.6 + pow(md, 400.0) * 0.30);

    // round stars on a stable directional grid
    if (rd.z > 0.25) {
      vec2 sc = rd.xy / rd.z * 220.0;
      float h = hash12(floor(sc));
      float star = smoothstep(0.995, 1.0, h)
                 * smoothstep(0.45, 0.05, length(fract(sc) - 0.5));
      sky += vec3(star) * smoothstep(0.12, 0.35, y) * (0.35 + uTreble * 0.4);
    }
    return sky;
  }

  void main() {
    vec2 uv = (vUV - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float camH = uAmp * 1.15 + 0.35;
    vec3 ro = vec3(uSway, camH, 0.0);
    vec3 rd = normalize(vec3(uv.x * 0.9 + uSway * -0.04, uv.y * 0.9 - 0.22, 1.0));

    float hue = uKeyHue;
    // the camera is always above the terrain's max height: rays pointing up
    // can never hit, so the whole sky skips the march entirely
    if (rd.y >= 0.0) {
      fragColor = vec4(skyColor(rd, hue) * (0.75 + uLevel * 0.55), 1.0);
      return;
    }

    // downward rays cross y=0 at a known distance: clamp the march there
    float tMax = min(DEPTH, -ro.y / rd.y + 0.5);

    // dithered start + short steps + bisection: no terracing, no speckled tips
    float t = 0.06 + hash12(gl_FragCoord.xy) * 0.06;
    float tPrev = t;
    bool hit = false;
    for (int i = 0; i < 120; i++) {
      vec3 p = ro + rd * t;
      float dh = p.y - hgt(p.xz);
      if (dh < 0.0015 * t) { hit = true; break; }
      tPrev = t;
      t += max(dh * 0.35, 0.012);
      if (t > tMax) break;
    }

    vec3 col;
    if (hit && t < DEPTH) {
      // bisection refine between the last two samples
      float t0 = tPrev, t1 = t;
      for (int j = 0; j < 6; j++) {
        float tm = 0.5 * (t0 + t1);
        vec3 pm = ro + rd * tm;
        if (pm.y - hgt(pm.xz) < 0.0) t1 = tm; else t0 = tm;
      }
      t = 0.5 * (t0 + t1);
      vec3 p = ro + rd * t;

      // distance-scaled normal taps: constant-width taps moiré in the distance
      float ne = max(0.03, t * 0.012);
      vec2 e = vec2(ne, 0.0);
      vec3 n = normalize(vec3(hgt(p.xz - e.xy) - hgt(p.xz + e.xy), 2.0 * ne,
                              hgt(p.xz - e.yx) - hgt(p.xz + e.yx)));

      float fx = clamp(p.x / WIDTH * 0.5 + 0.5, 0.0, 1.0);
      float tz = clamp(p.z / DEPTH, 0.0, 1.0);
      vec3 sg = texture(uSpectrogram, vec2(fx, mix(0.03, 0.985, tz))).rgb;
      float hN = clamp(p.y / max(uAmp, 0.01), 0.0, 1.0);

      vec3 base = pal(hue + fx * 0.45, vec3(0.45), vec3(0.45), vec3(1.0), vec3(0.0, 0.33, 0.67));
      // side-top key light (matches the moon): frontal light flattens relief
      vec3 ldir = normalize(vec3(0.55, 0.42, 0.80));
      float dif = max(dot(n, ldir), 0.0);
      float amb = 0.5 + 0.5 * n.y;
      vec3 hv = normalize(ldir - rd);
      float spe = pow(max(dot(n, hv), 0.0), 48.0) * dif;

      col = base * (0.04 + dif * 0.55 * vec3(1.0, 0.92, 0.85) + amb * 0.13)
          * (0.35 + hN * 0.85);
      col += vec3(0.9, 0.85, 1.0) * spe * 0.35;

      // faint AA'd survey grid, only on gentle slopes and near ground
      float gw = fwidth(fx * 24.0) * 1.5;
      float gx = 1.0 - smoothstep(0.0, gw, abs(fract(fx * 24.0) - 0.5) - 0.02);
      float zw = fwidth(p.z * 2.0) * 1.5;
      float gz = 1.0 - smoothstep(0.0, zw, abs(fract(p.z * 2.0) - 0.5) - 0.02);
      col += base * max(gx, gz) * 0.05 * smoothstep(0.55, 0.9, n.y) * exp(-t * 0.22);

      // crest glow rides the peak-decay envelope where the terrain is tall
      float crest = smoothstep(0.55, 1.0, hN) * sg.b;
      col += pal(hue + fx * 0.45 + 0.5, vec3(0.55), vec3(0.45), vec3(1.0), vec3(0.0, 0.33, 0.67))
             * crest * (1.2 + uBeat * 1.6);

      // distance fog into the sky
      col = mix(col, skyColor(rd, hue), smoothstep(DEPTH * 0.45, DEPTH * 0.98, t));
    } else {
      col = skyColor(rd, hue);
    }

    col *= 0.75 + uLevel * 0.55;
    fragColor = vec4(col, 1.0);
  }`;

  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform sampler2D uTex;
  uniform vec2 uTexel;
  void main() {
    // 4-tap soften: the march is 1 spp and ridge silhouettes alias hard
    vec2 o = uTexel * 0.5;
    vec3 col = (texture(uTex, vUV + o).rgb + texture(uTex, vUV - o).rgb +
                texture(uTex, vUV + vec2(o.x, -o.y)).rgb +
                texture(uTex, vUV - vec2(o.x, -o.y)).rgb) * 0.25;
    float v = length(vUV - 0.5);
    col *= 1.0 - v * v * 0.6;
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'spectral canyon · spectrogram terrain',
    modes: ['music', 'speech'],
    create(glc) {
      const pSmooth = glc.program(SMOOTH_FRAG);
      const pMarch = glc.program(MARCH_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const ar = M.adaptiveRes(RES_MAX, RES_MIN);
      let buf = null, smoothT = null;
      let keyHue = 0.62;
      let frames = 0;

      return {
        resize(w, h) {
          const bw = Math.max(8, Math.round(w * ar.scale));
          const bh = Math.max(8, Math.round(h * ar.scale));
          if (!buf) buf = glc.target(bw, bh);
          else buf.resize(bw, bh);
        },
        update(dt, audio) {
          keyHue = M.chromaHue(audio.f.chroma, keyHue, dt);
          if (ar.update(dt)) this.resize(glc.width, glc.height);
        },
        render(out, audio, t) {
          if (!buf) this.resize(glc.width, glc.height);
          const f = audio.f;
          const sg = audio.tex.sg.read;
          if (!smoothT) smoothT = glc.target(sg.w, sg.h);
          frames++;

          pSmooth.use()
                 .v2('uTexel', 1 / sg.w, 1 / sg.h)
                 .f('uScroll', frames / sg.h)
                 .tex('uSG', sg.tex, 0);
          glc.draw(pSmooth, smoothT);

          pMarch.use();
          M.audioUniforms(pMarch, audio, t);
          M.spectrumUniforms(pMarch, audio, 0);
          pMarch.tex('uSpectrogram', smoothT.tex, 2) // smoothed override
                .v2('uRes', buf.w, buf.h)
                .f('uAmp', 1.25 + f.level * 0.6)
                .f('uSway', Math.sin(f.phaseLevel * 0.18) * 1.1)
                .f('uKeyHue', keyHue);
          glc.draw(pMarch, buf);

          pShow.use().tex('uTex', buf.tex, 0)
               .v2('uTexel', 1 / buf.w, 1 / buf.h);
          glc.draw(pShow, out);
        },
        dispose() {
          if (buf) buf.dispose();
          if (smoothT) smoothT.dispose();
        },
      };
    },
  });
})();
