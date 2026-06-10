/* ORPHIC — shared scene helpers: audio uniforms + common GLSL chunks */
(function () {
  'use strict';
  const M = window.ORPHIC = window.ORPHIC || {};

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
        .f('uPhaseTreble', f.phaseTreble)
        .f('uHarmonic', f.harmonic).f('uPercussive', f.percussive)
        .f('uQuiet', f.quiet).f('uBurst', f.burst);
    return prog;
  };

  /** Bind the per-frequency textures + chroma (pairs with GLSL_SPECTRUM).
   *  Uses texture units unit0..unit0+2; call after prog.use(). */
  M.spectrumUniforms = function (prog, audio, unit0) {
    const tex = audio.tex;
    if (!tex) return prog;
    prog.tex('uSpectrum', tex.spectrum, unit0)
        .tex('uWaveform', tex.waveform, unit0 + 1)
        .tex('uSpectrogram', tex.spectrogram, unit0 + 2)
        .f('uBinLo', tex.binLo).f('uBinHi', tex.binHi)
        .fv('uChroma', audio.f.chroma);
    return prog;
  };

  /** GLSL: per-frequency audio access (pairs with spectrumUniforms()).
   *  spec(x)    linear-frequency magnitude, x 0..1 over 30 Hz..16 kHz
   *  specLog(x) log-frequency magnitude — equal screen space per octave
   *  wave(x)    time-domain waveform sample, -1..1
   *  uSpectrogram r: log-freq history (newest row at y=1), g: linear, b: peak-decay
   */
  M.GLSL_SPECTRUM = `
  uniform sampler2D uSpectrum, uWaveform, uSpectrogram;
  uniform float uBinLo, uBinHi;
  uniform float uChroma[12];
  float spec(float x) {
    return texture(uSpectrum, vec2(mix(uBinLo, uBinHi, clamp(x, 0.0, 1.0)), 0.5)).r;
  }
  float specLog(float x) {
    float f = exp(mix(log(uBinLo), log(uBinHi), clamp(x, 0.0, 1.0)));
    return texture(uSpectrum, vec2(f, 0.5)).r;
  }
  float wave(float x) {
    return texture(uWaveform, vec2(clamp(x, 0.0, 1.0), 0.5)).r * 2.0 - 1.0;
  }
  `;

  /** GLSL: soft round ember/star field — drifting, twinkling motes. Lifted
   *  from the old voice scene; reused as a living backdrop. Needs GLSL_LIB
   *  (hash22) + GLSL_AUDIO (uTime). Call embers(uv, aspect, scale, drift,
   *  density, seed): drift>0 makes cells rise; density is the fill fraction. */
  M.GLSL_EMBERS = `
  float embers(vec2 uv, float aspect, float scale, float drift, float density, float seed) {
    vec2 g = (uv * vec2(aspect, 1.0) + vec2(0.0, -uTime * drift)) * scale;
    vec2 id = floor(g);
    float acc = 0.0;
    for (int oy = -1; oy <= 1; oy++)
    for (int ox = -1; ox <= 1; ox++) {
      vec2 cid = id + vec2(ox, oy);
      vec2 h = hash22(cid + seed);
      if (h.x > density) continue;
      vec2 p = cid + 0.5 + (h - 0.5) * 0.8;
      float d = length(g - p);
      float tw = 0.55 + 0.45 * sin(uTime * (2.0 + h.y * 4.0) + h.x * 40.0);
      acc += exp(-d * d * 9.0) * tw;
    }
    return acc;
  }
  `;

  /** Circular-mean hue of the chroma profile on the circle of fifths
   *  (consonant chords land near one hue). Returns prev smoothed toward the
   *  current key along the shortest arc; feed back each frame. */
  M.chromaHue = function (chroma, prev, dt) {
    let sx = 0, sy = 0;
    for (let p = 0; p < 12; p++) {
      const a = ((p * 7) % 12) / 12 * 2 * Math.PI;
      sx += chroma[p] * Math.cos(a); sy += chroma[p] * Math.sin(a);
    }
    let target = Math.atan2(sy, sx) / (2 * Math.PI);
    if (target < 0) target += 1;
    let d = target - prev;
    if (d > 0.5) d -= 1; else if (d < -0.5) d += 1;
    return (prev + d * (1 - Math.exp(-dt / 1.5)) + 1) % 1;
  };

  /** Adaptive internal resolution for raymarched scenes. Call update(dt)
   *  every frame; when it returns true, `scale` changed and the scene should
   *  recreate its render target. Drops fast when the frame rate sags, climbs
   *  back only after sustained headroom — weak GPUs degrade resolution
   *  instead of stuttering. */
  M.adaptiveRes = function (max, min) {
    return {
      scale: max,
      _t: 0, _n: 0, _good: 0,
      update(dt) {
        this._t += dt; this._n++;
        if (this._t < 1.0) return false;
        const fps = this._n / this._t;
        this._t = 0; this._n = 0;
        if (fps < 50 && this.scale > min) {
          this._good = 0;
          this.scale = Math.max(min, this.scale - 0.12);
          return true;
        }
        if (fps > 58 && this.scale < max) {
          if (++this._good >= 3) { // 3 s of headroom before climbing
            this._good = 0;
            this.scale = Math.min(max, this.scale + 0.06);
            return true;
          }
        } else {
          this._good = 0;
        }
        return false;
      },
    };
  };

  /** GLSL: uniform declarations matching audioUniforms(). */
  M.GLSL_AUDIO = `
  uniform float uTime, uBass, uBassFast, uMid, uTreble, uLevel;
  uniform float uOnset, uBeat, uBeatPhase, uCentroid, uFlux;
  uniform float uPitch, uVoiced, uSpeech;
  uniform float uPhaseLevel, uPhaseBass, uPhaseTreble;
  uniform float uHarmonic, uPercussive, uQuiet, uBurst;
  `;

  /** GLSL: IQ cosine palette + hsv + tonemap (vertex- and fragment-safe). */
  M.GLSL_COLOR = `
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
  `;

  /** GLSL: hash/noise utilities (vertex- and fragment-safe). */
  M.GLSL_NOISE = `
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

  /** GLSL: full utility set — palette/tonemap + hash/noise. */
  M.GLSL_LIB = M.GLSL_COLOR + M.GLSL_NOISE;

  M.FRAG_HEADER = `#version 300 es
  precision highp float;
  in vec2 vUV;
  out vec4 fragColor;
  `;
})();
