/* ORPHIC scene — NEON TUNNEL · hyperdrive
 * Demoscene polar tunnel (uv → angle, 1/r) wearing synthwave neon: a
 * perfectly symmetric spoke-and-ring lattice rushing past, hyperspace star
 * dashes streaming outward, a hot destination point at the vanishing point,
 * beat-launched light rings, chromatic aberration + zoom punch on the kick.
 * Travel speed rides the level phase accumulator (research-validated:
 * loudness-driven time, not raw amplitude), twist follows the mids, hue
 * follows the spectral centroid. Spokes use integer angular frequency and
 * twist rotates the raw angle, so the lattice is seamless at every frame;
 * a derivative fade dissolves detail into the distance instead of masking
 * the core with a black hole.
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
    float depth = 0.35 / r + uTravel + chroma;

    // 16 spokes, integer frequency on the raw rotated angle → seamless
    // around the full circle; a gentle helix keeps them alive
    float a = ang + uTwist + sin(depth * 0.30) * 0.18;
    float lon = pow(abs(sin(a * 8.0)), 36.0);
    float lat = pow(abs(sin(depth * 4.7)), 30.0);

    // detail dissolves into the distance (no aliasing, no masked-out core)
    float fade = exp(-pow(fwidth(depth) * 1.8, 2.0));
    float lattice = (lon * (0.3 + uTreble * 0.55) + lat * 1.1 + lon * lat * 2.5) * fade;

    float hue = uCentroid * 0.4 + depth * 0.03 + uPhaseLevel * 0.012;
    vec3 col = pal(hue, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)) * lattice;

    // beat rings racing toward the camera
    for (int i = 0; i < 8; i++) {
      float ringZ = uRings[i];
      if (ringZ < 0.0) continue;
      float dz = depth - ringZ;
      float ring = exp(-dz * dz * 220.0);
      col += pal(hue + 0.5, vec3(0.6), vec3(0.4), vec3(1.0), vec3(0.0, 0.33, 0.67)) * ring * 1.6 * fade;
    }

    // hyperspace star dashes streaming outward on fixed rays — they don't
    // rotate with the lattice, so the rush past reads even between beats
    float bx = (ang / 6.28318 + 0.5) * 90.0;
    vec2 h = hash22(vec2(floor(bx), 7.0));
    float prof = exp(-pow((fract(bx) - 0.5) * 6.0, 2.0));
    float along = fract(depth * (0.55 + h.y * 0.5) + h.x * 7.0);
    float streak = prof * pow(1.0 - along, 12.0) * fade;
    col += vec3(0.85, 0.92, 1.0) * streak * (0.25 + uLevel * 0.65);

    // distance dim toward the core (gentle — the core stays alive)
    col *= smoothstep(0.04, 0.45, r) * 0.92 + 0.08;
    // glow halo near walls
    col += col * 0.18 / (r * 4.0 + 0.4);
    return col;
  }

  void main() {
    vec2 uv = (vUV - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    uv *= 1.0 - uBassFast * 0.05; // kick punches the camera forward
    // bass kick = chromatic aberration: sample three slightly offset depths
    float ca = uBassFast * 0.025;
    vec3 col = vec3(
      tunnel(uv, ca).r,
      tunnel(uv, 0.0).g,
      tunnel(uv, -ca).b
    );
    // the destination point: a hot core to dive into, flaring on the kick
    float hue = uCentroid * 0.4 + uPhaseLevel * 0.012;
    vec3 coreCol = mix(pal(hue + 0.5, vec3(0.6), vec3(0.4), vec3(1.0), vec3(0.0, 0.33, 0.67)), vec3(1.0), 0.55);
    float d2 = dot(uv, uv);
    col += coreCol * (exp(-d2 * 260.0) + exp(-d2 * 40.0) * 0.18) * (0.45 + uBassFast * 0.9 + uLevel * 0.35);
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
          travel += dt * (0.55 + f.level * 2.8 + f.bass * 1.5);
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
              .f('uTravel', travel).f('uTwist', twist)
              .fv('uRings', rings);
          M.audioUniforms(prog, audio, t);
          glc.draw(prog, out);
        },
        dispose() { prog.dispose(); },
      };
    },
  });
})();
