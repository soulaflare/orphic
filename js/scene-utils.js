/* MYTHOS — shared scene helpers: audio uniforms + common GLSL chunks */
(function () {
  'use strict';
  const M = window.MYTHOS = window.MYTHOS || {};

  /** Scene registry — scene files self-register, main.js consumes. */
  M.scenes = M.scenes || [];
  M.registerScene = function (def) { M.scenes.push(def); };

  /** Set the standard audio uniform block on a program (call after prog.use()). */
  M.audioUniforms = function (prog, audio, t) {
    const f = audio.f;
    prog.f('uTime', t)
        .f('uBass', f.bass).f('uBassFast', f.bassFast)
        .f('uMid', f.mid).f('uTreble', f.treble)
        .f('uLevel', f.level)
        .f('uOnset', f.onset).f('uBeat', f.beat)
        .f('uBeatPhase', f.beatPhase)
        .f('uCentroid', f.centroid).f('uFlux', f.flux)
        .f('uPitch', f.pitchNorm).f('uVoiced', f.voiced)
        .f('uSpeech', audio.c.speechProb)
        .f('uPhaseLevel', f.phaseLevel).f('uPhaseBass', f.phaseBass)
        .f('uPhaseTreble', f.phaseTreble);
    return prog;
  };

  /** GLSL: uniform declarations matching audioUniforms(). */
  M.GLSL_AUDIO = `
  uniform float uTime, uBass, uBassFast, uMid, uTreble, uLevel;
  uniform float uOnset, uBeat, uBeatPhase, uCentroid, uFlux;
  uniform float uPitch, uVoiced, uSpeech;
  uniform float uPhaseLevel, uPhaseBass, uPhaseTreble;
  `;

  /** GLSL: IQ cosine palette + hsv + tonemap + hash/noise utilities. */
  M.GLSL_LIB = `
  vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.28318 * (c * t + d));
  }
  vec3 hsv(float h, float s, float v) {
    vec3 k = abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0;
    return v * mix(vec3(1.0), clamp(k, 0.0, 1.0), s);
  }
  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
               mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 13.7; a *= 0.5; }
    return v;
  }
  `;

  M.FRAG_HEADER = `#version 300 es
  precision highp float;
  in vec2 vUV;
  out vec4 fragColor;
  `;
})();
