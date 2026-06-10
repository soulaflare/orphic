/* ORPHIC scene — MURMURATION · dusk flock
 * 65k starlings over a dusk sky — dark silhouettes, not neon, so the scene
 * stands apart from the additive ones. Boids without neighbor lists: every
 * frame the flock splats velocity + density into a 128² field texture, and
 * each bird steers from that field (alignment = local mean velocity,
 * cohesion = up the coarse density gradient, separation = down the fine
 * gradient). O(n), no spatial hashing, weak-GPU friendly.
 * Audio owns the flock's mood: kicks flare separation so the cloud bursts
 * and regroups, mids tighten alignment (discipline of the formation),
 * onsets launch a hawk through the flock (real murmuration ripples), and
 * every bird is keyed to one spectrum slice — its band's energy agitates it,
 * so different frequencies shimmer through different parts of the cloud.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const DIM = 256;        // 65,536 birds
  const FIELD = 128;      // neighborhood field resolution

  const INIT_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform float uSeed;
  void main() {
    vec2 h = hash22(gl_FragCoord.xy + uSeed);
    vec2 h2 = hash22(gl_FragCoord.yx * 2.3 + uSeed + 17.0);
    float ang = h.x * 6.28318;
    vec2 pos = vec2(0.5, 0.55) + vec2(cos(ang), sin(ang)) * (0.04 + 0.16 * h.y);
    vec2 vel = vec2(cos(ang + 1.8), sin(ang + 1.8)) * 0.09;
    fragColor = vec4(pos, vel * (0.7 + 0.6 * h2.x));
  }`;

  // splat each bird's velocity + presence into the field (additive points)
  const FIELD_VERT = `#version 300 es
  precision highp float;
  uniform sampler2D uAgents;
  uniform int uDim;
  out vec2 vVel;
  void main() {
    ivec2 tc = ivec2(gl_VertexID % uDim, gl_VertexID / uDim);
    vec4 a = texelFetch(uAgents, tc, 0);
    vVel = a.zw;
    gl_Position = vec4(a.xy * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 5.0;
  }`;
  const FIELD_FRAG = `#version 300 es
  precision highp float;
  in vec2 vVel;
  out vec4 fragColor;
  void main() {
    float w = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
    fragColor = vec4(vVel * w, w, 0.0);
  }`;

  const UPDATE_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + M.GLSL_SPECTRUM + `
  uniform sampler2D uAgents, uField;
  uniform float uAspect, uDt;
  uniform vec2 uRoost;
  uniform vec3 uPredator; // xy pos, z = active

  void main() {
    vec4 a = texelFetch(uAgents, ivec2(gl_FragCoord.xy), 0);
    vec2 pos = a.xy, vel = a.zw;
    vec2 h = hash22(gl_FragCoord.xy);

    vec4 f = texture(uField, pos);
    float dens = f.z;
    vec2 avgVel = f.xy / max(dens, 0.5);

    // density gradients: coarse for cohesion, fine for separation
    float rc = 3.0 / ${FIELD}.0, rf = 1.2 / ${FIELD}.0;
    vec2 gC = vec2(texture(uField, pos + vec2(rc, 0)).z - texture(uField, pos - vec2(rc, 0)).z,
                   texture(uField, pos + vec2(0, rc)).z - texture(uField, pos - vec2(0, rc)).z)
              / (dens + 2.0);
    vec2 gF = vec2(texture(uField, pos + vec2(rf, 0)).z - texture(uField, pos - vec2(rf, 0)).z,
                   texture(uField, pos + vec2(0, rf)).z - texture(uField, pos - vec2(0, rf)).z)
              / (dens + 2.0);

    // the mix sets the flock's mood: mids = discipline, kick = burst apart
    float wAlign = 1.8 + uMid * 4.0;
    float wCoh = 0.85 * (1.0 - uBassFast * 0.5);
    float wSep = 0.9 + uBassFast * 3.0;

    vec2 acc = (avgVel - vel) * wAlign
             + gC * wCoh
             - gF * wSep * smoothstep(1.5, 8.0, dens);

    // wandering roost keeps the flock on screen and slowly touring
    vec2 toR = uRoost - pos;
    acc += toR * (0.16 + 0.6 * smoothstep(0.22, 0.5, length(toR)));

    // hawk strike: flee hard inside its radius
    if (uPredator.z > 0.5) {
      vec2 d = pos - uPredator.xy;
      float dist = max(length(d), 1e-4);
      acc += d / dist * exp(-dist * dist * 60.0) * 5.0;
    }

    // each bird is keyed to one spectrum slice — its band agitates it
    float bandE = specLog(h.x);
    vec2 jit = hash22(gl_FragCoord.xy + fract(uTime) * 317.0) - 0.5;
    acc += jit * bandE * (0.15 + uTreble * 0.9);

    vel += acc * uDt;

    // starlings never hover: clamp speed into a flying band
    float spd = max(length(vel), 1e-5);
    float vmax = 0.13 + uBass * 0.05 + uBeat * 0.03;
    vel *= clamp(spd, 0.055, vmax) / spd;

    pos += vel * vec2(1.0 / uAspect, 1.0) * uDt;
    pos = clamp(pos, -0.02, 1.02);
    fragColor = vec4(pos, vel);
  }`;

  const SKY_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform vec2 uRes;
  uniform float uKeyHue;
  float fbm3(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + 13.7; a *= 0.5; }
    return v;
  }
  void main() {
    float y = vUV.y;
    vec3 warm = pal(uKeyHue + 0.04, vec3(0.42), vec3(0.32), vec3(1.0), vec3(0.0, 0.33, 0.67))
                * (0.55 + uLevel * 0.30);
    vec3 deep = pal(uKeyHue + 0.58, vec3(0.16), vec3(0.12), vec3(1.0), vec3(0.0, 0.33, 0.67))
                * 0.55;
    vec3 sky = mix(warm, deep, pow(y, 0.65));

    // low sun, sunk to the horizon
    vec2 sunP = vec2(0.5 + sin(uPhaseLevel * 0.05) * 0.22, 0.10);
    vec2 d = (vUV - sunP) * vec2(uRes.x / uRes.y, 1.0);
    float dd = dot(d, d);
    sky += vec3(1.0, 0.75, 0.55) * (exp(-dd * 180.0) * (0.9 + uBeat * 0.35)
                                    + exp(-dd * 14.0) * 0.22);

    // thin stratus bands near the horizon
    float cl = fbm3(vec2(vUV.x * 3.0 + uPhaseLevel * 0.01, y * 14.0));
    sky *= 1.0 - smoothstep(0.45, 0.8, cl) * 0.18 * (1.0 - y);

    // first stars up top
    float st = step(0.9975, hash12(floor(vUV * uRes / 3.0)));
    sky += vec3(st) * smoothstep(0.55, 0.95, y) * 0.25;

    float v = length(vUV - 0.5);
    sky *= 1.0 - v * v * 0.55;
    fragColor = vec4(aces(sky), 1.0);
  }`;

  const DRAW_VERT = `#version 300 es
  precision highp float;
  uniform sampler2D uAgents;
  uniform int uDim;
  uniform float uTime, uPointScale;
  out float vAlpha;
  out vec3 vColor;
  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }
  void main() {
    ivec2 tc = ivec2(gl_VertexID % uDim, gl_VertexID / uDim);
    vec4 a = texelFetch(uAgents, tc, 0);
    vec2 h = hash22(vec2(tc) * 1.7 + 3.1);
    float depth = h.x; // pseudo-depth: distant birds smaller + hazier
    // wing-beat flicker
    float wing = 0.78 + 0.32 * sin(uTime * (7.0 + h.y * 6.0) + h.y * 40.0);
    gl_Position = vec4(a.xy * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = mix(1.2, 2.8, depth) * wing * uPointScale;
    vAlpha = mix(0.45, 0.95, depth);
    // silhouettes, faintly lifted by atmospheric haze when "far"
    vColor = mix(vec3(0.16, 0.13, 0.20), vec3(0.015, 0.015, 0.035), depth);
  }`;
  const DRAW_FRAG = `#version 300 es
  precision highp float;
  in float vAlpha;
  in vec3 vColor;
  out vec4 fragColor;
  void main() {
    float a = smoothstep(0.5, 0.18, length(gl_PointCoord - 0.5)) * vAlpha;
    fragColor = vec4(vColor, a);
  }`;

  M.registerScene({
    name: 'murmuration · dusk flock',
    modes: ['music', 'ambient'],
    create(glc) {
      const gl = glc.gl;
      const agents = glc.pingpong(DIM, DIM, { nearest: true });
      const field = glc.target(FIELD, FIELD);
      const pInit = glc.program(INIT_FRAG);
      const pField = glc.program(FIELD_FRAG, FIELD_VERT);
      const pUpdate = glc.program(UPDATE_FRAG);
      const pSky = glc.program(SKY_FRAG);
      const pDraw = glc.program(DRAW_FRAG, DRAW_VERT);
      const vao = gl.createVertexArray();
      let keyHue = 0.08;
      const pred = { x: 0, y: 0, vx: 0, vy: 0, t: 0 };

      pInit.use().f('uSeed', Math.random() * 100);
      glc.draw(pInit, agents.read);

      return {
        resize() {},
        update(dt, audio, t) {
          const f = audio.f;
          keyHue = M.chromaHue(f.chroma, keyHue, dt);

          // hawk: onsets launch a strike across the flock
          pred.t -= dt;
          if (f.onset === 1 && pred.t < -1.2) {
            const ang = Math.random() * Math.PI * 2;
            pred.x = 0.5 + Math.cos(ang) * 0.55;
            pred.y = 0.55 + Math.sin(ang) * 0.45;
            const aim = Math.atan2(0.55 - pred.y + (Math.random() - 0.5) * 0.3,
                                   0.5 - pred.x + (Math.random() - 0.5) * 0.3);
            const spd = 0.55 + Math.random() * 0.25;
            pred.vx = Math.cos(aim) * spd;
            pred.vy = Math.sin(aim) * spd;
            pred.t = 1.4;
          }
          if (pred.t > 0) { pred.x += pred.vx * dt; pred.y += pred.vy * dt; }

          // 1. splat the flock into the neighborhood field
          field.clear();
          gl.bindFramebuffer(gl.FRAMEBUFFER, field.fbo);
          gl.viewport(0, 0, field.w, field.h);
          gl.useProgram(pField.handle);
          pField._pendingTex.length = 0;
          pField.i('uDim', DIM).tex('uAgents', agents.read.tex, 0);
          pField._bindPending();
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.bindVertexArray(vao);
          gl.drawArrays(gl.POINTS, 0, DIM * DIM);
          gl.disable(gl.BLEND);

          // 2. steer + advance every bird
          const roostX = 0.5 + Math.sin(f.phaseLevel * 0.11) * 0.16;
          const roostY = 0.55 + Math.sin(f.phaseLevel * 0.083 + 1.9) * 0.13;
          pUpdate.use();
          M.audioUniforms(pUpdate, audio, t);
          M.spectrumUniforms(pUpdate, audio, 2);
          pUpdate.f('uAspect', glc.width / glc.height)
                 .f('uDt', Math.min(dt, 0.033))
                 .v2('uRoost', roostX, roostY)
                 .v3('uPredator', pred.x, pred.y, pred.t > 0 ? 1 : 0)
                 .tex('uAgents', agents.read.tex, 0)
                 .tex('uField', field.tex, 1);
          glc.draw(pUpdate, agents.write);
          agents.swap();
        },
        render(out, audio, t) {
          pSky.use().v2('uRes', glc.width, glc.height).f('uKeyHue', keyHue);
          M.audioUniforms(pSky, audio, t);
          glc.draw(pSky, out);

          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, glc.width, glc.height);
          gl.useProgram(pDraw.handle);
          pDraw._pendingTex.length = 0;
          pDraw.i('uDim', DIM).f('uTime', t)
               .f('uPointScale', Math.min(window.devicePixelRatio || 1, 2))
               .tex('uAgents', agents.read.tex, 0);
          pDraw._bindPending();
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.bindVertexArray(vao);
          gl.drawArrays(gl.POINTS, 0, DIM * DIM);
          gl.disable(gl.BLEND);
        },
        dispose() {
          agents.dispose();
          field.dispose();
          gl.deleteVertexArray(vao);
        },
      };
    },
  });
})();
