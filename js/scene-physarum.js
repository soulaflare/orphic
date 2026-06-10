/* ORPHIC scene — PHYSARUM · living network
 * Jeff Jones (2010) slime-mold transport-network model, GPU edition.
 * 262k agents in a float texture; three competing species deposit into
 * R/G/B trail channels and prefer their own pheromone, weaving interlocked
 * vascular webs. Audio: bass drives agent speed, spectral centroid widens
 * the sensor fan (more branching), onsets scatter headings, beats pull the
 * swarm toward the centre.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const DIM = 512; // DIM*DIM agents

  const INIT_FRAG = M.FRAG_HEADER + M.GLSL_LIB + `
  uniform float uSeed;
  void main() {
    vec2 h = hash22(gl_FragCoord.xy + uSeed);
    vec2 h2 = hash22(gl_FragCoord.yx * 1.7 + uSeed + 31.0);
    // ring spawn for a dramatic opening bloom
    float ang = h.x * 6.28318;
    float rad = 0.22 + 0.18 * h.y;
    vec2 pos = vec2(0.5) + vec2(cos(ang), sin(ang)) * rad;
    float heading = ang + 3.14159 * (h2.x > 0.5 ? 0.45 : -0.45);
    float species = floor(h2.y * 3.0);
    fragColor = vec4(pos, heading, species);
  }`;

  const UPDATE_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uAgents;
  uniform sampler2D uTrail;
  uniform float uAspect, uDt;
  void main() {
    vec4 a = texelFetch(uAgents, ivec2(gl_FragCoord.xy), 0);
    vec2 pos = a.xy;
    float heading = a.z;
    float species = a.w;

    vec3 mask = species < 0.5 ? vec3(1, 0, 0) : species < 1.5 ? vec3(0, 1, 0) : vec3(0, 0, 1);

    // audio-modulated Jones parameters
    float sa = 0.30 + uCentroid * 0.55 + uSpeech * 0.25;   // sensor angle (rad)
    float sd = (0.006 + uMid * 0.012);                      // sensor distance (uv)
    float turn = 0.22 + uFlux * 2.2;                        // turn rate (rad/step)
    float speed = (0.0022 + uBassFast * 0.0035 + uLevel * 0.0010);

    vec2 sscale = vec2(1.0 / uAspect, 1.0);
    vec2 dirF = vec2(cos(heading), sin(heading));
    vec2 dirL = vec2(cos(heading + sa), sin(heading + sa));
    vec2 dirR = vec2(cos(heading - sa), sin(heading - sa));

    #define SENSE(d) (dot(texture(uTrail, pos + (d) * sd * sscale).rgb * 2.0, mask) - dot(texture(uTrail, pos + (d) * sd * sscale).rgb, vec3(0.6)))
    float F  = SENSE(dirF);
    float FL = SENSE(dirL);
    float FR = SENSE(dirR);

    vec2 rnd = hash22(gl_FragCoord.xy + fract(uTime) * 1117.0);
    if (F > FL && F > FR) {
      // keep heading
    } else if (F < FL && F < FR) {
      heading += (rnd.x - 0.5) * 2.0 * turn;
    } else if (FL > FR) {
      heading += turn;
    } else if (FR > FL) {
      heading -= turn;
    }
    // gentle wander
    heading += (rnd.y - 0.5) * 0.15;

    // onsets: a fraction of agents scatter explosively
    if (uOnset > 0.85 && rnd.x < 0.10 + uOnset * 0.08) {
      heading += (rnd.y - 0.5) * 6.28318;
    }
    // beats: pull toward centre — the web breathes with the kick
    if (uBeat > 0.05) {
      vec2 toC = vec2(0.5) - pos;
      float want = atan(toC.y, toC.x);
      float d = mod(want - heading + 3.14159, 6.28318) - 3.14159;
      heading += d * uBeat * 0.09;
    }

    pos += vec2(cos(heading), sin(heading)) * speed * sscale * (uDt * 60.0);
    pos = fract(pos);

    fragColor = vec4(pos, heading, species);
  }`;

  const DEPOSIT_VERT = `#version 300 es
  precision highp float;
  uniform sampler2D uAgents;
  uniform int uDim;
  flat out float vSpecies;
  void main() {
    ivec2 tc = ivec2(gl_VertexID % uDim, gl_VertexID / uDim);
    vec4 a = texelFetch(uAgents, tc, 0);
    vSpecies = a.w;
    gl_Position = vec4(a.xy * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 1.0;
  }`;

  const DEPOSIT_FRAG = `#version 300 es
  precision highp float;
  flat in float vSpecies;
  out vec4 fragColor;
  uniform float uDeposit;
  void main() {
    vec3 c = vSpecies < 0.5 ? vec3(1, 0, 0) : vSpecies < 1.5 ? vec3(0, 1, 0) : vec3(0, 0, 1);
    fragColor = vec4(c * uDeposit, 0.0);
  }`;

  const DIFFUSE_FRAG = M.FRAG_HEADER + `
  uniform sampler2D uTrail;
  uniform vec2 uTexel;
  uniform float uDecay;
  void main() {
    vec3 sum = vec3(0.0);
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++)
        sum += texture(uTrail, vUV + vec2(x, y) * uTexel).rgb;
    fragColor = vec4(sum / 9.0 * uDecay, 1.0);
  }`;

  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uTrail;
  void main() {
    vec3 t = texture(uTrail, vUV).rgb;
    t = t / (1.0 + t * 0.6); // soft-knee: dense cores compress instead of clipping
    float hueShift = uCentroid * 0.25 + uTime * 0.008;
    vec3 cR = pal(0.00 + hueShift, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.00, 0.33, 0.67));
    vec3 cG = pal(0.35 + hueShift, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.00, 0.33, 0.67));
    vec3 cB = pal(0.70 + hueShift, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.00, 0.33, 0.67));
    vec3 col = cR * pow(t.r, 1.25) + cG * pow(t.g, 1.25) + cB * pow(t.b, 1.25);
    col *= 0.8 + uLevel * 0.7;
    // soft bloom from the dense cores
    float core = max(max(t.r, t.g), t.b);
    col += vec3(1.0, 0.95, 0.9) * smoothstep(1.2, 2.4, core) * 0.3;
    // vignette
    float d = length(vUV - 0.5);
    col *= 1.0 - d * d * 0.9;
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'physarum · living network',
    modes: ['music', 'speech', 'ambient'],
    create(glc) {
      const gl = glc.gl;
      const agents = glc.pingpong(DIM, DIM, { nearest: true });
      let trail = null;
      const pInit = glc.program(INIT_FRAG);
      const pUpdate = glc.program(UPDATE_FRAG);
      const pDeposit = glc.program(DEPOSIT_FRAG, DEPOSIT_VERT);
      const pDiffuse = glc.program(DIFFUSE_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const depositVAO = gl.createVertexArray();
      let seeded = false;

      function seed() {
        pInit.use().f('uSeed', Math.random() * 100);
        glc.draw(pInit, agents.read);
        seeded = true;
      }

      return {
        resize(w, h) {
          const tw = Math.max(2, Math.round(w / 2)), th = Math.max(2, Math.round(h / 2));
          if (!trail) trail = glc.pingpong(tw, th, { repeat: true });
          else { trail.a.resize(tw, th); trail.b.resize(tw, th); }
          trail.a.clear(); trail.b.clear();
          if (!seeded) seed();
        },
        update(dt, audio, t) {
          if (!trail) return;
          const aspect = trail.read.w / trail.read.h;

          // 1. agents sense + move
          pUpdate.use();
          M.audioUniforms(pUpdate, audio, t);
          pUpdate.f('uAspect', aspect).f('uDt', dt)
                 .tex('uAgents', agents.read.tex, 0)
                 .tex('uTrail', trail.read.tex, 1);
          glc.draw(pUpdate, agents.write);
          agents.swap();

          // 2. deposit pheromone (additive points into current trail)
          gl.bindFramebuffer(gl.FRAMEBUFFER, trail.read.fbo);
          gl.viewport(0, 0, trail.read.w, trail.read.h);
          gl.useProgram(pDeposit.handle);
          pDeposit._pendingTex.length = 0;
          pDeposit.i('uDim', DIM)
                  .f('uDeposit', 0.020 + audio.f.level * 0.035)
                  .tex('uAgents', agents.read.tex, 0);
          pDeposit._bindPending();
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.bindVertexArray(depositVAO);
          gl.drawArrays(gl.POINTS, 0, DIM * DIM);
          gl.disable(gl.BLEND);

          // 3. diffuse + decay
          pDiffuse.use()
            .v2('uTexel', 1 / trail.read.w, 1 / trail.read.h)
            .f('uDecay', 0.915 - audio.f.treble * 0.015)
            .tex('uTrail', trail.read.tex, 0);
          glc.draw(pDiffuse, trail.write);
          trail.swap();
        },
        render(out, audio, t) {
          if (!trail) return;
          pShow.use().tex('uTrail', trail.read.tex, 0);
          M.audioUniforms(pShow, audio, t);
          glc.draw(pShow, out);
        },
        dispose() {
          agents.dispose();
          if (trail) trail.dispose();
          gl.deleteVertexArray(depositVAO);
        },
      };
    },
  });
})();
