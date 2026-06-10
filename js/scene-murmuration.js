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
    // scaled so a fully packed flock reads ~30, a spread one ~4 — the
    // separation ramp depends on this calibration
    float w = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * 0.125;
    fragColor = vec4(vVel * w, w, 0.0);
  }`;

  const UPDATE_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + M.GLSL_SPECTRUM + `
  uniform sampler2D uAgents, uField;
  uniform float uAspect, uDt, uImpulse;
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
    float wCoh = 1.45 * (1.0 - uBassFast * 0.4);
    float wSep = 0.9 + uBassFast * 3.0 + uBurst * 4.0;

    vec2 acc = (avgVel - vel) * wAlign
             + gC * wCoh
             - gF * wSep * smoothstep(6.0, 30.0, dens); // only when truly packed

    // wandering roost keeps the flock on screen; in a rest it reels the
    // birds into a tight, slowly coiling ball
    vec2 toR = uRoost - pos;
    acc += toR * (0.26 + 0.85 * smoothstep(0.18, 0.45, length(toR)) + uQuiet * 0.5);

    // hawk strike: flee hard inside its radius
    if (uPredator.z > 0.5) {
      vec2 d = pos - uPredator.xy;
      float dist = max(length(d), 1e-4);
      acc += d / dist * exp(-dist * dist * 60.0) * 5.0;
    }

    // each bird is keyed to one spectrum slice — its band agitates it
    float bandE = specLog(h.x);
    vec2 jit = hash22(gl_FragCoord.xy + fract(uTime) * 317.0) - 0.5;
    acc += jit * bandE * (0.15 + uTreble * 0.9) * (1.0 - uQuiet);

    vel += acc * uDt;

    // beat = a direct velocity kick outward, not a force: the whole cloud
    // visibly pops apart and re-coheres in rhythm (forces are too slow —
    // the flock low-passes them into invisibility)
    vec2 fromR = pos - uRoost;
    vel += fromR / max(length(fromR), 0.05) * uImpulse;

    // starlings never hover: loudness sets the tempo of flight
    float spd = max(length(vel), 1e-5);
    float vmax = (0.085 + uLevel * 0.16 + uBeat * 0.04) * (1.0 - uQuiet * 0.45);
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

    // low setting sun: warm core, amber halo, beat pulse
    vec2 sunP = vec2(0.5 + sin(uPhaseLevel * 0.05) * 0.22, 0.115);
    vec2 d = (vUV - sunP) * vec2(uRes.x / uRes.y, 1.35);
    float dd = dot(d, d);
    vec3 sunCol = mix(vec3(1.0, 0.45, 0.22), vec3(1.0, 0.88, 0.62), exp(-dd * 500.0));
    sky += sunCol * (exp(-dd * 300.0) * (1.0 + uBeat * 0.35)
                     + exp(-dd * 22.0) * 0.30 + exp(-dd * 5.0) * 0.10);

    // thin stratus bands near the horizon, warmed near the sun
    float cl = smoothstep(0.45, 0.8, fbm3(vec2(vUV.x * 3.0 + uPhaseLevel * 0.01, y * 14.0)));
    sky *= 1.0 - cl * 0.18 * (1.0 - y);
    sky += sunCol * cl * exp(-dd * 8.0) * 0.10;

    // twinkling stars, drifting almost imperceptibly with the music's time
    vec2 sp = (vUV + vec2(uPhaseLevel * 0.0015, 0.0)) * uRes / 4.0;
    float sh = hash12(floor(sp));
    float th = hash12(floor(sp) + 17.31); // independent twinkle hash
    float tw = 0.6 + 0.4 * sin(uTime * (0.8 + th * 4.0) + th * 40.0);
    float star = step(0.9965, sh)
               * smoothstep(0.5, 0.1, length(fract(sp) - 0.5)) * tw;
    sky += vec3(0.85, 0.9, 1.0) * star * smoothstep(0.45, 0.85, y)
           * (0.45 + uTreble * 0.35);

    // dark treeline anchoring the horizon, rim-lit toward the sun
    float ridge = 0.105 + 0.04 * fbm3(vec2(vUV.x * 5.5, 0.7));
    float ground = smoothstep(ridge + 0.006, ridge - 0.006, y);
    vec3 groundCol = vec3(0.012, 0.014, 0.022)
                   + sunCol * exp(-abs(vUV.x - sunP.x) * 4.0) * 0.05;
    sky = mix(sky, groundCol, ground);

    float v = length(vUV - 0.5);
    sky *= 1.0 - v * v * 0.55;
    // dither kills 8-bit gradient banding
    sky += (hash12(vUV * uRes) - 0.5) / 128.0;
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
    gl_PointSize = mix(1.8, 3.8, depth) * wing * uPointScale;
    vAlpha = mix(0.65, 1.0, depth);
    // silhouettes, faintly lifted by atmospheric haze when "far"
    vColor = mix(vec3(0.20, 0.17, 0.26), vec3(0.010, 0.012, 0.028), depth);
  }`;
  const DRAW_FRAG = `#version 300 es
  precision highp float;
  in float vAlpha;
  in vec3 vColor;
  out vec4 fragColor;
  void main() {
    float a = smoothstep(0.5, 0.22, length(gl_PointCoord - 0.5)) * vAlpha;
    fragColor = vec4(vColor, a);
  }`;

  // the hawk: one big point sprite carrying a procedural raptor silhouette
  const HAWK_VERT = `#version 300 es
  precision highp float;
  uniform vec2 uPos;
  uniform float uSize;
  void main() {
    gl_Position = vec4(uPos * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = uSize;
  }`;
  const HAWK_FRAG = `#version 300 es
  precision highp float;
  uniform float uAngle, uTime, uFlapHz, uFlapAmp, uAlpha, uGlow;
  uniform vec3 uRimCol;
  out vec4 fragColor;
  float sdSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  void main() {
    vec2 q = (gl_PointCoord - 0.5) * 2.0;
    q.y = -q.y; // point-coord y runs downward
    float cs = cos(uAngle), sn = sin(uAngle);
    q = mat2(cs, sn, -sn, cs) * q; // into hawk frame, +x = travel
    // beating swept wings + body + fork tail; the kick powers the stroke
    float flap = sin(uTime * uFlapHz);
    float span = 0.42 + uFlapAmp * flap;
    float wing1 = sdSeg(q, vec2(0.12, 0.0), vec2(-0.38,  span)) - 0.050;
    float wing2 = sdSeg(q, vec2(0.12, 0.0), vec2(-0.38, -span)) - 0.050;
    float body = sdSeg(q, vec2(0.52, 0.0), vec2(-0.30, 0.0)) - 0.070;
    float tail = sdSeg(q, vec2(-0.28, 0.0), vec2(-0.52, 0.10 * flap)) - 0.040;
    float d = min(min(wing1, wing2), min(body, tail));
    // dark raptor core with a burning sun-lit rim
    float core = smoothstep(0.025, -0.025, d);
    float rim = smoothstep(0.11, 0.0, abs(d)) * (1.0 - core * 0.5);
    vec3 col = mix(vec3(0.012, 0.010, 0.022), uRimCol * (0.8 + uGlow), rim);
    float a = max(core, rim * 0.85) * uAlpha;
    fragColor = vec4(col, a);
  }`;

  // glowing wake the hawk drags behind it
  const TRAIL_FRAG = `#version 300 es
  precision highp float;
  uniform vec3 uCol;
  uniform float uA;
  out vec4 fragColor;
  void main() {
    float fall = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
    fragColor = vec4(uCol * fall * fall * uA, 1.0);
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
      const pHawk = glc.program(HAWK_FRAG, HAWK_VERT);
      const pTrail = glc.program(TRAIL_FRAG, HAWK_VERT);
      const trail = []; // fading wake samples
      let trailTimer = 0;
      const vao = gl.createVertexArray();
      let keyHue = 0.08;
      const pred = { x: 0, y: 0, vx: 0, vy: 0, t: 0 };
      // the roost leaps to a new spot on musical events; the flock chases it
      const roost = { x: 0.5, y: 0.55, tx: 0.5, ty: 0.55, side: 1 };
      let leapBeats = 0, leapLatch = 0;

      pInit.use().f('uSeed', Math.random() * 100);
      glc.draw(pInit, agents.read);

      return {
        resize() {},
        update(dt, audio, t) {
          const f = audio.f;
          keyHue = M.chromaHue(f.chroma, keyHue, dt);

          // hawk: occasional strikes, not every onset — scatters must stay
          // the exception or the flock never re-forms
          pred.t -= dt;
          if (f.onset === 1 && pred.t < -3.5) {
            const ang = Math.random() * Math.PI * 2;
            pred.x = 0.5 + Math.cos(ang) * 0.55;
            pred.y = 0.55 + Math.sin(ang) * 0.45;
            const aim = Math.atan2(0.55 - pred.y + (Math.random() - 0.5) * 0.3,
                                   0.5 - pred.x + (Math.random() - 0.5) * 0.3);
            const spd = 0.55 + Math.random() * 0.25;
            pred.vx = Math.cos(aim) * spd;
            pred.vy = Math.sin(aim) * spd;
            pred.t = 1.8;
          }

          // roost leaps every 2 beats (alternating sides of the sky), so the
          // flock swoops in rhythm — bright music flies high, dark flies low
          leapLatch -= dt;
          if (f.beat > 0.9 && leapLatch <= 0) {
            leapLatch = 0.25;
            if (++leapBeats >= 2) {
              leapBeats = 0;
              roost.side = -roost.side;
              roost.tx = 0.5 + roost.side * (0.13 + Math.random() * 0.13 + f.level * 0.06);
              roost.ty = 0.32 + f.centroid * 0.35 + Math.random() * 0.12;
            }
          }
          // gentle ambient wander when there is no beat to chase
          if (f.beatConf < 0.15) {
            roost.tx = 0.5 + Math.sin(f.phaseLevel * 0.11) * 0.16;
            roost.ty = 0.55 + Math.sin(f.phaseLevel * 0.083 + 1.9) * 0.13;
          }
          const rk = 1 - Math.exp(-dt * 1.6);
          roost.x += (roost.tx - roost.x) * rk;
          roost.y += (roost.ty - roost.y) * rk;
          const roostX0 = roost.x, roostY0 = roost.y;
          if (pred.t > 0) {
            // banked pursuit: curve toward the flock, dive speed on loudness
            const ax = roostX0 - pred.x, ay = roostY0 - pred.y;
            const al = Math.hypot(ax, ay) + 1e-4;
            pred.vx += (ax / al) * dt * 0.45;
            pred.vy += (ay / al) * dt * 0.45;
            const sp = Math.hypot(pred.vx, pred.vy) + 1e-4;
            const want = 0.50 + 0.40 * f.level;
            pred.vx *= want / sp; pred.vy *= want / sp;
            pred.x += pred.vx * dt; pred.y += pred.vy * dt;
            trailTimer += dt;
            if (trailTimer > 0.03) {
              trailTimer = 0;
              trail.push({ x: pred.x, y: pred.y, life: 1 });
              if (trail.length > 16) trail.shift();
            }
          }
          for (let i = trail.length - 1; i >= 0; i--) {
            trail[i].life -= dt * 1.8;
            if (trail[i].life <= 0) trail.splice(i, 1);
          }

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
          const roostX = roostX0, roostY = roostY0;
          pUpdate.use();
          M.audioUniforms(pUpdate, audio, t);
          M.spectrumUniforms(pUpdate, audio, 2);
          // one-frame velocity kick on the beat's rising edge only
          const beatNow = f.beat > 0.9;
          const impulse = beatNow && !this._beatHeld ? 0.030 + f.bass * 0.035 : 0;
          this._beatHeld = beatNow;

          pUpdate.f('uAspect', glc.width / glc.height)
                 .f('uDt', Math.min(dt, 0.033))
                 .f('uImpulse', impulse)
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

          // the hawk's glowing wake (additive), intensity riding the level
          const f = audio.f;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const ember = [1.0, 0.55, 0.28];
          if (trail.length) {
            gl.blendFunc(gl.ONE, gl.ONE);
            gl.useProgram(pTrail.handle);
            pTrail._pendingTex.length = 0;
            for (const s of trail) {
              pTrail.v2('uPos', s.x, s.y)
                    .f('uSize', (4 + s.life * 12) * dpr)
                    .v3('uCol', ember[0], ember[1], ember[2])
                    .f('uA', s.life * s.life * (0.10 + f.level * 0.30 + f.beat * 0.20));
              pTrail._bindPending();
              gl.drawArrays(gl.POINTS, 0, 1);
            }
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          }

          // the hawk itself: kick powers the wing stroke, beats flare the rim
          if (pred.t > 0) {
            const age = 1.8 - pred.t;
            const alpha = Math.min(1, age / 0.15) * Math.min(1, pred.t / 0.3);
            const aspect = glc.width / glc.height;
            gl.useProgram(pHawk.handle);
            pHawk._pendingTex.length = 0;
            pHawk.v2('uPos', pred.x, pred.y)
                 .f('uSize', (30 + f.bassFast * 14) * dpr)
                 .f('uAngle', Math.atan2(pred.vy, pred.vx * aspect))
                 .f('uTime', t)
                 .f('uFlapHz', 8 + f.treble * 10)
                 .f('uFlapAmp', 0.18 + f.bassFast * 0.34 + f.level * 0.10)
                 .f('uGlow', f.beat * 1.4 + f.onset * 0.6)
                 .v3('uRimCol', ember[0], ember[1], ember[2])
                 .f('uAlpha', alpha * 0.95);
            pHawk._bindPending();
            gl.drawArrays(gl.POINTS, 0, 1);
          }
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
