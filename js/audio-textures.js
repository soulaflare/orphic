/* ORPHIC — per-frequency audio data on the GPU
 * Uploads the raw FFT spectrum and waveform as 1D textures every frame and
 * maintains a scrolling spectrogram history target, so scenes can react to
 * individual frequencies (not just the bass/mid/treble scalars):
 *   uSpectrum    2048×1 R8   — raw byte FFT, x = linear frequency 0..nyquist
 *   uWaveform    2048×1 R8   — time-domain wave, 0.5 = silence
 *   uSpectrogram 512×256     — r: log-frequency magnitude (newest row at top),
 *                              g: linear-frequency magnitude, b: peak-decay
 * Shared GLSL accessors live in scene-utils.js (M.GLSL_SPECTRUM).
 */
(function () {
  'use strict';
  const M = window.ORPHIC = window.ORPHIC || {};

  const SPEC_W = 2048;   // analyser bins at fftSize 4096
  const WAVE_W = 2048;   // waveform samples uploaded (timeData downsampled ×2)
  const SG_W = 512, SG_H = 256; // spectrogram history (~4.3 s at 60 fps)

  const SCROLL_FRAG = M.FRAG_HEADER + `
  uniform sampler2D uPrev, uSpec;
  uniform float uTexel;        // 1 / history rows
  uniform float uBinLo, uBinHi; // normalized spectrum coords of 30 Hz / 16 kHz
  void main() {
    if (vUV.y > 1.0 - uTexel) {
      // newest row: resample the spectrum on a log-frequency axis
      float fLog = exp(mix(log(uBinLo), log(uBinHi), vUV.x));
      float mLog = texture(uSpec, vec2(fLog, 0.5)).r;
      float mLin = texture(uSpec, vec2(mix(uBinLo, uBinHi, vUV.x), 0.5)).r;
      float prevPeak = texture(uPrev, vec2(vUV.x, 1.0 - uTexel * 0.5)).b;
      float peak = max(mLog, prevPeak * 0.96); // slow-falling peak envelope
      fragColor = vec4(mLog, mLin, peak, 1.0);
    } else {
      fragColor = texture(uPrev, vUV + vec2(0.0, uTexel)); // scroll down
    }
  }`;

  class AudioTextures {
    constructor(glc, engine) {
      this.glc = glc;
      this.engine = engine;
      const gl = glc.gl;

      this.spectrum = this._tex1d(SPEC_W);
      this.waveform = this._tex1d(WAVE_W);
      this._waveBytes = new Uint8Array(WAVE_W);

      this.sg = glc.pingpong(SG_W, SG_H);
      this.sg.a.clear(); this.sg.b.clear();
      this._scroll = glc.program(SCROLL_FRAG);
      this._gl = gl;
    }

    _tex1d(w) {
      const gl = this.glc.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, 1, 0, gl.RED, gl.UNSIGNED_BYTE,
                    new Uint8Array(w));
      return t;
    }

    /** Normalized spectrum-texture x coords of the audible window. */
    get binLo() { return 30 / this._nyquist(); }
    get binHi() { return Math.min(0.999, 16000 / this._nyquist()); }
    _nyquist() {
      const e = this.engine;
      return (e.binHz ? e.binHz * e.freqData.length : 22050) || 22050;
    }

    /** Call once per frame after features.update(). */
    update() {
      const gl = this._gl;
      const eng = this.engine;

      gl.bindTexture(gl.TEXTURE_2D, this.spectrum);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, Math.min(SPEC_W, eng.freqData.length), 1,
                       gl.RED, gl.UNSIGNED_BYTE, eng.freqData);

      const wave = eng.timeData, wb = this._waveBytes;
      const step = Math.max(1, Math.floor(wave.length / WAVE_W));
      for (let i = 0; i < WAVE_W; i++) {
        const v = wave[Math.min(wave.length - 1, i * step)];
        wb[i] = Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
      }
      gl.bindTexture(gl.TEXTURE_2D, this.waveform);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WAVE_W, 1, gl.RED, gl.UNSIGNED_BYTE, wb);

      this._scroll.use()
        .f('uTexel', 1 / SG_H)
        .f('uBinLo', this.binLo).f('uBinHi', this.binHi)
        .tex('uPrev', this.sg.read.tex, 0)
        .tex('uSpec', this.spectrum, 1);
      this.glc.draw(this._scroll, this.sg.write);
      this.sg.swap();
    }

    get spectrogram() { return this.sg.read.tex; }

    dispose() {
      const gl = this._gl;
      gl.deleteTexture(this.spectrum);
      gl.deleteTexture(this.waveform);
      this.sg.dispose();
    }
  }

  M.AudioTextures = AudioTextures;
})();
