/* ORPHIC scene — STABLE FLUIDS · ink nebula
 * Jos Stam's "Stable Fluids" (1999) with vorticity confinement, the
 * GPU-fluid lineage popularised by GPU Gems / Pavel Dobryakov. Velocity at
 * quarter res, dye at half res, 20 Jacobi pressure iterations. Audio: beats
 * fire radial ink bursts from a precessing ring, onsets add side jets,
 * sustained level feeds two orbiting emitters, treble adds swirl
 * (vorticity), and in speech mode the emitter rides the pitch contour.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const H = M.FRAG_HEADER;

  const ADVECT = H + `
  uniform sampler2D uVelocity, uSource;
  uniform vec2 uTexel;
  uniform float uDt, uDissipation;
  void main() {
    vec2 coord = vUV - uDt * texture(uVelocity, vUV).xy * uTexel;
    fragColor = texture(uSource, coord) * uDissipation;
  }`;

  const SPLAT = H + `
  uniform sampler2D uTarget;
  uniform vec3 uColor;
  uniform vec2 uPoint;
  uniform float uRadius, uAspect, uCap;
  void main() {
    vec2 p = vUV - uPoint;
    p.x *= uAspect;
    vec3 c = texture(uTarget, vUV).xyz + uColor * exp(-dot(p, p) / uRadius);
    // dye only (uCap=1): limit the max channel while preserving the ratios,
    // so stacked splats saturate toward their hue instead of clipping to
    // white paste. Velocity splats (uCap=0) must stay unclamped.
    float m = max(c.r, max(c.g, c.b));
    if (uCap > 0.5 && m > 1.0) c /= m;
    fragColor = vec4(c, 1.0);
  }`;

  const CURL = H + `
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;
  void main() {
    float L = texture(uVelocity, vUV - vec2(uTexel.x, 0.0)).y;
    float R = texture(uVelocity, vUV + vec2(uTexel.x, 0.0)).y;
    float B = texture(uVelocity, vUV - vec2(0.0, uTexel.y)).x;
    float T = texture(uVelocity, vUV + vec2(0.0, uTexel.y)).x;
    fragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
  }`;

  const VORTICITY = H + `
  uniform sampler2D uVelocity, uCurl;
  uniform vec2 uTexel;
  uniform float uStrength, uDt;
  void main() {
    float L = texture(uCurl, vUV - vec2(uTexel.x, 0.0)).x;
    float R = texture(uCurl, vUV + vec2(uTexel.x, 0.0)).x;
    float B = texture(uCurl, vUV - vec2(0.0, uTexel.y)).x;
    float T = texture(uCurl, vUV + vec2(0.0, uTexel.y)).x;
    float C = texture(uCurl, vUV).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 1e-4;
    force *= uStrength * C * vec2(1, -1);
    vec2 vel = texture(uVelocity, vUV).xy + force * uDt;
    fragColor = vec4(clamp(vel, -1000.0, 1000.0), 0.0, 1.0);
  }`;

  const DIVERGENCE = H + `
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;
  void main() {
    float L = texture(uVelocity, vUV - vec2(uTexel.x, 0.0)).x;
    float R = texture(uVelocity, vUV + vec2(uTexel.x, 0.0)).x;
    float B = texture(uVelocity, vUV - vec2(0.0, uTexel.y)).y;
    float T = texture(uVelocity, vUV + vec2(0.0, uTexel.y)).y;
    fragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
  }`;

  const PRESSURE = H + `
  uniform sampler2D uPressure, uDivergence;
  uniform vec2 uTexel;
  void main() {
    float L = texture(uPressure, vUV - vec2(uTexel.x, 0.0)).x;
    float R = texture(uPressure, vUV + vec2(uTexel.x, 0.0)).x;
    float B = texture(uPressure, vUV - vec2(0.0, uTexel.y)).x;
    float T = texture(uPressure, vUV + vec2(0.0, uTexel.y)).x;
    float div = texture(uDivergence, vUV).x;
    fragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
  }`;

  const GRADIENT = H + `
  uniform sampler2D uPressure, uVelocity;
  uniform vec2 uTexel;
  void main() {
    float L = texture(uPressure, vUV - vec2(uTexel.x, 0.0)).x;
    float R = texture(uPressure, vUV + vec2(uTexel.x, 0.0)).x;
    float B = texture(uPressure, vUV - vec2(0.0, uTexel.y)).x;
    float T = texture(uPressure, vUV + vec2(0.0, uTexel.y)).x;
    vec2 vel = texture(uVelocity, vUV).xy - 0.5 * vec2(R - L, T - B);
    fragColor = vec4(vel, 0.0, 1.0);
  }`;

  const SHOW = H + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uDye;
  uniform vec2 uTexel;
  void main() {
    vec3 c = texture(uDye, vUV).rgb;
    // soft self-shadowing from dye density gradient
    float l = dot(texture(uDye, vUV - uTexel).rgb, vec3(0.33));
    float r = dot(texture(uDye, vUV + uTexel).rgb, vec3(0.33));
    c *= 0.92 + (r - l) * 1.6;
    c *= 1.25;
    c += c * uBeat * 0.18;
    float d = length(vUV - 0.5);
    c *= 1.0 - d * d * 0.75;
    fragColor = vec4(aces(c), 1.0);
  }`;

  M.registerScene({
    name: 'ink nebula · stable fluids',
    modes: ['music', 'speech', 'ambient'],
    create(glc) {
      const progs = {
        advect: glc.program(ADVECT), splat: glc.program(SPLAT),
        curl: glc.program(CURL), vort: glc.program(VORTICITY),
        div: glc.program(DIVERGENCE), press: glc.program(PRESSURE),
        grad: glc.program(GRADIENT), show: glc.program(SHOW),
      };
      let vel = null, dye = null, curlT = null, divT = null, press = null;
      let beatCount = 0, emitterAng = 0, primed = false;

      function alloc(w, h) {
        const sw = Math.max(2, w >> 2), sh = Math.max(2, h >> 2);
        const dw = Math.max(2, w >> 1), dh = Math.max(2, h >> 1);
        if (vel) { vel.dispose(); dye.dispose(); curlT.dispose(); divT.dispose(); press.dispose(); }
        vel = glc.pingpong(sw, sh);
        dye = glc.pingpong(dw, dh);
        curlT = glc.target(sw, sh);
        divT = glc.target(sw, sh);
        press = glc.pingpong(sw, sh);
        vel.a.clear(); vel.b.clear(); dye.a.clear(); dye.b.clear();
        press.a.clear(); press.b.clear();
      }

      function doSplat(x, y, dx, dy, color, radius) {
        const aspect = vel.read.w / vel.read.h;
        progs.splat.use()
          .v2('uPoint', x, y).f('uRadius', radius).f('uAspect', aspect)
          .v3('uColor', dx, dy, 0).f('uCap', 0)
          .tex('uTarget', vel.read.tex, 0);
        glc.draw(progs.splat, vel.write); vel.swap();
        progs.splat.use()
          .v2('uPoint', x, y).f('uRadius', radius).f('uAspect', aspect)
          .v3('uColor', color[0], color[1], color[2]).f('uCap', 1)
          .tex('uTarget', dye.read.tex, 0);
        glc.draw(progs.splat, dye.write); dye.swap();
      }

      return {
        resize(w, h) { alloc(w, h); primed = false; },
        update(dt, audio, t) {
          if (!vel) return;
          const f = audio.f;
          const sdt = Math.min(dt, 1 / 40);
          const sTexel = [1 / vel.read.w, 1 / vel.read.h];

          if (!primed) {
            // open with ink already swirling — an empty dish takes ~10s of
            // beats to fill and reads as a black screen
            primed = true;
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2 + Math.random();
              const px = 0.5 + Math.cos(a) * (0.18 + Math.random() * 0.12);
              const py = 0.5 + Math.sin(a) * (0.18 + Math.random() * 0.12);
              doSplat(px, py, Math.cos(a) * 260, Math.sin(a) * 260,
                      hsv((i / 6 + Math.random() * 0.08) % 1, 0.85, 0.55), 0.008);
            }
          }

          // ---- audio-driven forcing ----
          if (f.burst === 1) {
            // music returns: a white-hot ring detonates through the still ink
            const n = 7;
            for (let i = 0; i < n; i++) {
              const a = (i / n) * Math.PI * 2 + Math.random();
              const ox = 0.5 + Math.cos(a) * 0.10, oy = 0.5 + Math.sin(a) * 0.10;
              doSplat(ox, oy, Math.cos(a) * 650, Math.sin(a) * 650,
                      [0.9, 0.85, 0.75], 0.004);
            }
          }
          if (f.beat > 0.9) {
            beatCount++;
            const n = 6;
            const hue = (beatCount * 0.13 + f.centroid * 0.3) % 1;
            // the ring breathes across beats so ink reaches the whole frame,
            // not one orbit — but never collapses to centre: the middle stays
            // a dark eye the ink billows around, only fed by swirl
            const ring = 0.24 + 0.08 * Math.sin(beatCount * 0.53);
            for (let i = 0; i < n; i++) {
              const a = (i / n) * Math.PI * 2 + beatCount * 0.7;
              const c = hsv((hue + i * 0.055) % 1, 0.85, 0.6 + f.bass * 0.4);
              // offset from centre: a pure radial burst at one point is all
              // divergence and the pressure solve would erase it
              const ox = 0.5 + Math.cos(a) * ring, oy = 0.5 + Math.sin(a) * ring;
              doSplat(ox, oy, Math.cos(a) * 380 * (0.4 + f.bass), Math.sin(a) * 380 * (0.4 + f.bass), c, 0.005 + f.bass * 0.005);
            }
          }
          if (f.onset > 0.9 && f.beat <= 0.9) {
            // off-centre like the beat ring — the middle stays a dark eye
            const oa = Math.random() * Math.PI * 2;
            const or = 0.18 + Math.random() * 0.16;
            const x = 0.5 + Math.cos(oa) * or, y = 0.5 + Math.sin(oa) * or;
            const a = Math.random() * Math.PI * 2;
            const c = hsv((f.centroid * 0.8 + 0.55) % 1, 0.9, 0.4);
            doSplat(x, y, Math.cos(a) * 280, Math.sin(a) * 280, c, 0.002);
          }
          // continuous orbital emitters breathe with the level
          emitterAng += sdt * (0.35 + f.mid * 1.2);
          if (f.level > 0.05) {
            for (let e = 0; e < 2; e++) {
              const a = emitterAng + e * Math.PI;
              const px = 0.5 + Math.cos(a) * 0.27;
              const py = audio.mode === 'speech'
                ? 0.25 + f.pitchNorm * 0.5
                : 0.5 + Math.sin(a) * 0.27;
              const hue = (t * 0.02 + e * 0.45 + f.centroid * 0.25) % 1;
              const c = hsv(hue, 0.8, 0.14 + f.level * 0.40);
              doSplat(px, py, -Math.sin(a) * 250 * f.level, Math.cos(a) * 250 * f.level, c, 0.0022);
            }
          }

          // ---- fluid step ----
          progs.curl.use().v2('uTexel', sTexel[0], sTexel[1]).tex('uVelocity', vel.read.tex, 0);
          glc.draw(progs.curl, curlT);
          progs.vort.use().v2('uTexel', sTexel[0], sTexel[1])
            .f('uStrength', 22 + f.treble * 40).f('uDt', sdt)
            .tex('uVelocity', vel.read.tex, 0).tex('uCurl', curlT.tex, 1);
          glc.draw(progs.vort, vel.write); vel.swap();

          progs.div.use().v2('uTexel', sTexel[0], sTexel[1]).tex('uVelocity', vel.read.tex, 0);
          glc.draw(progs.div, divT);
          press.a.clear(); press.b.clear();
          for (let i = 0; i < 20; i++) {
            progs.press.use().v2('uTexel', sTexel[0], sTexel[1])
              .tex('uPressure', press.read.tex, 0).tex('uDivergence', divT.tex, 1);
            glc.draw(progs.press, press.write); press.swap();
          }
          progs.grad.use().v2('uTexel', sTexel[0], sTexel[1])
            .tex('uPressure', press.read.tex, 0).tex('uVelocity', vel.read.tex, 1);
          glc.draw(progs.grad, vel.write); vel.swap();

          progs.advect.use().v2('uTexel', sTexel[0], sTexel[1])
            .f('uDt', sdt).f('uDissipation', 0.998)
            .tex('uVelocity', vel.read.tex, 0).tex('uSource', vel.read.tex, 0);
          glc.draw(progs.advect, vel.write); vel.swap();

          progs.advect.use().v2('uTexel', sTexel[0], sTexel[1])
            // dye half-life ~2s: ink should linger and billow between beats
            // (0.988 emptied the frame in ~1s), while rests still clear it
            .f('uDt', sdt).f('uDissipation', 0.994 - f.flux * 0.004 - f.quiet * 0.015)
            .tex('uVelocity', vel.read.tex, 0).tex('uSource', dye.read.tex, 1);
          glc.draw(progs.advect, dye.write); dye.swap();
        },
        render(out, audio, t) {
          if (!dye) return;
          progs.show.use()
            .v2('uTexel', 1 / dye.read.w, 1 / dye.read.h)
            .tex('uDye', dye.read.tex, 0);
          M.audioUniforms(progs.show, audio, t);
          glc.draw(progs.show, out);
        },
        dispose() {
          if (vel) { vel.dispose(); dye.dispose(); curlT.dispose(); divT.dispose(); press.dispose(); }
        },
      };

      function hsv(h, s, v) {
        const i = Math.floor(h * 6), fr = h * 6 - i;
        const p = v * (1 - s), q = v * (1 - fr * s), u = v * (1 - (1 - fr) * s);
        const k = i % 6;
        return [[v, u, p], [q, v, p], [p, v, u], [p, q, v], [u, p, v], [v, p, q]][k];
      }
    },
  });
})();
