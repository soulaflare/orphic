/* ORPHIC scene — ACTIVE NEMATIC · defect braid
 * A liquid crystal that stirs itself. In an active nematic the orientation
 * field never sits still: it spawns topological defects — points where the
 * director winds by a half-turn — and the +1/2 defects are MOTILE, swimming
 * comet-first through the film while the trefoil −1/2 defects drift. Under tight
 * confinement a handful settle into a periodic "braid"; pour in activity and
 * pairs nucleate faster than they annihilate and the film boils into self-
 * stirring turbulence (the 2024–26 confinement chaos→order result, the golden
 * and silver braid orbits).
 *
 * Modelled at the level that gives this its signature: the disclinations are
 * tracked as particles — motile +1/2, drifting −1/2 — with Coulomb-like
 * attraction/repulsion, audio-paced pair creation, and annihilation on contact.
 * The director field is reconstructed analytically from their winding, baked to
 * a texture, then drawn with line-integral convolution (silky streamlines) and
 * luminous comet cores where the order collapses. Confinement and activity ride
 * the audio: rests relax to a slow braid on black, loud passages boil.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const GRID = 384;
  const MAXDEF = 48;

  const HEAD = M.FRAG_HEADER;

  // reconstruct the director from defect winding, bake Q = S·(cos2θ, sin2θ)
  const DIR_FRAG = HEAD + `
  uniform vec4 uDef[${MAXDEF}];   // xy pos (aspect space), z charge, w orient
  uniform int uCount;
  uniform float uAspect, uConfR, uS0, uBase;
  void main() {
    vec2 q = vec2((vUV.x - 0.5) * uAspect, vUV.y - 0.5);
    float theta = uBase;
    float order = 1.0;
    for (int i = 0; i < ${MAXDEF}; i++) {
      if (i >= uCount) break;
      vec4 d = uDef[i];
      vec2 r = q - d.xy;
      theta += d.z * atan(r.y, r.x);
      float dist = length(r);
      order *= smoothstep(0.012, 0.055, dist);   // S → 0 at each core
    }
    float S = uS0 * order;
    // soft confinement: order fades outside the active disk
    S *= smoothstep(uConfR + 0.02, uConfR - 0.06, length(q));
    fragColor = vec4(S * cos(2.0 * theta), S * sin(2.0 * theta), 0.0, 1.0);
  }`;

  // LIC streamlines along the director + luminous defect comets
  const SHOW_FRAG = HEAD + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uQ;
  uniform vec2 uTexel;
  uniform vec4 uDef[${MAXDEF}];
  uniform int uCount;
  uniform float uAspect, uConfR, uS0, uKeyHue, uRes, uFlash;
  float licNoise(vec2 p) { return vnoise(p * 85.0) * 0.6 + vnoise(p * 200.0) * 0.4; }
  void main() {
    vec2 Q = texture(uQ, vUV).xy;
    float ang = 0.5 * atan(Q.y, Q.x);
    vec2 dir = vec2(cos(ang), sin(ang)) * uTexel * 1.5;

    // LIC: walk along the local director, re-reading it each step
    float acc = 0.0, wsum = 0.0;
    vec2 pf = vUV, pb = vUV;
    for (int i = 0; i < 12; i++) {
      float w = exp(-float(i) * 0.15);
      vec2 Qf = texture(uQ, pf).xy; float af = 0.5 * atan(Qf.y, Qf.x);
      vec2 df = vec2(cos(af), sin(af)) * uTexel * 1.5;
      if (dot(df, dir) < 0.0) df = -df;
      pf += df;
      vec2 Qb = texture(uQ, pb).xy; float ab = 0.5 * atan(Qb.y, Qb.x);
      vec2 db = vec2(cos(ab), sin(ab)) * uTexel * 1.5;
      if (dot(db, dir) > 0.0) db = -db;
      pb += db;
      acc += (licNoise(pf) + licNoise(pb)) * w;
      wsum += 2.0 * w;
    }
    float lic = smoothstep(0.34, 0.72, acc / wsum);
    float S = length(Q);
    float order = smoothstep(0.0, uS0 * 0.7, S);

    vec2 q = vec2((vUV.x - 0.5) * uAspect, vUV.y - 0.5);
    float inside = smoothstep(uConfR, uConfR - 0.04, length(q));

    // cool key-tinted director ink
    vec3 streak = pal(uKeyHue + 0.55 + ang * 0.08, vec3(0.20, 0.26, 0.36),
                       vec3(0.18, 0.22, 0.30), vec3(1.0), vec3(0.0, 0.22, 0.5));
    vec3 col = streak * lic * order * (0.45 + uLevel * 0.7) * inside;

    // defect comets: +1/2 swims comet-first, −1/2 is a dim trefoil knot
    for (int i = 0; i < ${MAXDEF}; i++) {
      if (i >= uCount) break;
      vec4 d = uDef[i];
      vec2 rel = q - d.xy;
      float dist = length(rel);
      if (d.z > 0.0) {
        // elongated comet pointing along its orientation
        vec2 ax = vec2(cos(d.w), sin(d.w));
        float along = dot(rel, ax);
        float perp = dot(rel, vec2(-ax.y, ax.x));
        float head = exp(-(along * along) / 0.0016 - (perp * perp) / 0.0009);
        float tail = exp(-(max(0.0, -along) * 12.0)) * exp(-(perp * perp) / 0.0024) * 0.5;
        float comet = head + tail * smoothstep(0.06, 0.0, dist);
        vec3 hot = pal(uKeyHue + 0.04, vec3(0.8, 0.55, 0.4), vec3(0.4), vec3(1.0), vec3(0.0, 0.15, 0.35));
        col += hot * comet * (1.4 + uBeat * 1.6 + uFlash * 2.0);
        col += vec3(1.0, 0.94, 0.85) * exp(-dist * dist / 0.0006) * (1.0 + uTreble);
      } else {
        float g = exp(-dist * dist / 0.0016);
        col += vec3(0.4, 0.6, 0.95) * g * (0.8 + uTreble * 0.6);
      }
    }

    col *= 1.0 - uQuiet * 0.25;
    float vg = length(vUV - 0.5);
    col *= 1.0 - vg * vg * 0.7;
    col += (hash12(vUV * uRes) - 0.5) / 255.0;
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'defect braid · active nematic',
    modes: ['music', 'ambient'],
    create(glc) {
      const Q = glc.target(GRID, GRID);
      const pDir = glc.program(DIR_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const S0 = 0.5;
      const texel = [1 / GRID, 1 / GRID];
      let keyHue = 0.55;
      let confR = 0.40;
      let base = 0;
      let flash = 0;
      const buf = new Float32Array(MAXDEF * 4);

      // defect list: {x, y, s (±0.5), psi (orientation), spin}
      let defs = [];
      function addPair(cx, cy, sep) {
        if (defs.length > MAXDEF - 2) return;
        const a = Math.random() * Math.PI * 2;
        const ox = Math.cos(a) * sep, oy = Math.sin(a) * sep;
        defs.push({ x: cx + ox, y: cy + oy, s: 0.5, psi: a + Math.PI, spin: (Math.random() - 0.5) * 0.6 });
        defs.push({ x: cx - ox, y: cy - oy, s: -0.5, psi: 0, spin: 0 });
      }
      function reseed() {
        defs = [];
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * 0.2;
          addPair(Math.cos(a) * r, Math.sin(a) * r, 0.08 + Math.random() * 0.06);
        }
      }
      reseed();

      return {
        resize() {},
        update(dt, audio, t) {
          const f = audio.f;
          const h = Math.min(dt, 0.033);
          keyHue = M.chromaHue(f.chroma, keyHue, dt);
          const aspect = glc.width / glc.height;

          // confinement & activity: loud = wide boiling disk, quiet = tight braid
          const targetR = 0.30 + f.level * 0.18 + f.bass * 0.04;
          confR += (targetR - confR) * (1 - Math.exp(-dt / 0.7));
          const activity = 0.25 + f.level * 1.1 + f.beat * 0.6;
          base += dt * (0.05 + f.mid * 0.3);   // slow global swirl of the field
          flash *= Math.pow(0.5, dt / 0.2);

          // pair nucleation paced by activity (more pairs → turbulence)
          let rate = activity * 1.3;
          if (f.beat > 0.9) rate += 4.0;
          if (Math.random() < rate * h && defs.length < MAXDEF - 2) {
            const a = Math.random() * Math.PI * 2, r = Math.random() * confR * 0.8;
            addPair(Math.cos(a) * r, Math.sin(a) * r, 0.05);
          }

          // pairwise Coulomb-like interaction + motile +1/2 self-propulsion
          const v0 = 0.12 + activity * 0.22;
          const kInt = 0.018;
          for (let i = 0; i < defs.length; i++) {
            const di = defs[i];
            let fx = 0, fy = 0;
            for (let j = 0; j < defs.length; j++) {
              if (i === j) continue;
              const dj = defs[j];
              const rx = di.x - dj.x, ry = di.y - dj.y;
              const r2 = rx * rx + ry * ry + 1e-4;
              const r = Math.sqrt(r2);
              // like charges repel, opposite attract: force ∝ -s_i s_j / r
              const mag = -kInt * (di.s * dj.s) / r2 * 4.0;
              fx += (rx / r) * mag; fy += (ry / r) * mag;
            }
            // +1/2 self-propulsion along its orientation; orientation precesses
            if (di.s > 0) {
              fx += Math.cos(di.psi) * v0; fy += Math.sin(di.psi) * v0;
              di.psi += (di.spin + (di.s > 0 ? base * 0.0 : 0)) * dt * 2.0;
            }
            // confinement wall
            const rr = Math.hypot(di.x, di.y);
            if (rr > confR - 0.03) {
              const push = (rr - (confR - 0.03)) * 6.0;
              fx -= (di.x / (rr + 1e-4)) * push; fy -= (di.y / (rr + 1e-4)) * push;
            }
            di.vx = fx; di.vy = fy;
          }
          for (const d of defs) { d.x += d.vx * h; d.y += d.vy * h; }

          // annihilate the closest +/− pairs that have met
          for (let i = defs.length - 1; i >= 0; i--) {
            for (let j = i - 1; j >= 0; j--) {
              if (defs[i].s * defs[j].s < 0) {
                const dx = defs[i].x - defs[j].x, dy = defs[i].y - defs[j].y;
                if (dx * dx + dy * dy < 0.0016) {
                  flash = 1.0;
                  defs.splice(i, 1); defs.splice(j, 1);
                  i = Math.min(i, defs.length);
                  break;
                }
              }
            }
          }
          // always keep a couple so a quiet passage still braids
          if (defs.length < 2) addPair(0, 0, 0.1);

          // pack defects for the shaders
          buf.fill(0);
          for (let i = 0; i < defs.length && i < MAXDEF; i++) {
            buf[i * 4] = defs[i].x; buf[i * 4 + 1] = defs[i].y;
            buf[i * 4 + 2] = defs[i].s; buf[i * 4 + 3] = defs[i].psi;
          }
          this._count = Math.min(defs.length, MAXDEF);
          this._aspect = aspect;
        },
        render(out, audio, t) {
          const aspect = this._aspect || glc.width / glc.height;
          const count = this._count || 0;
          // bake the director field
          pDir.use().f4v('uDef', buf).i('uCount', count)
            .f('uAspect', aspect).f('uConfR', confR).f('uS0', S0).f('uBase', base);
          glc.draw(pDir, Q);
          // render LIC + comets into the HDR scene buffer
          pShow.use().tex('uQ', Q.tex, 0).v2('uTexel', texel[0], texel[1])
            .f4v('uDef', buf).i('uCount', count)
            .f('uAspect', aspect).f('uConfR', confR).f('uS0', S0)
            .f('uKeyHue', keyHue).f('uRes', glc.height).f('uFlash', flash);
          M.audioUniforms(pShow, audio, t);
          glc.draw(pShow, out);
        },
        dispose() {
          Q.dispose();
          for (const p of [pDir, pShow]) p.dispose();
        },
      };
    },
  });
})();
