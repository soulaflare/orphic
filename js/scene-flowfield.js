/* ORPHIC scene — CURL-NOISE FLOW FIELD · star river
 * Bridson et al. (2007) divergence-free curl noise advecting 262k particles
 * with additive feedback trails. Audio: spectral centroid scales the noise
 * field (bright sound → fine turbulence), bass drives flow speed, onsets
 * detonate a respawn ring, and the whole field slowly rotates in beat phase.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const DIM = 512;

  const INIT_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform float uSeed;
  void main() {
    vec2 h = hash22(gl_FragCoord.xy + uSeed);
    vec2 h2 = hash22(gl_FragCoord.yx * 3.7 + uSeed);
    fragColor = vec4(h, 0.0, h2.x * 8.0); // pos, angle, age
  }`;

  const UPDATE_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uParticles;
  uniform float uAspect, uDt;

  vec2 curl(vec2 p) {
    float e = 0.01;
    float n1 = fbm(p + vec2(0.0, e));
    float n2 = fbm(p - vec2(0.0, e));
    float n3 = fbm(p + vec2(e, 0.0));
    float n4 = fbm(p - vec2(e, 0.0));
    return vec2(n1 - n2, n4 - n3) / (2.0 * e);
  }

  void main() {
    vec4 a = texelFetch(uParticles, ivec2(gl_FragCoord.xy), 0);
    vec2 pos = a.xy;
    float age = a.w;
    vec2 h = hash22(gl_FragCoord.xy + fract(uTime) * 971.0);

    float scale = 1.8 + uCentroid * 3.5;
    float speed = (0.022 + uBass * 0.10 + uLevel * 0.05);
    float rot = uBeatPhase * 6.28318 * 0.02 + uTime * 0.03;
    mat2 R = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));

    vec2 field = pos * vec2(uAspect, 1.0) * scale;
    vec2 v = R * curl(field + vec2(uTime * 0.05, -uTime * 0.03));
    // galactic swirl: gentle pull plus orbit around the centre
    vec2 toC = vec2(0.5) - pos;
    v += toC * 0.30 + vec2(-toC.y, toC.x) * (0.40 + uMid * 0.5);

    pos += v * speed * uDt * vec2(1.0 / uAspect, 1.0);
    age += uDt;

    float life = 6.0 + h.y * 6.0;
    // onsets detonate a few; a return from silence detonates a third of the sky
    bool burst = (uOnset > 0.9 && h.x < 0.05) || (uBurst > 0.8 && h.x < 0.33);
    if (age > life || pos.x < -0.05 || pos.x > 1.05 || pos.y < -0.05 || pos.y > 1.05 || burst) {
      if (burst) {
        float ang = h.y * 6.28318;
        float r = 0.12 + h.x * 2.5;
        pos = vec2(0.5) + vec2(cos(ang) / uAspect, sin(ang)) * r;
      } else {
        pos = hash22(gl_FragCoord.xy * 1.31 + uTime);
      }
      age = 0.0;
    }
    float angle = atan(v.y, v.x);
    fragColor = vec4(pos, angle, age);
  }`;

  const DRAW_VERT = `#version 300 es
  precision highp float;
  uniform sampler2D uParticles;
  uniform int uDim;
  uniform float uPointSize, uTime, uCentroid, uBass, uTreble, uLevel;
  out vec3 vColor;
  vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.28318 * (c * t + d));
  }
  void main() {
    ivec2 tc = ivec2(gl_VertexID % uDim, gl_VertexID / uDim);
    vec4 p = texelFetch(uParticles, tc, 0);
    gl_Position = vec4(p.xy * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = uPointSize;
    // hue from position, not velocity angle — coherent colour fields, not confetti
    float radial = length(p.xy - 0.5);
    float hue = radial * 0.55 + p.z / 6.28318 * 0.12 + uTime * 0.012 + uCentroid * 0.25;
    vColor = pal(hue, vec3(0.55), vec3(0.45), vec3(1.0), vec3(0.0, 0.33, 0.67));
    float fade = smoothstep(0.0, 0.4, p.w); // fade-in after respawn
    vColor *= (0.022 + uLevel * 0.075) * fade;
  }`;

  const DRAW_FRAG = `#version 300 es
  precision highp float;
  in vec3 vColor;
  out vec4 fragColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float fall = smoothstep(0.5, 0.0, length(d));
    fragColor = vec4(vColor * fall, 1.0);
  }`;

  const FADE_FRAG = M.FRAG_HEADER + `
  uniform sampler2D uAccum;
  uniform float uFade;
  void main() {
    vec3 c = texture(uAccum, vUV).rgb * uFade;
    fragColor = vec4(max(c - 0.0004, 0.0), 1.0); // hard floor kills ghost trails
  }`;

  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uAccum;
  void main() {
    vec3 c = texture(uAccum, vUV).rgb;
    c = c * (1.1 + uBeat * 0.25);
    float d = length(vUV - 0.5);
    c *= 1.0 - d * d * 0.85;
    fragColor = vec4(aces(c), 1.0);
  }`;

  M.registerScene({
    name: 'star river · curl-noise flow',
    modes: ['music', 'speech', 'ambient'],
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
          const aspect = glc.width / glc.height;
          pUpdate.use();
          M.audioUniforms(pUpdate, audio, t);
          pUpdate.f('uAspect', aspect).f('uDt', Math.min(dt, 0.033))
                 .tex('uParticles', particles.read.tex, 0);
          glc.draw(pUpdate, particles.write);
          particles.swap();

          // fade previous accumulation into write buffer
          pFade.use().f('uFade', 0.87 - audio.f.flux * 0.04)
               .tex('uAccum', accum.read.tex, 0);
          glc.draw(pFade, accum.write);

          // draw particles additively on top
          const f = audio.f;
          gl.bindFramebuffer(gl.FRAMEBUFFER, accum.write.fbo);
          gl.viewport(0, 0, accum.write.w, accum.write.h);
          gl.useProgram(pDraw.handle);
          pDraw._pendingTex.length = 0;
          pDraw.i('uDim', DIM)
               .f('uPointSize', (1.2 + f.bassFast * 2.2) * Math.min(window.devicePixelRatio || 1, 2))
               .f('uTime', t).f('uCentroid', f.centroid)
               .f('uBass', f.bass).f('uTreble', f.treble).f('uLevel', f.level)
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
