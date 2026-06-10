/* ORPHIC scene — NEON TUNNEL · hyperdrive
 * Demoscene polar tunnel (uv → angle, 1/r) wearing synthwave neon: a
 * kaleidoscopically folded grid rushing past, beat-launched light rings,
 * chromatic aberration on the kick. Travel speed rides the level phase
 * accumulator (research-validated: loudness-driven time, not raw amplitude),
 * twist follows the mids, hue follows the spectral centroid.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;

  const FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform vec2 uRes;
  uniform float uTravel, uTwist, uRings[8];

  vec3 tunnel(vec2 uv, float chroma) {
    float r = length(uv) + 1e-4;
    float ang = atan(uv.y, uv.x);

    // kaleidoscopic folding: 6-fold when trebly, calm 1-fold when dark
    float folds = 1.0 + floor(uTreble * 6.0 + uSpeech * 2.0);
    ang = abs(mod(ang * folds / 6.28318, 2.0) - 1.0) * 6.28318 / folds;

    float depth = 0.35 / r + uTravel + chroma;
    float spin = ang + uTwist + depth * 0.12;

    // neon lattice: rings carry the rhythm, spokes stay secondary
    float lon = pow(abs(sin(spin * 9.0)), 36.0);
    float lat = pow(abs(sin(depth * 4.7)), 30.0);
    float lattice = lon * 0.45 + lat * 1.1 + lon * lat * 2.5;

    float hue = uCentroid * 0.4 + depth * 0.03 + uPhaseLevel * 0.012;
    vec3 col = pal(hue, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)) * lattice;

    // beat rings racing toward the camera
    for (int i = 0; i < 8; i++) {
      float ringZ = uRings[i];
      if (ringZ < 0.0) continue;
      float dz = depth - ringZ;
      float ring = exp(-dz * dz * 220.0);
      col += pal(hue + 0.5, vec3(0.6), vec3(0.4), vec3(1.0), vec3(0.0, 0.33, 0.67)) * ring * 1.6;
    }

    // fog toward the core
    col *= smoothstep(0.0, 0.55, r);
    // glow halo near walls
    col += col * 0.18 / (r * 4.0 + 0.4);
    return col;
  }

  void main() {
    vec2 uv = (vUV - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    // bass kick = chromatic aberration: sample three slightly offset depths
    float ca = uBassFast * 0.025;
    vec3 col = vec3(
      tunnel(uv, ca).r,
      tunnel(uv, 0.0).g,
      tunnel(uv, -ca).b
    );
    col *= 0.45 + uLevel * 1.0;
    float d = length(vUV - 0.5);
    col *= 1.0 - d * d * 0.6;
    // scanlines, faint
    col *= 0.94 + 0.06 * sin(vUV.y * uRes.y * 1.8);
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'hyperdrive · neon tunnel',
    modes: ['music'],
    create(glc) {
      const prog = glc.program(FRAG);
      let travel = 0, twist = 0;
      const rings = new Float32Array(8).fill(-1);
      let ringIdx = 0;

      return {
        resize() {},
        update(dt, audio, t) {
          const f = audio.f;
          travel += dt * (0.4 + f.level * 2.6 + f.bass * 1.4);
          twist += dt * (Math.sin(f.phaseLevel * 0.35) * (0.1 + f.mid * 0.5));
          if (f.beat > 0.9 || f.burst === 1) {
            rings[ringIdx] = travel + 3.2; // spawn ahead, rushes toward camera
            ringIdx = (ringIdx + 1) % 8;
          }
          for (let i = 0; i < 8; i++) {
            if (rings[i] >= 0 && rings[i] < travel - 0.6) rings[i] = -1; // passed behind
          }
        },
        render(out, audio, t) {
          prog.use().v2('uRes', glc.width, glc.height)
              .f('uTravel', travel).f('uTwist', twist);
          const gl = glc.gl;
          const loc = gl.getUniformLocation(prog.handle, 'uRings[0]');
          if (loc) gl.uniform1fv(loc, rings);
          M.audioUniforms(prog, audio, t);
          glc.draw(prog, out);
        },
        dispose() {},
      };
    },
  });
})();
