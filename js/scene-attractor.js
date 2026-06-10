/* ORPHIC scene — STRANGE ATTRACTOR · chaos cathedral
 * Peter de Jong map: x' = sin(a·y) − cos(b·x), y' = sin(c·x) − cos(d·y).
 * 262k particles iterate the map each frame; additive accumulation reveals
 * the attractor's density skeleton. Beat-synced attractor morphing: each
 * beat (or every few seconds) the four coefficients spring toward the next
 * known-good parameter set, so the cathedral collapses and re-crystallises
 * in rhythm. Bass breathes the camera, phase accumulators rotate it.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const DIM = 512;

  // known-good de Jong parameter sets (dense, structured attractors)
  const SETS = [
    [1.4, -2.3, 2.4, -2.1],
    [-2.7, -0.09, -0.86, -2.2],
    [-2.24, 0.43, -0.65, -2.43],
    [2.01, -2.53, 1.61, -0.33],
    [1.641, 1.902, 0.316, 1.525],
    [0.970, -1.899, 1.381, -1.506],
    [-2.0, -2.0, -1.2, 2.0],
    [-0.827, -1.637, 1.659, -0.943],
  ];

  const INIT_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform float uSeed;
  void main() {
    vec2 h = hash22(gl_FragCoord.xy + uSeed);
    fragColor = vec4((h - 0.5) * 4.0, 0.0, 0.0);
  }`;

  const UPDATE_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform sampler2D uParticles;
  uniform vec4 uParams;
  uniform float uJitter, uTime;
  void main() {
    vec4 s = texelFetch(uParticles, ivec2(gl_FragCoord.xy), 0);
    vec2 p = s.xy;
    float a = uParams.x, b = uParams.y, c = uParams.z, d = uParams.w;
    vec2 np = vec2(sin(a * p.y) - cos(b * p.x),
                   sin(c * p.x) - cos(d * p.y));
    // tiny jitter de-correlates particles that landed on the same orbit
    vec2 h = hash22(gl_FragCoord.xy + fract(uTime) * 779.0);
    np += (h - 0.5) * uJitter;
    // escaped / degenerate orbits respawn near origin
    if (!(abs(np.x) < 4.0 && abs(np.y) < 4.0)) np = (h - 0.5) * 2.0;
    fragColor = vec4(np, p);  // keep previous position for velocity colour
  }`;

  const DRAW_VERT = `#version 300 es
  precision highp float;
  uniform sampler2D uParticles;
  uniform int uDim;
  uniform float uZoom, uRot, uAspect, uGain, uHue;
  out vec3 vColor;
  vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.28318 * (c * t + d));
  }
  void main() {
    ivec2 tc = ivec2(gl_VertexID % uDim, gl_VertexID / uDim);
    vec4 s = texelFetch(uParticles, tc, 0);
    vec2 p = s.xy * 0.42 * uZoom;
    p = mat2(cos(uRot), -sin(uRot), sin(uRot), cos(uRot)) * p;
    p.x /= uAspect;
    gl_Position = vec4(p, 0.0, 1.0);
    gl_PointSize = 1.0;
    float speed = length(s.xy - s.zw);
    vColor = pal(uHue + speed * 0.12, vec3(0.55), vec3(0.45), vec3(1.0), vec3(0.0, 0.33, 0.67)) * uGain;
  }`;

  const DRAW_FRAG = `#version 300 es
  precision highp float;
  in vec3 vColor;
  out vec4 fragColor;
  void main() { fragColor = vec4(vColor, 1.0); }`;

  const FADE_FRAG = M.FRAG_HEADER + `
  uniform sampler2D uAccum;
  uniform float uFade;
  void main() {
    vec3 c = texture(uAccum, vUV).rgb * uFade;
    fragColor = vec4(max(c - 0.0006, 0.0), 1.0);
  }`;

  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uAccum;
  void main() {
    vec3 c = texture(uAccum, vUV).rgb;
    c = pow(c, vec3(0.8)); // lift faint filaments
    c *= 1.0 + uBeat * 0.3;
    float d = length(vUV - 0.5);
    c *= 1.0 - d * d * 0.9;
    fragColor = vec4(aces(c), 1.0);
  }`;

  M.registerScene({
    name: 'chaos cathedral · de jong attractor',
    modes: ['music', 'ambient'],
    create(glc) {
      const gl = glc.gl;
      const particles = glc.pingpong(DIM, DIM, { nearest: true });
      let accum = null;
      const pInit = glc.program(INIT_FRAG);
      const pUpdate = glc.program(UPDATE_FRAG);
      const pDraw = glc.program(DRAW_FRAG, DRAW_VERT);
      const pFade = glc.program(FADE_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const vao = gl.createVertexArray();

      let setIdx = 0;
      let cur = SETS[0].slice(), tgt = SETS[0].slice();
      let morphHold = 0, rot = 0, zoom = 1;

      pInit.use().f('uSeed', Math.random() * 100);
      glc.draw(pInit, particles.read);

      return {
        resize(w, h) {
          if (!accum) accum = glc.pingpong(w, h);
          else { accum.a.resize(w, h); accum.b.resize(w, h); }
          accum.a.clear(); accum.b.clear();
        },
        update(dt, audio, t) {
          if (!accum) return;
          const f = audio.f;

          // beat-synced morphing: advance on strong beats, else every ~9s
          morphHold += dt;
          const beatGo = f.beat > 0.9 && morphHold > 2.2 && f.beatConf > 0.3;
          if (beatGo || morphHold > 9) {
            setIdx = (setIdx + 1 + ((Math.random() * (SETS.length - 1)) | 0)) % SETS.length;
            tgt = SETS[setIdx].slice();
            morphHold = 0;
          }
          const k = 1 - Math.exp(-dt * 1.6);
          for (let i = 0; i < 4; i++) cur[i] += (tgt[i] - cur[i]) * k;
          // continuous micro-wobble from the bass phase accumulator
          const wob = [
            cur[0] + Math.sin(f.phaseBass * 0.9) * 0.045,
            cur[1] + Math.cos(f.phaseBass * 0.7) * 0.045,
            cur[2] + Math.sin(f.phaseTreble * 0.8 + 1.7) * 0.035,
            cur[3] + Math.cos(f.phaseLevel * 0.6 + 0.4) * 0.035,
          ];
          rot += dt * (0.03 + f.mid * 0.1);
          const zTgt = 1.0 + f.bassFast * 0.14;
          zoom += (zTgt - zoom) * (1 - Math.exp(-dt * 10));

          // iterate the map several times per frame for crisp density
          for (let it = 0; it < 3; it++) {
            pUpdate.use()
              .v4('uParams', wob[0], wob[1], wob[2], wob[3])
              // a return from silence blasts particles off the attractor;
              // they re-condense onto it over the next second
              .f('uJitter', 0.002 + f.flux * 0.02 + f.burst * 0.30)
              .f('uTime', t + it * 0.37)
              .tex('uParticles', particles.read.tex, 0);
            glc.draw(pUpdate, particles.write);
            particles.swap();
          }

          pFade.use().f('uFade', 0.90 - f.onset * 0.06 - f.quiet * 0.05)
               .tex('uAccum', accum.read.tex, 0);
          glc.draw(pFade, accum.write);

          gl.bindFramebuffer(gl.FRAMEBUFFER, accum.write.fbo);
          gl.viewport(0, 0, accum.write.w, accum.write.h);
          gl.useProgram(pDraw.handle);
          pDraw._pendingTex.length = 0;
          pDraw.i('uDim', DIM)
               .f('uZoom', zoom).f('uRot', rot)
               .f('uAspect', glc.width / glc.height)
               .f('uGain', 0.025 + f.level * 0.05)
               .f('uHue', f.centroid * 0.4 + f.phaseLevel * 0.01)
               .tex('uParticles', particles.read.tex, 0);
          pDraw._bindPending();
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.bindVertexArray(vao);
          gl.drawArrays(gl.POINTS, 0, DIM * DIM);
          gl.disable(gl.BLEND);
          accum.swap();
        },
        render(out, audio, t) {
          if (!accum) return;
          pShow.use().tex('uAccum', accum.read.tex, 0);
          M.audioUniforms(pShow, audio, t);
          glc.draw(pShow, out);
        },
        dispose() {
          particles.dispose();
          if (accum) accum.dispose();
          gl.deleteVertexArray(vao);
        },
      };
    },
  });
})();
