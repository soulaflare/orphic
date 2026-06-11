/* ORPHIC scene — VORTEX TANGLE · Crow cascade
 * Quantum turbulence: a tangle of luminous vortex filaments the way they writhe
 * in a dipolar superfluid. Two antiparallel lines run the Crow instability —
 * helical Kelvin waves ripple along them, mutual induction bows them together,
 * and where they touch they reconnect, spraying daughter rings that race away,
 * wobble, and shrink (Nature Sci. Reports 2025). Around them drifts a living
 * population of glowing vortex rings — the debris of an endless cascade to ever-
 * smaller loops — each one rippling with its own Kelvin modes.
 *
 * Reduced filament model on the CPU; rendered as luminous additive threads on a
 * cold superfluid haze, lifted by a bloom pass, the camera drifting around the
 * tangle. The music is the energy: loudness ripples the lines and quickens the
 * rings, beats bow the pair toward reconnection and spray fresh rings, and the
 * dipole-polarisation axis (driven by the spectral centroid) decides which
 * Kelvin modes destabilise. Rests let it all relax to a few slow glowing loops.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const NODES = 110;
  const INTERP = 4;
  const RNODES = 56;
  const MAX_RINGS = 48;
  const FIL_PTS = (NODES - 1) * INTERP + 1;
  const MAX_POINTS = 2 * FIL_PTS + MAX_RINGS * RNODES;

  const DRAW_VERT = `#version 300 es
  precision highp float;
  layout(location = 0) in vec3 aPos;
  layout(location = 1) in vec2 aInfo;   // x: intensity, y: hue (0 cold .. 1 warm)
  uniform float uAngle, uAspect, uPointScale, uLevel;
  out float vInt;
  out float vHue;
  void main() {
    float ca = cos(uAngle), sa = sin(uAngle);
    float X =  aPos.x * ca + aPos.z * sa;
    float Z = -aPos.x * sa + aPos.z * ca;
    float Y = aPos.y;
    float d = 3.6;
    float denom = max(0.4, d - Z);
    float f = 2.5;
    vec2 s = vec2(f * X / denom / uAspect, f * Y / denom);
    gl_Position = vec4(s, 0.0, 1.0);
    float depth = clamp(denom / 4.2, 0.35, 2.4);
    gl_PointSize = aInfo.x * uPointScale * (4.6 / depth) * (1.4 + uLevel * 1.3);
    vInt = aInfo.x / depth;
    vHue = aInfo.y;
  }`;
  const DRAW_FRAG = `#version 300 es
  precision highp float;
  in float vInt;
  in float vHue;          // real hue 0..1
  out vec4 fragColor;
  vec3 hsv(float h, float s, float v) {
    vec3 k = abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0;
    return v * mix(vec3(1.0), clamp(k, 0.0, 1.0), s);
  }
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float core = exp(-r * r * 22.0);
    float halo = exp(-r * r * 5.0);
    vec3 col = hsv(vHue, 0.72, 1.0);
    fragColor = vec4(col * (core * 0.9 + halo * 0.35) * vInt, 1.0);
  }`;

  // composite: cold superfluid haze + tangle + bloom
  const POST_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uCanvas, uBloom;
  uniform vec2 uRes;
  uniform float uKeyHue, uAspect;
  void main() {
    vec2 p = (vUV - 0.5) * vec2(uAspect, 1.0);
    float r = length(p);
    // faint cold haze so the threads sit in a medium, not a void
    vec3 haze = vec3(0.01, 0.02, 0.045) * smoothstep(1.1, 0.1, r);
    haze += vec3(0.015, 0.03, 0.06) * fbm(p * 2.0 + uPhaseLevel * 0.04)
            * smoothstep(1.0, 0.2, r) * (0.5 + uLevel * 0.6);
    vec3 tangle = texture(uCanvas, vUV).rgb;
    vec3 bloom = texture(uBloom, vUV).rgb;
    vec3 col = haze + tangle * (1.1 + uLevel * 0.4) + bloom * (0.85 + uLevel * 0.5);
    col *= 1.0 - r * r * 0.32;
    col += (hash12(vUV * uRes) - 0.5) / 255.0;
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'crow cascade · vortex tangle',
    modes: ['music', 'ambient'],
    create(glc) {
      const gl = glc.gl;
      let canvas = null;
      const bloom = M.makeBloom(glc, { div: 4, passes: 3 });
      const pDraw = glc.program(DRAW_FRAG, DRAW_VERT);
      const pPost = glc.program(POST_FRAG);
      const vao = gl.createVertexArray();
      const vbo = gl.createBuffer();
      const verts = new Float32Array(MAX_POINTS * 5);
      let keyHue = 0.6;

      const yGrid = new Float32Array(NODES);
      for (let i = 0; i < NODES; i++) yGrid[i] = -1.0 + 2.0 * i / (NODES - 1);
      const SEP = 0.34;
      const fil = [
        { x: new Float32Array(NODES), z: new Float32Array(NODES), g: 1 },
        { x: new Float32Array(NODES), z: new Float32Array(NODES), g: -1 },
      ];
      for (let s = 0; s < 2; s++) {
        const sgn = s === 0 ? 1 : -1;
        for (let i = 0; i < NODES; i++) {
          const y = yGrid[i];
          fil[s].x[i] = sgn * SEP + 0.03 * Math.sin(y * 7 + s);
          fil[s].z[i] = 0.03 * Math.sin(y * 5 + s * 2);
        }
      }

      // ambient ring population — the cascade debris filling the tangle
      const rings = [];
      function spawnRing(cx, cy, cz, R, warm) {
        if (rings.length >= MAX_RINGS) return;
        rings.push({
          cx, cy, cz, R,
          th: Math.random() * Math.PI, ph: Math.random() * Math.PI * 2,
          wobA: 0.05 + Math.random() * 0.09, wobK: 2 + Math.floor(Math.random() * 3),
          wobP: Math.random() * 6.28, spin: (Math.random() - 0.5) * 2.4,
          drift: 0.04 + Math.random() * 0.09, life: 1.0, warm: warm || 0,
          hueOff: Math.random() * 0.5,
        });
      }
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * 6.28, rr = 0.25 + Math.random() * 0.95;
        spawnRing(Math.cos(a) * rr, (Math.random() - 0.5) * 1.5, Math.sin(a) * rr * 0.7,
          0.26 + Math.random() * 0.38, 0);
      }
      let pinchLatch = 0, flash = 0, spawnLatch = 0;

      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, verts.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
      gl.bindVertexArray(null);

      return {
        resize(w, h) {
          if (!canvas) canvas = glc.target(w, h);
          else canvas.resize(w, h);
          bloom.resize(w, h);
        },
        update(dt, audio, t) {
          const f = audio.f;
          const h = Math.min(dt, 0.033);
          keyHue = M.chromaHue(f.chroma, keyHue, dt);

          const polAng = f.phaseTreble * 0.4 + f.centroid * 3.1;
          const pol = 0.35 + f.centroid * 0.5;
          const px = Math.cos(polAng), pz = Math.sin(polAng);
          const sPar = 1.0 - 0.6 * pol, sPerp = 1.0 + 0.6 * pol;
          const mutGain = 1.3 + f.bass * 1.9 + f.beat * 1.5;
          const betaLIA = 0.8;
          const kAmp = (0.4 + f.level * 1.3) * (1.0 - f.quiet * 0.7);
          const kNum = 2.0 + Math.floor(f.treble * 5.0);
          const damp = 0.06 + f.quiet * 0.22;

          const A = fil[0], B = fil[1];
          const vAx = new Float32Array(NODES), vAz = new Float32Array(NODES);
          const vBx = new Float32Array(NODES), vBz = new Float32Array(NODES);
          for (let i = 1; i < NODES - 1; i++) {
            const y = yGrid[i], dy = yGrid[i + 1] - yGrid[i - 1];
            for (let s = 0; s < 2; s++) {
              const F = s === 0 ? A : B, O = s === 0 ? B : A;
              const tx = (F.x[i + 1] - F.x[i - 1]) / dy, tz = (F.z[i + 1] - F.z[i - 1]) / dy;
              const cx = F.x[i + 1] - 2 * F.x[i] + F.x[i - 1];
              const cz = F.z[i + 1] - 2 * F.z[i] + F.z[i - 1];
              let lvx = cz * betaLIA, lvz = -cx * betaLIA;
              let mvx = 0, mvz = 0;
              for (let j = 1; j < NODES - 1; j++) {
                const rx = F.x[i] - O.x[j], ry = y - yGrid[j], rz = F.z[i] - O.z[j];
                const r2 = rx * rx + ry * ry + rz * rz + 0.02;
                const inv = O.g / (r2 * Math.sqrt(r2));
                const dlx = (O.x[j + 1] - O.x[j - 1]) * 0.5;
                const dly = (yGrid[j + 1] - yGrid[j - 1]) * 0.5;
                const dlz = (O.z[j + 1] - O.z[j - 1]) * 0.5;
                mvx += (dly * rz - dlz * ry) * inv;
                mvz += (dlx * ry - dly * rx) * inv;
              }
              mvx *= mutGain * 0.04; mvz *= mutGain * 0.04;
              const ph = O.g;
              const fvx = kAmp * Math.sin(kNum * y + t * 2.0 * ph) * 0.06;
              const fvz = kAmp * Math.cos(kNum * y + t * 2.0 * ph) * 0.06;
              let vx = lvx + mvx + fvx, vz = lvz + mvz + fvz;
              const par = vx * px + vz * pz, per = -vx * pz + vz * px;
              const pp = par * sPar, qq = per * sPerp;
              vx = pp * px - qq * pz; vz = pp * pz + qq * px;
              if (s === 0) { vAx[i] = vx; vAz[i] = vz; } else { vBx[i] = vx; vBz[i] = vz; }
            }
          }
          const tether = 0.015;
          for (let i = 1; i < NODES - 1; i++) {
            A.x[i] += vAx[i] * h - (A.x[i] - SEP) * tether;
            A.z[i] += vAz[i] * h - A.z[i] * damp * h;
            B.x[i] += vBx[i] * h - (B.x[i] + SEP) * tether;
            B.z[i] += vBz[i] * h - B.z[i] * damp * h;
          }
          let mx = 0, mz = 0;
          for (let i = 1; i < NODES - 1; i++) { mx += A.x[i] + B.x[i]; mz += A.z[i] + B.z[i]; }
          mx /= 2 * (NODES - 2); mz /= 2 * (NODES - 2);
          for (let i = 0; i < NODES; i++) { A.x[i] -= mx; A.z[i] -= mz; B.x[i] -= mx; B.z[i] -= mz; }

          // reconnection → spray a couple of fresh daughter rings
          pinchLatch -= dt;
          for (let i = 2; i < NODES - 2; i++) {
            const dx = B.x[i] - A.x[i], dz = B.z[i] - A.z[i];
            if (Math.hypot(dx, dz) < 0.17 && pinchLatch <= 0) {
              pinchLatch = 0.18;
              const cx = (A.x[i] + B.x[i]) * 0.5, cz = (A.z[i] + B.z[i]) * 0.5;
              spawnRing(cx, yGrid[i], cz, 0.06 + Math.random() * 0.04, 1);
              spawnRing(cx, yGrid[i] + 0.1, cz, 0.05, 1);
              flash = 1.0;
              for (let k = -3; k <= 3; k++) {
                const idx = i + k; if (idx < 1 || idx > NODES - 2) continue;
                const w = Math.exp(-k * k * 0.3);
                A.x[idx] += (-SEP - A.x[idx]) * 0.25 * w;
                B.x[idx] += (SEP - B.x[idx]) * 0.25 * w;
                A.z[idx] *= 1 - 0.4 * w; B.z[idx] *= 1 - 0.4 * w;
              }
            }
          }
          flash *= Math.pow(0.5, dt / 0.2);

          // beats spray ambient rings too — the cascade quickens with the music
          spawnLatch -= dt;
          if (f.beat > 0.9 && spawnLatch <= 0) {
            spawnLatch = 0.12;
            const a = Math.random() * 6.28, rr = 0.4 + Math.random() * 0.6;
            spawnRing(Math.cos(a) * rr, (Math.random() - 0.5) * 1.2, Math.sin(a) * rr * 0.6,
              0.08 + f.bass * 0.1, 0.3);
          }

          // evolve rings: drift along their axis, wobble, shrink, fade, respawn
          const ringSpeed = 0.7 + f.level * 1.2;
          for (let i = rings.length - 1; i >= 0; i--) {
            const R = rings[i];
            const st = Math.sin(R.th), ct = Math.cos(R.th);
            const nx = st * Math.cos(R.ph), ny = ct, nz = st * Math.sin(R.ph);
            const sp = (R.drift + 0.015 / Math.max(0.04, R.R)) * ringSpeed;
            R.cx += nx * sp * h; R.cy += ny * sp * h; R.cz += nz * sp * h;
            R.R -= (0.004 + 0.012 * (1 - R.R)) * h * (0.6 + f.level);
            R.wobP += R.spin * h * (0.5 + f.treble);
            R.life -= h * 0.08;
            if (R.R < 0.03 || R.life <= 0 ||
                R.cx * R.cx + R.cz * R.cz > 3.0 || Math.abs(R.cy) > 1.9) {
              rings.splice(i, 1);
            }
          }
          // keep the tangle populated
          while (rings.length < 13) {
            const a = Math.random() * 6.28, rr = 0.25 + Math.random() * 0.95;
            spawnRing(Math.cos(a) * rr, (Math.random() - 0.5) * 1.5, Math.sin(a) * rr * 0.7,
              0.26 + Math.random() * 0.36, 0);
          }
          this._flash = flash;
        },
        render(out, audio, t) {
          if (!canvas) return;
          const f = audio.f;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const beatGlow = 1.0 + f.beat * 1.2 + f.level * 0.5;
          let n = 0;

          // filament pair
          for (let s = 0; s < 2; s++) {
            const F = fil[s];
            for (let i = 0; i < NODES - 1; i++) {
              const sub = i === NODES - 2 ? INTERP + 1 : INTERP;
              // fade the ends so the filaments dissolve into the medium rather
              // than trailing dotted tails into the corners
              const fr = i / (NODES - 1);
              const taper = Math.min(Math.min(1, fr / 0.12), Math.min(1, (1 - fr) / 0.12));
              for (let k = 0; k < sub; k++) {
                const u = k / INTERP, o = n * 5;
                verts[o] = F.x[i] + (F.x[i + 1] - F.x[i]) * u;
                verts[o + 1] = yGrid[i] + (yGrid[i + 1] - yGrid[i]) * u;
                verts[o + 2] = F.z[i] + (F.z[i + 1] - F.z[i]) * u;
                verts[o + 3] = (0.95 + flash * 0.9) * beatGlow * taper;
                // cool key-tinted filament, flashing warm at a reconnection
                verts[o + 4] = ((keyHue + 0.5 + fr * 0.25 - flash * 0.45) % 1 + 1) % 1;
                n++;
              }
            }
          }
          // rings (wobbling loops in 3D)
          for (const R of rings) {
            const st = Math.sin(R.th), ct = Math.cos(R.th);
            const nx = st * Math.cos(R.ph), ny = ct, nz = st * Math.sin(R.ph);
            // basis perpendicular to the ring normal
            let ux = -Math.sin(R.ph), uy = 0, uz = Math.cos(R.ph);
            const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
            const fade = Math.min(1, R.life * 2.0) * (0.5 + R.R * 2.0);
            for (let k = 0; k < RNODES; k++) {
              const a = k / RNODES * 6.28318;
              const wob = 1.0 + R.wobA * Math.sin(R.wobK * a + R.wobP);
              const ca = Math.cos(a) * R.R * wob, sa = Math.sin(a) * R.R * wob;
              const o = n * 5;
              verts[o] = R.cx + ux * ca + vx * sa;
              verts[o + 1] = R.cy + uy * ca + vy * sa;
              verts[o + 2] = R.cz + uz * ca + vz * sa;
              verts[o + 3] = fade * beatGlow * 1.15;
              verts[o + 4] = ((keyHue + 0.45 + R.hueOff - R.warm * 0.4) % 1 + 1) % 1;
              n++;
            }
          }

          gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts.subarray(0, n * 5));

          gl.bindFramebuffer(gl.FRAMEBUFFER, canvas.fbo);
          gl.viewport(0, 0, canvas.w, canvas.h);
          gl.clearColor(0, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.useProgram(pDraw.handle);
          pDraw.f('uAngle', t * 0.1).f('uAspect', glc.width / glc.height)
               .f('uPointScale', dpr).f('uLevel', f.level);
          gl.bindVertexArray(vao);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.drawArrays(gl.POINTS, 0, n);
          gl.disable(gl.BLEND);
          gl.bindVertexArray(null);

          bloom.render(canvas.tex, glc.width, glc.height, 0.35);

          pPost.use().v2('uRes', glc.width, glc.height)
            .f('uKeyHue', keyHue).f('uAspect', glc.width / glc.height)
            .tex('uCanvas', canvas.tex, 0).tex('uBloom', bloom.tex, 1);
          M.audioUniforms(pPost, audio, t);
          glc.draw(pPost, out);
        },
        dispose() {
          if (canvas) canvas.dispose();
          bloom.dispose();
          gl.deleteVertexArray(vao);
          gl.deleteBuffer(vbo);
          for (const p of [pDraw, pPost]) p.dispose();
        },
      };
    },
  });
})();
