/* ORPHIC scene — ESCHER GATE · hyperbolic tiling
 * A {p,q} tiling of the Poincaré disk, folded by a (p,q,2) triangle group:
 * two straight mirrors through the origin and one circular geodesic mirror,
 * iterated to infinite depth. The camera glides through hyperbolic space on
 * a Möbius translation whose speed is the music's loudness — silence freezes
 * the glide and dims the lattice to embers; the return re-tessellates the
 * entire plane to a new {p,q} (as do every 8 beats). Tiling depth tiers are
 * lit per-frequency (bass = central tiles, treble = the infinite rim dust),
 * sustained harmonic content thickens the glowing lattice, percussive hits
 * flash the tile vertices.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;

  const FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + M.GLSL_SPECTRUM + `
  uniform vec2 uRes;
  uniform vec2 uMob;                 // Möbius view offset (|m| < 1)
  uniform float uSpin, uKeyHue;
  uniform float uAngP, uCD, uCR2;    // wedge angle pi/p, mirror circle (d, r^2)

  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
  vec2 cdiv(vec2 a, vec2 b) { return cmul(a, vec2(b.x, -b.y)) / dot(b, b); }

  void main() {
    vec2 uv = (vUV - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.15;
    float rr = length(uv);

    // outside the disk: deep space + a treble-lit event-horizon ring
    vec3 rim = pal(uKeyHue + 0.5, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
    if (rr >= 0.985) {
      vec3 bgc = vec3(0.006, 0.006, 0.016)
               + rim * exp(-(rr - 0.985) * 14.0) * (0.20 + uTreble * 0.5 + uBurst * 0.8);
      fragColor = vec4(aces(bgc), 1.0);
      return;
    }

    // kick breath + Möbius glide through the hyperbolic plane
    vec2 z = uv * (1.0 - uBassFast * 0.06);
    z = cdiv(z - uMob, vec2(1.0, 0.0) - cmul(vec2(uMob.x, -uMob.y), z));
    float cs = cos(uSpin), sn = sin(uSpin);
    z = mat2(cs, -sn, sn, cs) * z;

    // fold into the fundamental triangle: x-axis, line at uAngP, mirror circle
    vec2 n2 = vec2(-sin(uAngP), cos(uAngP));
    vec2 cc = vec2(uCD, 0.0);
    float tier = 0.0;
    for (int i = 0; i < 24; i++) {
      z.y = abs(z.y);
      z -= 2.0 * n2 * max(0.0, dot(z, n2));
      vec2 dz = z - cc;
      float d2 = dot(dz, dz);
      if (d2 < uCR2) { z = cc + dz * (uCR2 / d2); tier += 1.0; }
    }

    // distances to the three mirrors = the tile lattice
    float e1 = abs(z.y);
    float e2 = abs(dot(z, n2));
    float e3 = abs(length(z - cc) - sqrt(uCR2));
    float edge = min(e1, min(e2, e3));

    float w = fwidth(edge) + 1e-5;
    float line = exp(-edge / (w * (0.8 + uHarmonic * 1.3)));

    // each recursion tier is one frequency slice: bass lights the heart of
    // the disk, treble ignites the infinite dust at the rim
    float band = specLog(clamp(tier / 14.0, 0.0, 1.0));
    float hue = uKeyHue + tier * 0.075;
    vec3 lineCol = pal(hue, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
    vec3 col = lineCol * line * (0.22 + band * 1.8 + uBurst * 1.5);

    // cell interiors washed faintly by their band
    col += pal(hue + 0.35, vec3(0.45), vec3(0.4), vec3(1.0), vec3(0.0, 0.33, 0.67))
           * band * band * 0.10;

    // percussive hits flash the tile vertices
    float vert = exp(-(e1 + e2 + e3) * 26.0);
    col += vec3(1.0, 0.95, 0.9) * vert * (uPercussive * 1.6 + uBeat * 1.0);

    // rim fog: tiles dissolve into the horizon
    col *= 1.0 - smoothstep(0.86, 0.985, rr) * 0.75;
    col += rim * exp(-abs(rr - 0.985) * 18.0) * (0.15 + uTreble * 0.4);

    // rests: the gate goes dark, embers crawling along the lattice
    float ember = vnoise(z * 40.0 + uTime * 0.6) * line;
    col = mix(col, lineCol * ember * 0.45, uQuiet * 0.75);

    col *= 0.65 + uLevel * 0.65;
    fragColor = vec4(aces(col), 1.0);
  }`;

  // {p,q} hyperbolic tilings (1/p + 1/q < 1/2), cycled on musical events
  const TILINGS = [[6, 4], [5, 4], [7, 3], [4, 5], [8, 3], [5, 5]];

  M.registerScene({
    name: 'escher gate · hyperbolic tiling',
    modes: ['music', 'ambient'],
    create(glc) {
      const prog = glc.program(FRAG);
      let keyHue = 0.3, spin = 0, mobPhase = 0;
      let tileIdx = 0, beatCount = 0, beatLatch = 0;
      let angP = 0, cd = 0, cr2 = 0;

      function setTiling(i) {
        const [p, q] = TILINGS[((i % TILINGS.length) + TILINGS.length) % TILINGS.length];
        const A = Math.PI / p, B = Math.PI / q;
        const d2 = Math.cos(B) ** 2 / (Math.cos(B) ** 2 - Math.sin(A) ** 2);
        angP = A;
        cd = Math.sqrt(d2);
        cr2 = d2 - 1;
      }
      setTiling(0);

      return {
        resize() {},
        update(dt, audio) {
          const f = audio.f;
          keyHue = M.chromaHue(f.chroma, keyHue, dt);
          // the glide lives on loudness and halts completely in rests
          mobPhase += dt * (0.06 + f.level * 0.55) * (1 - f.quiet);
          spin += dt * 0.02 * (1 - f.quiet) + f.beat * dt * 0.05;

          beatLatch -= dt;
          if (f.beat > 0.9 && beatLatch <= 0) { beatCount++; beatLatch = 0.25; }
          // re-tessellate the whole plane every 8 beats, or when the music
          // returns from a rest
          if (beatCount >= 8 || f.burst === 1) {
            beatCount = 0;
            setTiling(++tileIdx);
          }
        },
        render(out, audio, t) {
          const mx = 0.42 * Math.sin(mobPhase * 0.83);
          const my = 0.42 * Math.sin(mobPhase * 0.59 + 1.9);
          prog.use();
          M.audioUniforms(prog, audio, t);
          M.spectrumUniforms(prog, audio, 0);
          prog.v2('uRes', glc.width, glc.height)
              .v2('uMob', mx, my)
              .f('uSpin', spin).f('uKeyHue', keyHue)
              .f('uAngP', angP).f('uCD', cd).f('uCR2', cr2);
          glc.draw(prog, out);
        },
        dispose() {},
      };
    },
  });
})();
