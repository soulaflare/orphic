/* ORPHIC scene — SWARMALATORS · sync swarm
 * Oscillators that swarm: each of 4,096 agents carries a position AND an
 * internal phase, and the two couple both ways — phase pulls bodies together,
 * nearby bodies pull phases into sync (O'Keeffe, Hong & Strogatz 2017). Held in
 * the "active phase wave" regime the crowd becomes a slowly rotating disc of
 * living colour: phase reads as hue, so a rainbow wheels around the rim while
 * the bodies orbit through it. The music never collapses the swarm — it
 * ENERGISES it: loudness drives the rotation harder and brighter (K more
 * negative → more active), beats send a pulse breathing outward, and a slow
 * tide morphs the body between a tight rainbow ring, splintered clusters, and a
 * loose drifting cloud. Only true rests let it disperse and fade to the dark.
 *
 * Attraction and short-range repulsion are kept balanced so the disc always
 * holds a healthy radius (the old build drove attraction with loudness and
 * music crushed it to a dead knot — the same fragmentation-not-energy mistake
 * the murmuration scene warns against). Rendered as luminous additive motes
 * with orbital trails over an atmospheric nebula, lifted by a bloom pass.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const DIM = 64;            // 4,096 swarmalators
  const N = DIM * DIM;

  const INIT_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform float uSeed;
  void main() {
    vec2 h = hash22(gl_FragCoord.xy + uSeed);
    vec2 h2 = hash22(gl_FragCoord.yx * 1.7 + uSeed + 11.0);
    float ang = h.x * 6.28318;
    float rad = sqrt(h.y) * 1.0;
    fragColor = vec4(vec2(cos(ang), sin(ang)) * rad,
                     h2.x * 6.28318, (h2.y - 0.5) * 0.6);
  }`;

  // one Euler step of the coupled position+phase swarmalator ODE
  const UPDATE_FRAG = M.FRAG_HEADER + `
  uniform sampler2D uState;
  uniform float uDt, uJ, uK, uAttr, uRep, uPhi, uOmega, uSpin, uStir, uDisperse, uCenter;
  void main() {
    ivec2 selfTc = ivec2(gl_FragCoord.xy);
    vec4 s = texelFetch(uState, selfTc, 0);
    vec2 xi = s.xy; float th = s.z; float om = s.w;

    vec2 dx = vec2(0.0);
    vec2 com = vec2(0.0);
    float dth = 0.0;
    for (int j = 0; j < ${N}; j++) {
      ivec2 tc = ivec2(j % ${DIM}, j / ${DIM});
      vec4 o = texelFetch(uState, tc, 0);
      com += o.xy;
      vec2 r = o.xy - xi;
      float d2 = dot(r, r) + 3.0e-3;
      float d = sqrt(d2);
      vec2 u = r / d;
      float dphase = o.z - th;
      dx += u * (uAttr + uJ * cos(dphase - uPhi)) - (r / d2) * uRep;
      dth += sin(dphase - uPhi) / d;
    }
    float inv = 1.0 / float(${N});
    dx *= inv;
    com *= inv;
    dth = dth * inv * uK + om * uOmega + uSpin;

    // a gentle rigid swirl makes the active-phase-wave rotation legible
    dx += vec2(-xi.y, xi.x) * uSpin * 0.6;
    // beats breathe the whole disc outward, then it settles
    float rr = length(xi) + 1e-4;
    dx += (xi / rr) * uStir;
    // only true rests push the swarm apart into the dark
    dx += (xi / rr) * uDisperse;
    // pin the centroid (not each body) so the asymmetric phase-coupling drift
    // is cancelled by a pure translation — keeps it framed without contracting
    dx += -com * uCenter;

    float sp = length(dx);
    if (sp > 8.0) dx *= 8.0 / sp;

    fragColor = vec4(xi + dx * uDt, mod(th + dth * uDt, 6.28318530718), om);
  }`;

  const FADE_FRAG = M.FRAG_HEADER + `
  uniform sampler2D uPrev; uniform float uFade;
  void main() { fragColor = texture(uPrev, vUV) * uFade; }`;

  // additive motes, hue from phase, size from a per-agent depth + loudness
  const DRAW_VERT = `#version 300 es
  precision highp float;
  uniform sampler2D uState;
  uniform float uViewScale, uAspect, uPointScale, uLevel, uKeyHue, uSat;
  out vec3 vCol;
  ${M.GLSL_COLOR}
  ${M.GLSL_NOISE}
  ${M.GLSL_SPECTRUM}
  void main() {
    ivec2 tc = ivec2(gl_VertexID % ${DIM}, gl_VertexID / ${DIM});
    vec4 a = texelFetch(uState, tc, 0);
    vec2 clip = vec2(a.x * uViewScale / uAspect, a.y * uViewScale);
    gl_Position = vec4(clip, 0.0, 1.0);
    float h = fract(a.z / 6.28318 + uKeyHue);
    float depth = hash12(vec2(tc));
    // each agent is keyed to one spectrum slice — its band sparkling lights it
    float band = specLog(hash12(vec2(tc) * 1.7 + 3.0));
    float shimmer = 0.45 + depth * 0.35 + band * 0.6;
    vCol = hsv(h, uSat, 1.0) * shimmer;
    gl_PointSize = (1.6 + depth * 1.8 + uLevel * 2.0 + band * 2.2) * uPointScale;
  }`;
  const DRAW_FRAG = `#version 300 es
  precision highp float;
  in vec3 vCol;
  out vec4 fragColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, d);
    float glow = exp(-d * d * 6.0);
    fragColor = vec4(vCol * (core * 0.5 + glow * 0.4), 1.0);
  }`;

  // composite: atmospheric nebula + trails + bloom, tonemapped
  const POST_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + M.GLSL_EMBERS + `
  uniform sampler2D uCanvas, uBloom;
  uniform vec2 uRes;
  uniform float uKeyHue, uAspect;
  void main() {
    vec2 p = (vUV - 0.5) * vec2(uAspect, 1.0);
    float r = length(p);
    // deep nebula backdrop, warm core that breathes with the bass
    vec3 bg = pal(uKeyHue + 0.55, vec3(0.018, 0.02, 0.035), vec3(0.02, 0.025, 0.045),
                  vec3(1.0), vec3(0.0, 0.25, 0.5));
    bg *= smoothstep(1.1, 0.1, r);
    bg += pal(uKeyHue, vec3(0.04), vec3(0.05), vec3(1.0), vec3(0.0, 0.3, 0.6))
          * exp(-r * r * 3.0) * (0.5 + uBass * 1.4 + uBeat * 0.6);

    // the cloud slowly wheels WITH the swarm: domain-rotate the fbm so the
    // backdrop reads as the medium the disc is stirring, not a flat picture.
    // two octaves counter-rotate slightly for a sense of churning depth
    float a = uPhaseLevel * 0.05;
    mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 q = rot * p;
    float neb = fbm(q * 2.3) * 0.62 + fbm(q * 5.1 - uPhaseLevel * 0.03) * 0.38;
    bg += pal(uKeyHue + 0.3, vec3(0.02), vec3(0.03), vec3(1.0), vec3(0.0, 0.2, 0.4))
          * neb * smoothstep(1.0, 0.2, r) * 1.1;

    // a soft halo well around the disc's rim — the swarm sits IN a pool of
    // light rather than on dead black; breathes gently with the bass
    float halo = exp(-pow((r - 0.42) * 2.3, 2.0));
    bg += pal(uKeyHue + 0.12, vec3(0.025), vec3(0.035), vec3(1.0), vec3(0.0, 0.33, 0.66))
          * halo * (0.34 + uBass * 0.5 + uBeat * 0.25);

    // drifting star dust gives the void depth and quiet life — kept to the
    // dark surround so it never clutters the bodies, twinkles with treble
    float dust = embers(vUV, uAspect, 26.0, 0.006, 0.10, 7.0);
    vec3 dustCol = vec3(0.55, 0.66, 1.0) * 0.5
                 + pal(uKeyHue, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)) * 0.5;
    bg += dustCol * dust * (0.13 + uTreble * 0.12) * smoothstep(0.18, 0.7, r);

    vec3 trails = texture(uCanvas, vUV).rgb;
    vec3 bloom = texture(uBloom, vUV).rgb;
    vec3 col = bg + trails * (1.0 + uLevel * 0.35) + bloom * (0.5 + uLevel * 0.4);

    col *= 1.0 - r * r * 0.45;
    col += (hash12(vUV * uRes) - 0.5) / 255.0;
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'sync swarm · swarmalators',
    modes: ['music', 'ambient'],
    create(glc) {
      const gl = glc.gl;
      const state = glc.pingpong(DIM, DIM, { nearest: true });
      let canvas = null;
      const bloom = M.makeBloom(glc, { div: 4, passes: 3 });
      const pInit = glc.program(INIT_FRAG);
      const pUpdate = glc.program(UPDATE_FRAG);
      const pFade = glc.program(FADE_FRAG);
      const pDraw = glc.program(DRAW_FRAG, DRAW_VERT);
      const pPost = glc.program(POST_FRAG);
      const vao = gl.createVertexArray();
      let keyHue = 0.0, stir = 0, spin = 0;

      pInit.use().f('uSeed', Math.random() * 100);
      glc.draw(pInit, state.read);

      return {
        resize(w, h) {
          if (!canvas) canvas = glc.pingpong(w, h);
          else canvas.resize(w, h);
          canvas.a.clear(0, 0, 0, 1); canvas.b.clear(0, 0, 0, 1);
          bloom.resize(w, h);
        },
        update(dt, audio, t) {
          const f = audio.f;
          keyHue = M.chromaHue(f.chroma, keyHue, dt);

          // balanced attraction/repulsion → the disc always holds a radius
          const attr = 1.0 + f.beat * 0.15;
          const rep = 1.0;
          // a slow tide morphs the body: tight rainbow ring ↔ splintered ↔ cloud
          const tide = 0.5 + 0.5 * Math.sin(f.phaseLevel * 0.14);
          const J = 0.5 + tide * 0.6 + f.harmonic * 0.3;
          // K NEGATIVE = the active phase wave (perpetual rotation); louder
          // music drives it harder — this is the energy handle, not collapse
          const K = -0.1 - f.level * 0.9 - f.beat * 0.3;
          const phi = (f.centroid - 0.45) * 0.9;        // mild chimera drift
          const omega = 0.4 + f.treble * 1.2;           // internal-clock spin
          // global rigid rotation, audible as the whole wheel turning
          spin = 0.15 + f.level * 0.9 + f.mid * 0.4;

          if (f.beat > 0.9) stir = 0.4 + f.bassFast * 0.7;
          stir *= Math.pow(0.5, dt / 0.14);
          const disperse = f.quiet * 0.5;               // rests scatter to dark

          pUpdate.use()
            .f('uDt', Math.min(dt, 0.033) * 1.25)
            .f('uJ', J).f('uK', K).f('uAttr', attr).f('uRep', rep)
            .f('uPhi', phi).f('uOmega', omega).f('uSpin', spin * dt)
            .f('uStir', stir).f('uDisperse', disperse).f('uCenter', 0.6)
            .tex('uState', state.read.tex, 0);
          glc.draw(pUpdate, state.write);
          state.swap();
        },
        render(out, audio, t) {
          if (!canvas) return;
          const f = audio.f;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);

          const fade = 0.86 - f.quiet * 0.30 + f.level * 0.05;
          pFade.use().f('uFade', Math.min(0.93, fade)).tex('uPrev', canvas.read.tex, 0);
          glc.draw(pFade, canvas.write);

          gl.bindFramebuffer(gl.FRAMEBUFFER, canvas.write.fbo);
          gl.viewport(0, 0, canvas.write.w, canvas.write.h);
          pDraw.use()
            .f('uViewScale', 0.5).f('uAspect', glc.width / glc.height)
            .f('uPointScale', dpr).f('uLevel', f.level)
            .f('uKeyHue', keyHue).f('uSat', 0.78 + f.flatness * 0.18)
            .tex('uState', state.read.tex, 0);
          M.spectrumUniforms(pDraw, audio, 1);
          pDraw.bind();
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.bindVertexArray(vao);
          gl.drawArrays(gl.POINTS, 0, N);
          gl.disable(gl.BLEND);
          canvas.swap();

          bloom.render(canvas.read.tex, glc.width, glc.height, 0.5);

          pPost.use().v2('uRes', glc.width, glc.height)
            .f('uKeyHue', keyHue).f('uAspect', glc.width / glc.height)
            .tex('uCanvas', canvas.read.tex, 0).tex('uBloom', bloom.tex, 1);
          M.audioUniforms(pPost, audio, t);
          glc.draw(pPost, out);
        },
        dispose() {
          state.dispose();
          if (canvas) canvas.dispose();
          bloom.dispose();
          gl.deleteVertexArray(vao);
          for (const p of [pInit, pUpdate, pFade, pDraw, pPost]) p.dispose();
        },
      };
    },
  });
})();
