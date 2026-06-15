/* ORPHIC scene — OBSIDIAN SANCTUM · mandelbox
 * Raymarched Mandelbox (Tom Lowe 2010) with orbit-trap coloring. The music
 * reshapes the fractal itself: bass drives the fold scale (kicks reconfigure
 * the topology), mids twist the box fold, the orbit-trap shells are lit
 * per-frequency from the live spectrum (bass glows the deep interior shells,
 * treble the outer filigree), and the palette sits on the current musical key
 * via the chroma circle of fifths. Rendered at reduced resolution, then
 * upscaled with kick-driven chromatic aberration.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const RES_MAX = 0.66, RES_MIN = 0.4;

  const MARCH_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + M.GLSL_SPECTRUM + `
  uniform vec2 uRes;
  uniform vec3 uCamPos, uCamTarget;
  uniform float uScale, uFold, uMinR2, uFixR2, uKeyHue, uFov;

  float DE(vec3 p, out vec4 trap) {
    vec3 z = p;
    float dr = 1.0;
    trap = vec4(1e9);
    for (int i = 0; i < 11; i++) {
      z = clamp(z, -uFold, uFold) * 2.0 - z;          // box fold
      float r2 = dot(z, z);
      trap = min(trap, vec4(abs(z), r2));
      if (r2 < uMinR2) { float f = uFixR2 / uMinR2; z *= f; dr *= f; }
      else if (r2 < uFixR2) { float f = uFixR2 / r2; z *= f; dr *= f; }
      z = z * uScale + p;
      dr = dr * abs(uScale) + 1.0;
    }
    return length(z) / abs(dr);
  }

  vec3 normalAt(vec3 p, float t) {
    float h = 0.0008 * (t * 0.5 + 0.2); // track the hit epsilon, else normals stipple
    vec2 e = vec2(h, -h);
    vec4 tr;
    return normalize(e.xyy * DE(p + e.xyy, tr) + e.yyx * DE(p + e.yyx, tr) +
                     e.yxy * DE(p + e.yxy, tr) + e.xxx * DE(p + e.xxx, tr));
  }

  void main() {
    vec2 uv = (vUV - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    vec3 ro = uCamPos;
    vec3 fwd = normalize(uCamTarget - ro);
    vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(rgt, fwd);
    vec3 rd = normalize(fwd / uFov + uv.x * rgt + uv.y * up);

    vec3 bg = vec3(0.010, 0.012, 0.028) * (1.2 - uv.y * 0.6);

    // bounding sphere (r=8 comfortably holds every fold configuration):
    // rays that miss it — most of the frame — never march at all
    float bq = dot(ro, rd);
    float disc = bq * bq - dot(ro, ro) + 64.0;
    if (disc < 0.0) { fragColor = vec4(bg * (0.7 + uLevel * 0.7), 1.0); return; }
    float sq = sqrt(disc);
    float tExit = -bq + sq;

    float t = max(-bq - sq, 0.0);
    vec4 trap = vec4(0.0);
    vec3 p = ro;
    bool hit = false;
    float steps = 0.0;
    for (int i = 0; i < 96; i++) {
      p = ro + rd * t;
      float d = DE(p, trap);
      steps = float(i);
      if (d < 0.0008 * (t * 0.5 + 0.2)) { hit = true; break; }
      t += d * 0.85;
      if (t > tExit) break;
    }

    vec3 col = bg;
    if (hit) {
      vec3 n = normalAt(p, t);
      float ao = pow(1.0 - steps / 96.0, 1.5);
      vec3 l1 = normalize(vec3(0.7, 0.9, -0.4));
      vec3 l2 = normalize(vec3(-0.6, -0.25, 0.8));
      vec3 dif = max(dot(n, l1), 0.0) * (1.1 + uBeat * 0.4) * vec3(1.0, 0.86, 0.72)
               + max(dot(n, l2), 0.0) * 0.4 * vec3(0.45, 0.65, 1.0);
      float fre = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);

      // hue rides smooth world position; the trap only accents — per-pixel
      // trap hue reads as confetti on fractal surfaces
      float hue = uKeyHue + p.y * 0.035 + length(p.xz) * 0.02 + trap.x * 0.08;
      vec3 base = pal(hue, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));

      // per-frequency glow by altitude: bass lights the temple's base,
      // treble its spires (smooth in p, so no per-pixel confetti)
      float band = specLog(clamp(p.y * 0.10 + 0.5, 0.0, 1.0));
      float cavity = smoothstep(0.8, 0.2, trap.w); // glow pools in the recesses
      vec3 emis = pal(hue + 0.45, vec3(0.55), vec3(0.45), vec3(1.0), vec3(0.0, 0.33, 0.67))
                  * band * band * cavity * (2.2 + uBeat * 2.6 + uBurst * 3.5);

      col = base * (vec3(0.07) + dif) * ao
          + base * fre * 0.6
          + emis * ao;
      col = mix(col, bg, smoothstep(9.0, 28.0, t));
    }
    col *= 0.7 + uLevel * 0.7;
    fragColor = vec4(col, 1.0);
  }`;

  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uTex;
  uniform vec2 uTexel;
  void main() {
    // 4-tap soften (the march is 1 spp and fractal surfaces alias hard)
    vec2 o = uTexel * 0.75;
    // kick-driven chromatic aberration toward the edges
    vec2 d = (vUV - 0.5) * uBassFast * 0.012;
    vec3 c1 = texture(uTex, vUV + d + o).rgb + texture(uTex, vUV + d - o).rgb;
    vec3 c2 = texture(uTex, vUV - d + vec2(o.x, -o.y)).rgb
            + texture(uTex, vUV - d - vec2(o.x, -o.y)).rgb;
    vec3 col = vec3(c1.r * 0.5, (c1.g + c2.g) * 0.25, c2.b * 0.5);
    float v = length(vUV - 0.5);
    col *= 1.0 - v * v * 0.7;
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'obsidian sanctum · mandelbox',
    modes: ['music'],
    create(glc) {
      const pMarch = glc.program(MARCH_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const ar = M.adaptiveRes(RES_MAX, RES_MIN);
      let buf = null;
      let keyHue = 0;
      let scale = 2.5, fold = 1.05, minR2 = 0.32;

      return {
        resize(w, h) {
          const bw = Math.max(8, Math.round(w * ar.scale));
          const bh = Math.max(8, Math.round(h * ar.scale));
          if (!buf) buf = glc.target(bw, bh);
          else buf.resize(bw, bh);
        },
        update(dt, audio, t) {
          const f = audio.f;
          keyHue = M.chromaHue(f.chroma, keyHue, dt);
          if (ar.update(dt)) this.resize(glc.width, glc.height);
          // topology morphs on loudness phase, punched by the bass envelope
          scale = 2.2 + 0.35 * Math.sin(f.phaseLevel * 0.13) + f.bass * 0.4;
          fold = 1.0 + 0.12 * Math.sin(f.phaseBass * 0.07) + f.mid * 0.22;
          minR2 = 0.27 + 0.18 * (0.5 + 0.5 * Math.sin(f.phaseTreble * 0.05));
        },
        render(out, audio, t) {
          if (!buf) this.resize(glc.width, glc.height);
          const f = audio.f;
          const ang = f.phaseLevel * 0.21;
          const rad = 12.5 - f.bass * 1.6 + Math.sin(f.phaseBass * 0.09) * 1.0;
          // stay elevated: corner perspectives read as 3D, face-on reads flat
          const cy = rad * (0.30 + 0.18 * Math.sin(f.phaseLevel * 0.11));

          pMarch.use();
          M.audioUniforms(pMarch, audio, t);
          M.spectrumUniforms(pMarch, audio, 0);
          pMarch.v2('uRes', buf.w, buf.h)
                .v3('uCamPos', Math.cos(ang) * rad, cy, Math.sin(ang) * rad)
                .v3('uCamTarget', 0, -0.6 + 0.5 * Math.sin(f.phaseLevel * 0.07), 0)
                .f('uScale', scale).f('uFold', fold)
                .f('uMinR2', minR2).f('uFixR2', 1.0)
                .f('uKeyHue', keyHue)
                .f('uFov', 0.78 + f.bassFast * 0.06);
          glc.draw(pMarch, buf);

          pShow.use().tex('uTex', buf.tex, 0)
               .v2('uTexel', 1 / buf.w, 1 / buf.h);
          M.audioUniforms(pShow, audio, t);
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
