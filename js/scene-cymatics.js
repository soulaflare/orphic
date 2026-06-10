/* ORPHIC scene — CYMATICS · chladni resonance
 * Chladni plate eigenmodes: w = cos(nπx)cos(mπy) − cos(mπx)cos(nπy).
 * Sand collects on nodal lines (w ≈ 0); here the nodal web glows instead.
 * Three superimposed mode pairs are weighted by bass / mid / treble, so the
 * plate literally resonates with the spectrum; beats spring the mode numbers
 * to new integers (a struck plate re-settling), flux warps the metal.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;

  const FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform vec4 uModeA; // n1, m1, n2, m2
  uniform vec4 uModeB; // n3, m3, rot, zoom
  uniform vec2 uRes;

  float chladni(vec2 p, float n, float m) {
    return cos(n * 3.14159 * p.x) * cos(m * 3.14159 * p.y)
         - cos(m * 3.14159 * p.x) * cos(n * 3.14159 * p.y);
  }

  void main() {
    vec2 uv = (vUV - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float rot = uModeB.z;
    uv = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * uv;
    uv *= uModeB.w;

    // metal shimmer: domain warp driven by spectral flux
    vec2 warp = vec2(fbm(uv * 3.0 + uTime * 0.1), fbm(uv * 3.0 - uTime * 0.13)) - 0.5;
    vec2 p = uv + warp * (0.015 + uFlux * 0.25);

    float w1 = chladni(p, uModeA.x, uModeA.y);
    float w2 = chladni(p, uModeA.z, uModeA.w);
    float w3 = chladni(p, uModeB.x, uModeB.y);
    float w = w1 * (0.35 + uBass * 1.1)
            + w2 * (0.25 + uMid * 0.9)
            + w3 * (0.18 + uTreble * 0.8);

    // glowing nodal lines + interference shading between them. Keep the
    // exponent high even when loud: low mode pairs already flatten |w|
    // across the plate, and a soft exponent there turns the whole frame
    // into washed-out glow instead of a nodal web
    float line = exp(-abs(w) * (11.0 - uLevel * 3.0));
    float fill = 0.5 + 0.5 * sin(w * 2.2);

    float hue = uCentroid * 0.5 + uPhaseLevel * 0.015 + length(uv) * 0.06;
    vec3 lineCol = pal(hue, vec3(0.55), vec3(0.45), vec3(1.0), vec3(0.0, 0.33, 0.67));
    vec3 fillCol = pal(hue + 0.45, vec3(0.20), vec3(0.18), vec3(1.0), vec3(0.0, 0.33, 0.67));

    vec3 col = fillCol * fill * fill * 0.7;
    col += lineCol * line * (1.5 + uBeat * 1.5);
    // sand sparkle on the nodes
    float grain = hash12(floor(uv * uRes.y * 0.7) + floor(uTime * 24.0));
    col += lineCol * line * step(0.93, grain) * (0.4 + uTreble * 1.6) * (1.0 - uQuiet);

    float d = length(vUV - 0.5);
    col *= 1.0 - d * d * 1.1;
    // milder than the line width's own level response — boosting both at
    // once is what blew the plate out to white on loud passages
    col *= 0.55 + uLevel * 0.65;
    col *= 1.0 - uQuiet * 0.5;   // rests: the plate goes still and dark
    col *= 1.0 + uBurst * 0.7;   // the re-strike flashes it awake
    fragColor = vec4(aces(col), 1.0);
  }`;

  const GOOD_MODES = [1, 2, 3, 4, 5, 6, 7];

  M.registerScene({
    name: 'chladni resonance · cymatics',
    modes: ['music', 'speech'],
    create(glc) {
      const prog = glc.program(FRAG);
      // current + target mode numbers, spring-interpolated
      let cur = [3, 5, 2, 7, 4, 6];
      let tgt = cur.slice();
      let rot = 0, zoom = 1;

      function newTargets() {
        for (let i = 0; i < 6; i += 2) {
          let n = GOOD_MODES[(Math.random() * GOOD_MODES.length) | 0];
          let m = GOOD_MODES[(Math.random() * GOOD_MODES.length) | 0];
          if (n === m) m = (m % 7) + 1; // n==m is degenerate (w ≡ 0)
          tgt[i] = n; tgt[i + 1] = m;
        }
      }

      return {
        resize() {},
        update(dt, audio, t) {
          const f = audio.f;
          if (f.beat > 0.9 || f.onset > 0.95 || f.burst === 1) newTargets();
          const k = 1 - Math.exp(-dt * 2.4);
          for (let i = 0; i < 6; i++) cur[i] += (tgt[i] - cur[i]) * k;
          rot += dt * (0.02 + f.mid * 0.12);
          const zTgt = 1.05 - f.bassFast * 0.16;
          zoom += (zTgt - zoom) * (1 - Math.exp(-dt * 9));
        },
        render(out, audio, t) {
          const f = audio.f;
          // the plate never freezes: modes detune continuously between
          // strikes, riding the loudness phase (still in true silence)
          const w = cur.map((c, i) =>
            c + Math.sin(f.phaseLevel * 0.31 + i * 1.3) * (0.05 + f.mid * 0.10));
          prog.use()
            .v4('uModeA', w[0], w[1], w[2], w[3])
            .v4('uModeB', w[4], w[5], rot, zoom)
            .v2('uRes', glc.width, glc.height);
          M.audioUniforms(prog, audio, t);
          glc.draw(prog, out);
        },
        dispose() { prog.dispose(); },
      };
    },
  });
})();
