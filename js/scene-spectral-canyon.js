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
  uniform float uTime, uQuiet;
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
    // idle swell: slow drifting dunes so the silent canyon breathes on its own.
    // Baked here so the march pays nothing; gated by uQuiet so it melts away the
    // instant real sound returns and the spectrum reclaims the terrain.
    float swell = sin(wq.x * 0.45 + uTime * 0.27) * cos(wq.y * 0.30 - uTime * 0.21)
                + 0.45 * sin(wq.x * 0.9 - wq.y * 0.5 + uTime * 0.38);
    h += swell * 0.045 * uQuiet;
    fragColor = vec4(h, s.g, s.b, 1.0);
  }`;

  const MARCH_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uSpectrogram; // the smoothed pre-pass, not the raw history
  uniform vec2 uRes;
  uniform float uAmp, uSway, uKeyHue;
  uniform vec4 uMeteor; // az, height, progress, active

  // planetary curvature: the world drops away with distance, so approaching
  // sounds rise over the horizon like mountains over a planet's limb. Gentle
  // enough (large radius) that the ground reaches ~25 units before it grazes
  // the view, so it has room to melt into the atmosphere rather than cutting
  // off at a hard silhouette up close.
  float curveDrop(vec2 q) {
    return (q.y * q.y + q.x * q.x * 0.5) / 320.0;
  }

  const float WIDTH = 6.0;   // lateral half-extent (frequency axis)

  // the ground's silhouette distance for the current camera height (matched to
  // curveDrop's radius). The newest history row, the march limit and the melt
  // fog all key off this one value, so the LIVE audio erupts at full height
  // exactly on the visible horizon — where you watch it form — and then rides
  // toward the camera, for any camera height. Nothing is created off beyond a
  // fixed far plane where you can't see it.
  float horizonDist() {
    float camH = uAmp * 1.15 + 0.35;
    return sqrt(camH * 320.0) / 0.97;
  }

  // single fetch: blur/pow/detail are pre-baked in the smoothing pass
  float hgt(vec2 q) {
    float tH = horizonDist();
    float fx = clamp(q.x / WIDTH * 0.5 + 0.5, 0.0, 1.0);
    // newest row lands right on the horizon at FULL reactive height; older
    // history rides toward the camera. No far-side height ramp — the audio
    // sculpts the terrain where you can see it.
    float tz = clamp(q.y / tH, 0.0, 1.0);
    return texture(uSpectrogram, vec2(fx, mix(0.03, 0.985, tz))).r * uAmp
         - curveDrop(q);
  }

  float fbm3(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + 13.7; a *= 0.5; }
    return v;
  }

  // the dense low atmosphere the terrain dissolves into and the mountains rise
  // out of: a deep, dusty haze — dark enough to keep the sky's negative space,
  // hued enough to read as luminous distance rather than a flat wall.
  vec3 atmosColor(float hue) {
    return pal(hue + 0.5, vec3(0.20), vec3(0.20), vec3(1.0), vec3(0.0, 0.20, 0.45));
  }

  vec3 skyColor(vec3 rd, float hue) {
    float y = max(rd.y, 0.0);
    vec3 sky = mix(vec3(0.040, 0.022, 0.085), vec3(0.006, 0.005, 0.022),
                   pow(min(y * 1.7, 1.0), 0.55));

    // dense horizon atmosphere: a haze bank, near-opaque at the horizon and
    // thinning with altitude so the stars, meteors and aurora overhead stay
    // clear. The distant terrain fades into this exact colour, so the plane has
    // no visible edge and the mountains rise straight out of the haze. Muted in
    // silence (negative space up top), it glows brighter with the music.
    float atmo = exp(-y * 3.1);
    sky = mix(sky, atmosColor(hue) * (0.6 + uLevel * 1.05), atmo * 0.93);

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

    // idle aurora: tall drapes that sway on their own slow clock (uTime, not
    // the music phase that freezes in silence) so the sky never goes fully
    // dead. Low spatial frequency + a wide, soft band + a gentle horizontal
    // sway lets them sweep gracefully instead of flickering as a hard noise
    // threshold pops cells on and off. uQuiet fades them out the moment the
    // spectrum-driven aurora takes over.
    float icur = fbm3(vec2(az * 6.0 + uTime * 0.03,
                           y * 0.6 + sin(az * 3.0 + uTime * 0.08) * 0.12));
    float iaur = smoothstep(0.32, 0.95, icur);
    iaur *= iaur * smoothstep(0.02, 0.30, y) * exp(-y * 1.4);
    iaur *= 0.85 + 0.15 * sin(uTime * 0.18 + az * 2.0); // slow whole-veil breath
    sky += pal(hue + az * 0.35 + 0.1, vec3(0.45), vec3(0.45), vec3(1.0), vec3(0.0, 0.33, 0.67))
           * iaur * uQuiet * 0.20;

    // moon with a soft halo
    vec3 mdir = normalize(vec3(0.55, 0.42, 0.80));
    float md = max(dot(rd, mdir), 0.0);
    float moon = smoothstep(0.99955, 0.99985, md);
    sky += vec3(0.95, 0.88, 1.0) * (moon * 1.6 + pow(md, 400.0) * 0.30);

    // shooting star on onsets: bright head, fading tail
    if (uMeteor.w > 0.5) {
      vec2 dir = normalize(vec2(0.55, -0.30));
      vec2 mp = vec2(uMeteor.x, uMeteor.y) + dir * uMeteor.z * 0.45;
      vec2 sd = vec2(az, y) - mp;
      float along = dot(sd, dir), perp = dot(sd, vec2(-dir.y, dir.x));
      float head = exp(-dot(sd, sd) * 2600.0);
      float tail = exp(-perp * perp * 5200.0)
                 * step(along, 0.0) * exp(along * 16.0) * smoothstep(-0.20, -0.01, along);
      sky += vec3(0.9, 0.95, 1.0) * (head * 1.6 + tail * 0.8) * (1.0 - uMeteor.z);
    }

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
    // ground silhouette distance for this camera height (matches curveDrop's
    // radius). The fog below is tuned to saturate right here, so the flat ground
    // melts into the haze exactly as it grazes the horizon — for ANY camera
    // height, not just one tuned value.
    float tHorizon = horizonDist();
    float fogK = 4.6 / (tHorizon * tHorizon);
    vec3 ro = vec3(uSway, camH, 0.0);
    vec3 rd = normalize(vec3(uv.x * 0.9 + uSway * -0.04, uv.y * 0.9 - 0.22, 1.0));

    float hue = uKeyHue;
    // the camera is always above the terrain's max height: rays pointing up
    // can never hit, so the whole sky skips the march entirely
    if (rd.y >= 0.0) {
      fragColor = vec4(skyColor(rd, hue) * (0.75 + uLevel * 0.55), 1.0);
      return;
    }

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
      if (t > tHorizon) break;
    }

    vec3 col;
    if (hit && t < tHorizon) {
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
      float tz = clamp(p.z / tHorizon, 0.0, 1.0);
      vec3 sg = texture(uSpectrogram, vec2(fx, mix(0.03, 0.985, tz))).rgb;
      // height above the local planet surface, not the flat plane
      float hLocal = p.y + curveDrop(p.xz);
      float hN = clamp(hLocal / max(uAmp, 0.01), 0.0, 1.0);

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

      // warm rim light from the sun sunk below the horizon — silhouettes burn
      float rim = max(dot(n, normalize(vec3(0.0, 0.18, 1.0))), 0.0)
                * smoothstep(0.95, 0.35, n.y);
      col += vec3(1.0, 0.45, 0.25) * rim * rim * 0.30;

      // luminous rivers pooling in the valley floors, fed by the spectrum
      float valley = smoothstep(0.32, 0.04, hN);
      float river = smoothstep(0.45, 0.80, fbm(p.xz * vec2(1.6, 0.45)));
      col += pal(hue + fx * 0.45 + 0.35, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67))
             * valley * river * (0.25 + sg.g * 1.6 + uBeat * 0.5);

      // crystalline sparkle on the high snow
      float sparkle = step(0.992, hash12(floor(p.xz * 64.0) + floor(uTime * 9.0)));
      col += vec3(0.9, 0.95, 1.0) * sparkle * smoothstep(0.55, 0.85, hN)
             * (0.25 + uTreble * 1.1);

      // glowing mist settling in the low canyons
      col += pal(hue + 0.3, vec3(0.4), vec3(0.4), vec3(1.0), vec3(0.0, 0.33, 0.67))
             * exp(-max(hLocal, 0.0) * 2.5) * (0.05 + uHarmonic * 0.07);

      // aerial perspective: an analytic exp fog (no marching, ~free) that
      // SATURATES by the ground's silhouette distance (~25), so the terrain
      // reaches sky-colour before it curves out of view and the hard horizon
      // edge dissolves entirely. The height term lets tall peaks rise THROUGH
      // the haze instead of melting into it, so mountains still emerge over the
      // atmosphere while the flat ground around them disappears.
      float distFog = 1.0 - exp(-t * t * fogK);
      float fog = distFog * exp(-max(hLocal, 0.0) * 1.1);
      col = mix(col, skyColor(rd, hue), fog);
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
      const meteor = { az: 0, y: 0, prog: 1, cool: 0 };

      return {
        resize(w, h) {
          const bw = Math.max(8, Math.round(w * ar.scale));
          const bh = Math.max(8, Math.round(h * ar.scale));
          if (!buf) buf = glc.target(bw, bh);
          else buf.resize(bw, bh);
        },
        update(dt, audio) {
          const f = audio.f;
          keyHue = M.chromaHue(f.chroma, keyHue, dt);
          if (ar.update(dt)) this.resize(glc.width, glc.height);

          // shooting stars on strong onsets
          meteor.cool -= dt;
          if (meteor.prog >= 1 && f.onset === 1 && meteor.cool <= 0) {
            meteor.az = 0.12 + Math.random() * 0.6;
            meteor.y = 0.28 + Math.random() * 0.16;
            meteor.prog = 0;
            meteor.cool = 2.5;
          }
          if (meteor.prog < 1) meteor.prog += dt / 0.9;
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
                 .f('uTime', t)
                 .f('uQuiet', f.quiet)
                 .tex('uSG', sg.tex, 0);
          glc.draw(pSmooth, smoothT);

          pMarch.use();
          M.audioUniforms(pMarch, audio, t);
          pMarch.tex('uSpectrogram', smoothT.tex, 0)
                .v2('uRes', buf.w, buf.h)
                .f('uAmp', 1.25 + f.level * 0.6)
                .f('uSway', Math.sin(f.phaseLevel * 0.18) * 1.1)
                .f('uKeyHue', keyHue)
                .v4('uMeteor', meteor.az, meteor.y, Math.min(meteor.prog, 1),
                    meteor.prog < 1 ? 1 : 0);
          glc.draw(pMarch, buf);

          pShow.use().tex('uTex', buf.tex, 0)
               .v2('uTexel', 1 / buf.w, 1 / buf.h);
          glc.draw(pShow, out);
        },
        dispose() {
          if (buf) buf.dispose();
          if (smoothT) smoothT.dispose();
          for (const p of [pSmooth, pMarch, pShow]) p.dispose();
        },
      };
    },
  });
})();
