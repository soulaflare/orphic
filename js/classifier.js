/* ORPHIC — speech vs music classifier
 * Lightweight heuristic running on extracted features over a ~2.5s window.
 * Speech signature: energy modulation near the 3-5 Hz syllabic rate,
 * frequent voiced/unvoiced alternation, pauses, pitch in 80-400 Hz with
 * continuous glides, weak/no periodic beat.
 * Music signature: stable tempo (high beat confidence), sustained spectral
 * energy, wider bandwidth, low pause ratio.
 * Output: this.speechProb (0..1, smoothed) and this.mode ('music'|'speech'|'ambient').
 */
(function () {
  'use strict';

  const WIN = 150; // ~2.5s at 60fps

  class SpeechMusicClassifier {
    constructor(features) {
      this.f = features;
      this.speechProb = 0.0;
      this.mode = 'music';

      this._level = new Float32Array(WIN);
      this._voiced = new Float32Array(WIN);
      this._idx = 0;
      this._filled = 0;
      this._timer = 0;
      this._quietT = 0;
    }

    update(dt) {
      const f = this.f;
      this._level[this._idx] = f.rawLevel;
      this._voiced[this._idx] = f.voiced;
      this._idx = (this._idx + 1) % WIN;
      this._filled = Math.min(WIN, this._filled + 1);

      // accumulate every frame, not just on the 0.25s analysis tick
      this._quietT = f.level > 0.04 ? 0 : this._quietT + dt;

      this._timer += dt;
      if (this._timer < 0.25 || this._filled < WIN * 0.8) return;
      this._timer = 0;

      let score = 0; // positive => speech

      // 1. Syllabic-rate (3-5 Hz) energy modulation via Goertzel on level history
      const mod4 = this._goertzel(this._level, 4.0, 60);
      const mod1 = this._goertzel(this._level, 1.2, 60);
      if (mod4 > mod1 * 1.4 && mod4 > 0.004) score += 1.4;
      else if (mod4 < mod1 * 0.7) score -= 0.6;

      // 2. Pause ratio: speech alternates sound/silence
      let mean = 0;
      for (let i = 0; i < WIN; i++) mean += this._level[i];
      mean /= WIN;
      let quiet = 0;
      for (let i = 0; i < WIN; i++) if (this._level[i] < mean * 0.3) quiet++;
      const pauseRatio = quiet / WIN;
      if (pauseRatio > 0.18 && pauseRatio < 0.6) score += 0.9;
      else if (pauseRatio < 0.05) score -= 0.7;

      // 3. Voiced/unvoiced alternation count
      let flips = 0, prev = this._voiced[0] > 0.4;
      for (let i = 1; i < WIN; i++) {
        const v = this._voiced[i] > 0.4;
        if (v !== prev) flips++;
        prev = v;
      }
      if (flips >= 6) score += 0.8;
      else if (flips <= 1) score -= 0.4;

      // 4. Strong steady beat => music
      if (f.beatConf > 0.45 && f.bpm > 0) score -= 1.5;
      else if (f.beatConf < 0.15) score += 0.4;

      // 5. Pitch register: speech f0 mostly 80-400 Hz
      if (f.pitchHz > 0 && (f.pitchHz < 75 || f.pitchHz > 450)) score -= 0.5;

      // 6. Sustained wideband treble (cymbals, synth pads) => music
      if (f.treble > 0.35 && pauseRatio < 0.1) score -= 0.5;

      const target = 1 / (1 + Math.exp(-score * 1.6)); // squash
      this.speechProb += (target - this.speechProb) * 0.25; // slow blend, ~2s to flip

      // 'ambient' needs sustained quiet — a breakdown, a fade, or the gap
      // between tracks must not flip the mode (and bounce the scene)
      if (this._quietT > 4.0) this.mode = 'ambient';
      else if (f.level > 0.04) {
        this.mode = this.speechProb > 0.62 ? 'speech'
                  : this.speechProb < 0.45 ? 'music'
                  : this.mode; // hysteresis band holds previous
      } // briefly quiet: hold the previous mode
    }

    _goertzel(buf, hz, fps) {
      const N = buf.length;
      let mean = 0;
      for (let i = 0; i < N; i++) mean += buf[i];
      mean /= N;
      const w = 2 * Math.PI * hz / fps;
      const c = 2 * Math.cos(w);
      let s0 = 0, s1 = 0, s2 = 0;
      for (let i = 0; i < N; i++) {
        // ring buffer order doesn't matter for magnitude
        s0 = (buf[i] - mean) + c * s1 - s2;
        s2 = s1; s1 = s0;
      }
      const power = s1 * s1 + s2 * s2 - c * s1 * s2;
      return Math.sqrt(Math.max(0, power)) / N;
    }
  }

  window.ORPHIC = window.ORPHIC || {};
  window.ORPHIC.SpeechMusicClassifier = SpeechMusicClassifier;
})();
