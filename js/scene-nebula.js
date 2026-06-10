/* ORPHIC scene — STELLAR NURSERY · ember nebula
 * A raymarched volumetric nebula: gyroid-structured gas (pure trig, no
 * per-step noise) with emission/absorption integration. The music is the
 * star inside it — every beat detonates a luminous shockwave shell through
 * the gas, percussive energy flares the core star, sustained harmonic
 * content makes the gas itself glow, mids set the filament fineness, and
 * each radius shell is lit by its own spectrum slice (bass ignites the
 * heart, treble glitters the outskirts). In a rest the nebula thins to a
 * dim ember and the camera drifts away; the music's return detonates a
 * supernova flash. Reduced-res render with adaptive scaling.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const RES_MAX = 0.6, RES_MIN = 0.35;

  const MARCH_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + M.GLSL_SPECTRUM + `
  uniform vec2 uRes;
  uniform vec3 uCamPos;
  uniform float uKeyHue, uRotA, uRotB;
  uniform float uShocks[4]; // shockwave radii (normalized, <0 = inactive)

  const float RAD = 2.3;

  float density(vec3 p, float rr) {
    vec3 q = p;
    float ca = cos(uRotA), sa = sin(uRotA);
    q.xz = mat2(ca, -sa, sa, ca) * q.xz;
    float cb = cos(uRotB), sb = sin(uRotB);
    q.xy = mat2(cb, -sb, sb, cb) * q.xy;
    vec3 s = q * (3.2 + uMid * 1.6);
    float g = dot(sin(s), cos(s.zxy));
    float g2 = dot(sin(s * 2.6 + uPhaseTreble * 0.12), cos(s.yzx * 2.6));
    float den = smoothstep(1.05, 0.25, rr)
              * smoothstep(0.85, 1.45, g + g2 * 0.55 + uBass * 0.7 - rr * 1.4);
    return den * (1.0 - uQuiet * 0.7); // rests: the gas thins to embers
  }

  void main() {
    vec2 uv = (vUV - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    vec3 ro = uCamPos;
    vec3 fwd = normalize(-ro);
    vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(rgt, fwd);
    vec3 rd = normalize(fwd * 1.6 + uv.x * rgt + uv.y * up);

    // background starfield
    vec2 sc = rd.xy / (abs(rd.z) + 0.4) * 200.0;
    float star = step(0.997, hash12(floor(sc))) * smoothstep(0.5, 0.1, length(fract(sc) - 0.5));
    vec3 col = vec3(0.005, 0.006, 0.014) + vec3(star) * (0.25 + uTreble * 0.3);

    // bounding sphere: rays that miss never march
    float bq = dot(ro, rd);
    float disc = bq * bq - dot(ro, ro) + RAD * RAD;
    if (disc > 0.0) {
      float sq = sqrt(disc);
      float t0 = max(-bq - sq, 0.0), t1 = -bq + sq;
      float stepLen = (t1 - t0) / 40.0;
      float t = t0 + stepLen * hash12(gl_FragCoord.xy);
      float T = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 40; i++) {
        vec3 p = ro + rd * t;
        float rr = length(p) / RAD;
        float den = density(p, rr);
        if (den > 0.004) {
          // each radius shell is lit by its own spectrum slice
          float band = specLog(clamp(rr, 0.0, 1.0));
          vec3 emis = pal(uKeyHue + rr * 0.65 + den * 0.20,
                          vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67))
                      * (0.10 + band * 0.85 + uHarmonic * 0.25);
          // the core star: percussive flares + supernova on the return
          emis += vec3(1.0, 0.92, 0.80) * exp(-rr * rr * 40.0)
                  * (0.18 + uPercussive * 2.0 + uBurst * 4.0);
          // beat shockwaves race outward through the gas
          for (int k = 0; k < 4; k++) {
            if (uShocks[k] >= 0.0) {
              emis += vec3(0.85, 0.92, 1.0)
                      * exp(-pow((rr - uShocks[k]) * 9.0, 2.0)) * 1.4;
            }
          }
          float a = den * stepLen * 2.6;
          acc += T * emis * a;
          T *= max(0.0, 1.0 - a * 1.8);
          if (T < 0.02) break;
        }
        t += stepLen;
      }
      col = col * T + acc;
    }

    float v = length(vUV - 0.5);
    col *= 1.0 - v * v * 0.65;
    fragColor = vec4(col, 1.0);
  }`;

  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform sampler2D uTex;
  uniform vec2 uTexel;
  void main() {
    vec2 o = uTexel * 0.6;
    vec3 col = (texture(uTex, vUV + o).rgb + texture(uTex, vUV - o).rgb +
                texture(uTex, vUV + vec2(o.x, -o.y)).rgb +
                texture(uTex, vUV - vec2(o.x, -o.y)).rgb) * 0.25;
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'stellar nursery · ember nebula',
    modes: ['music', 'speech', 'ambient'],
    create(glc) {
      const pMarch = glc.program(MARCH_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const ar = M.adaptiveRes(RES_MAX, RES_MIN);
      let buf = null;
      let keyHue = 0.7;
      const shocks = new Float32Array(4).fill(-1);
      let shockIdx = 0, shockLatch = 0;

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

          // shockwave shells: beats fire them, bursts fire a fast one
          shockLatch -= dt;
          const speed = 0.55;
          for (let k = 0; k < 4; k++) {
            if (shocks[k] >= 0) {
              shocks[k] += dt * speed * (1 + f.level * 0.6);
              if (shocks[k] > 1.35) shocks[k] = -1;
            }
          }
          if ((f.beat > 0.9 || f.burst === 1) && shockLatch <= 0) {
            shocks[shockIdx] = 0.05;
            shockIdx = (shockIdx + 1) % 4;
            shockLatch = 0.15;
          }
        },
        render(out, audio, t) {
          if (!buf) this.resize(glc.width, glc.height);
          const f = audio.f;
          const ang = f.phaseLevel * 0.15;
          // rests pull the camera back from the dimming ember
          const rad = 4.2 - f.bass * 0.5 + f.quiet * 1.3;
          const cy = 1.1 * Math.sin(f.phaseLevel * 0.09);

          pMarch.use();
          M.audioUniforms(pMarch, audio, t);
          M.spectrumUniforms(pMarch, audio, 0);
          pMarch.v2('uRes', buf.w, buf.h)
                .v3('uCamPos', Math.cos(ang) * rad, cy, Math.sin(ang) * rad)
                .f('uKeyHue', keyHue)
                .f('uRotA', f.phaseBass * 0.05)
                .f('uRotB', f.phaseTreble * 0.04)
                .fv('uShocks', shocks);
          glc.draw(pMarch, buf);

          pShow.use().tex('uTex', buf.tex, 0)
               .v2('uTexel', 1 / buf.w, 1 / buf.h);
          glc.draw(pShow, out);
        },
        dispose() {
          if (buf) buf.dispose();
          pMarch.dispose(); pShow.dispose();
        },
      };
    },
  });
})();
