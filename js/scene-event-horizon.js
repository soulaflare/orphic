/* ORPHIC scene — EVENT HORIZON · gravitational lensing
 * A Schwarzschild black hole rendered by marching photon geodesics in a
 * fragment shader: each ray bends under d²x/dλ² = -1.5·h²·x/r⁵ (the null
 * geodesic in units where the horizon rs = 1), so the sky — a starfield plus
 * ORPHIC's own live spectrum painted across it — warps into an Einstein ring
 * around the hole. An accretion disk glows in the equatorial plane with
 * relativistic Doppler beaming (the side spinning toward you runs brighter
 * and bluer); rays that wind the photon sphere pile into the thin bright
 * ring. The music drives the gravity itself: bass deepens the lensing and
 * the hole's mass, loudness spins and brightens the disk, beats fire
 * shockwave shells outward through it, the key tints the disk's far-edge
 * temperature, rests starve it to a dim ember and the return floods it
 * supernova-bright.
 *
 * Inspiration (concept only — physics reimplemented from scratch, no code
 * borrowed): Kavan Patel's "black_hole" geodesic renderer.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const RES_MAX = 0.72, RES_MIN = 0.42;

  const MARCH_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + M.GLSL_SPECTRUM + `
  uniform vec2 uRes;
  uniform vec3 uCamPos, uCamTarget;
  uniform float uFov, uLens, uDiskBright, uSpin, uKeyHue, uRing, uPhoton;

  // geometry, in units of the Schwarzschild radius (horizon = 1)
  const float RIN  = 3.5;   // inner disk edge (~ISCO)
  const float ROUT = 12.0;  // outer disk edge
  const float RPH  = 1.5;   // photon sphere
  const float RESC = 46.0;  // ray considered escaped beyond here

  // the sky an escaped ray lands on: a star field + the live spectrum smeared
  // as an aurora whose altitude maps to log-frequency, so the music is what
  // gets bent around the hole.
  vec3 skybox(vec3 d) {
    float az = atan(d.z, d.x) / 6.2831853 + 0.5;
    float el = asin(clamp(d.y, -1.0, 1.0)) / 3.14159 + 0.5;
    // stars: sparse twinkling motes on a lat/long grid
    vec2 g = vec2(az * 60.0, el * 30.0);
    vec2 id = floor(g);
    vec2 h = hash22(id);
    float star = pow(hash12(id + 3.1), 92.0);
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h.y * 3.0) + h.x * 30.0);
    float sd = length(fract(g) - 0.5 - (h - 0.5) * 0.4);
    vec3 col = vec3(0.85, 0.9, 1.0) * star * tw * exp(-sd * sd * 30.0);
    // spectrum aurora: each sky-altitude band lit by its frequency
    float e = specLog(clamp(el, 0.0, 1.0));
    vec3 sky = pal(uKeyHue + el * 0.35, vec3(0.5), vec3(0.5), vec3(1.0),
                   vec3(0.0, 0.33, 0.67)) * e * e * (0.5 + uLevel * 0.6);
    col += sky * (0.4 + 0.6 * fbm(vec2(az * 6.0, el * 4.0) + uSpin * 0.1));
    col += vec3(0.012, 0.014, 0.03); // faint base sky
    return col;
  }

  // emissive accretion-disk sample at an equatorial-plane crossing
  vec3 disk(vec3 hit, vec3 rd) {
    float r = length(hit.xz);
    if (r < RIN || r > ROUT) return vec3(0.0);
    float ang = atan(hit.z, hit.x);
    float tnorm = (r - RIN) / (ROUT - RIN);          // 0 inner .. 1 outer

    // spiral turbulence, dragged around by the spin accumulator
    float swirl = fbm(vec2(r * 1.3 - uSpin * 1.4, ang * 2.2 + r * 0.7 - uSpin));
    float dens = (0.45 + 0.9 * swirl)
               * smoothstep(0.0, 0.12, tnorm)        // soft inner lip
               * smoothstep(1.0, 0.7, tnorm);        // fade to outer rim

    // temperature: hot blue-white inside, key-tinted ember outside
    float temp = pow(1.0 - tnorm, 1.6);
    vec3 cool = pal(uKeyHue + 0.04, vec3(0.5), vec3(0.45), vec3(1.0), vec3(0.0, 0.15, 0.30));
    vec3 dcol = mix(cool, vec3(0.8, 0.88, 1.0), temp);

    // relativistic Doppler beaming: prograde velocity vs view direction
    vec3 vel = normalize(cross(vec3(0.0, 1.0, 0.0), hit));
    float beam = dot(vel, normalize(-rd)) / sqrt(max(r, RIN)); // faster inside
    dcol *= 1.0 + beam * (1.4 + uLevel * 1.2);
    dcol += vec3(0.5, 0.7, 1.0) * max(beam, 0.0) * 0.7;        // approaching → bluer

    // beat shockwave shell expanding outward through the disk
    if (uRing > 0.0) dcol += vec3(1.0, 0.95, 0.9) * exp(-pow((r - uRing) * 2.4, 2.0)) * 2.2;

    return max(dcol, 0.0) * dens * uDiskBright;
  }

  void main() {
    vec2 uv = (vUV - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    vec3 ro = uCamPos;
    vec3 fwd = normalize(uCamTarget - ro);
    vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(rgt, fwd);
    vec3 rd = normalize(fwd / uFov + uv.x * rgt + uv.y * up);

    vec3 pos = ro;
    vec3 dir = rd;
    vec3 cr = cross(pos, dir);
    float h2 = dot(cr, cr) * uLens;     // angular momentum² → lensing strength

    vec3 acc = vec3(0.0);               // accumulated disk emission
    float rmin = 1e9;                   // closest approach (for the photon ring)
    bool captured = false, escaped = false;

    for (int i = 0; i < 240; i++) {
      float r2 = dot(pos, pos);
      float r = sqrt(r2);
      rmin = min(rmin, r);
      if (r < 1.0) { captured = true; break; }
      if (r > RESC) { escaped = true; break; }

      // distance-scaled step: fine near the hole/disk, coarse far away
      float dl = clamp(0.16 * (r - 1.0), 0.022, 1.7);
      vec3 ppos = pos;
      vec3 accel = -1.5 * h2 * pos / (r2 * r2 * r); // -1.5 h² x / r⁵
      dir += accel * dl;
      pos += dir * dl;

      // equatorial-plane crossing → sample the disk (lerp the exact hit)
      if (ppos.y * pos.y < 0.0) {
        float f = ppos.y / (ppos.y - pos.y);
        acc += disk(mix(ppos, pos, f), dir);
      }
    }

    vec3 col = acc;
    if (escaped) col += skybox(normalize(dir));
    // photon ring: light that grazed the photon sphere stacks into a thin halo
    float ph = smoothstep(0.30, 0.0, abs(rmin - RPH));
    col += vec3(1.0, 0.96, 0.88) * ph * uPhoton;

    col *= 0.7 + uLevel * 0.6;
    fragColor = vec4(col, 1.0);
  }`;

  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uTex;
  uniform vec2 uTexel;
  void main() {
    vec2 o = uTexel * 0.75;
    // kick-driven chromatic aberration toward the edges
    vec2 d = (vUV - 0.5) * uBassFast * 0.014;
    vec3 c1 = texture(uTex, vUV + d + o).rgb + texture(uTex, vUV + d - o).rgb;
    vec3 c2 = texture(uTex, vUV - d + vec2(o.x, -o.y)).rgb
            + texture(uTex, vUV - d - vec2(o.x, -o.y)).rgb;
    vec3 col = vec3(c1.r * 0.5, (c1.g + c2.g) * 0.25, c2.b * 0.5);
    // soft bloom lift from the brightest cores (disk lip + photon ring)
    col += smoothstep(0.9, 2.2, max(col.r, max(col.g, col.b))) * vec3(0.4, 0.45, 0.6);
    float v = length(vUV - 0.5);
    col *= 1.0 - v * v * 0.72;
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'event horizon · gravitational lensing',
    modes: ['music'],
    create(glc) {
      const pMarch = glc.program(MARCH_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const ar = M.adaptiveRes(RES_MAX, RES_MIN);
      let buf = null;
      let keyHue = 0;
      let spin = 0;
      let ring = -1;           // beat shockwave radius in the disk (-1 = idle)

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
          // disk rotation rides the loudness phase accumulator (not raw amp)
          spin += dt * (0.25 + f.level * 2.6 + f.bass * 1.2);
          // beats fire a shockwave shell that races out through the disk
          if ((f.beat > 0.9 || f.burst === 1) && ring < 0) ring = 3.5;
          if (ring >= 0) {
            ring += dt * 9.0;
            if (ring > 13.0) ring = -1;
          }
        },
        render(out, audio, t) {
          if (!buf) this.resize(glc.width, glc.height);
          const f = audio.f;
          // slow orbit; bass pulls the camera in, a gentle bob keeps it 3D
          const ang = f.phaseLevel * 0.12;
          const R = 17.5 - f.bass * 2.2;
          const cy = 2.6 + 1.4 * Math.sin(f.phaseLevel * 0.06);

          pMarch.use();
          M.audioUniforms(pMarch, audio, t);
          M.spectrumUniforms(pMarch, audio, 0);
          pMarch.v2('uRes', buf.w, buf.h)
                .v3('uCamPos', Math.cos(ang) * R, cy, Math.sin(ang) * R)
                .v3('uCamTarget', 0, 0, 0)
                .f('uFov', 1.15 + f.bassFast * 0.08)
                // bass deepens spacetime curvature; rests relax it
                .f('uLens', (1.0 + f.bass * 0.7 + f.phaseBass * 0.0) * (1.0 - f.quiet * 0.25))
                // disk brightness: loud → blazing, rests → dim ember, return → supernova
                .f('uDiskBright', (0.85 + f.level * 1.1) * (1.0 - f.quiet * 0.78) + f.burst * 1.6)
                .f('uSpin', spin)
                .f('uKeyHue', keyHue)
                .f('uRing', ring)
                .f('uPhoton', 0.5 + f.level * 0.7 + f.beat * 0.8 + f.treble * 0.4);
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
