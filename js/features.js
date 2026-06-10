/* ORPHIC — audio feature extraction
 * Turns raw FFT/waveform into musically meaningful, frame-rate signals:
 *   bands (bass/mid/treble) with attack/release envelopes,
 *   spectral flux + adaptive onset detection, beat tracking (BPM via
 *   autocorrelation of onset strength), spectral centroid/flatness/rolloff,
 *   zero-crossing rate, pitch (NSDF-lite autocorrelation).
 */
(function () {
  'use strict';

  const HIST = 256; // ~4.3s of onset history at 60fps

  function envFollow(current, target, attack, release, dt) {
    const k = target > current ? attack : release;
    return current + (target - current) * (1 - Math.exp(-dt / k));
  }

  class FeatureExtractor {
    constructor(engine) {
      this.engine = engine;

      // Smoothed envelopes (0..~1)
      this.bass = 0; this.mid = 0; this.treble = 0; this.level = 0;
      this.bassFast = 0; // snappier bass for kick punch
      // Raw instantaneous values
      this.rawBass = 0; this.rawMid = 0; this.rawTreble = 0; this.rawLevel = 0;

      this.centroid = 0;       // normalized 0..1 (0..~8kHz)
      this.flatness = 0;       // 0 tonal .. 1 noisy
      this.rolloff = 0;        // 0..1
      this.zcr = 0;            // zero crossings/sample, smoothed
      this.flux = 0;           // smoothed spectral flux
      this.fluxRaw = 0;

      this.onset = 0;          // 1.0 on onset frame, decays
      this.beat = 0;           // 1.0 on predicted beat, decays
      this.beatPhase = 0;      // 0..1 sawtooth synced to tempo
      this.bpm = 0;
      this.beatConf = 0;

      this.pitchHz = 0;        // 0 if unvoiced
      this.pitchNorm = 0;      // log-scaled 80..1000Hz -> 0..1
      this.voiced = 0;         // smoothed voicing confidence

      // phase accumulators (Listeningway-style): loudness counters that
      // advance faster when the band is louder — smooth BPM-independent
      // animation time, far better than per-frame amplitude jitter.
      this.phaseLevel = 0;
      this.phaseBass = 0;
      this.phaseTreble = 0;

      this._prevSpec = null;
      this._fluxHist = new Float32Array(HIST);
      this._fluxIdx = 0;
      this._lastOnsetT = 0;
      this._lastBeatT = 0;
      this._time = 0;
      this._agc = 1e-4;        // running max for auto-gain
    }

    update(dt) {
      const eng = this.engine;
      if (!eng.sample()) return;
      this._time += dt;

      const freq = eng.freqData;     // Uint8 0..255 per bin
      const time = eng.timeData;     // Float32 -1..1
      const binHz = eng.binHz || 10.77;
      const n = freq.length;

      // ---- band energies ----
      const bassEnd = Math.min(n, Math.round(250 / binHz));
      const midEnd  = Math.min(n, Math.round(2000 / binHz));
      const trebEnd = Math.min(n, Math.round(12000 / binHz));
      let bass = 0, mid = 0, treb = 0;
      let i = Math.max(1, Math.round(25 / binHz));
      for (; i < bassEnd; i++) bass += freq[i];
      bass /= Math.max(1, bassEnd - Math.round(25 / binHz)) * 255;
      for (i = bassEnd; i < midEnd; i++) mid += freq[i];
      mid /= Math.max(1, midEnd - bassEnd) * 255;
      for (i = midEnd; i < trebEnd; i++) treb += freq[i];
      treb /= Math.max(1, trebEnd - midEnd) * 255;

      // ---- RMS level + auto gain ----
      let rms = 0;
      for (i = 0; i < time.length; i++) rms += time[i] * time[i];
      rms = Math.sqrt(rms / time.length);
      this._agc = Math.max(this._agc * Math.pow(0.5, dt / 8), rms, 1e-4); // 8s half-life decay
      const lvl = Math.min(1, rms / this._agc);

      this.rawBass = bass; this.rawMid = mid; this.rawTreble = treb; this.rawLevel = lvl;
      this.bass     = envFollow(this.bass, bass, 0.02, 0.18, dt);
      this.bassFast = envFollow(this.bassFast, bass, 0.008, 0.08, dt);
      this.mid      = envFollow(this.mid, mid, 0.03, 0.22, dt);
      this.treble   = envFollow(this.treble, treb, 0.02, 0.20, dt);
      this.level    = envFollow(this.level, lvl, 0.02, 0.25, dt);

      // ---- spectral shape ----
      let wSum = 0, mSum = 0, geo = 0, ari = 0, cum = 0, total = 0;
      const shapeEnd = Math.min(n, Math.round(8000 / binHz));
      for (i = 1; i < shapeEnd; i++) {
        const m = freq[i] / 255;
        wSum += m * i; mSum += m;
        const p = m + 1e-6;
        geo += Math.log(p); ari += p;
        total += m;
      }
      const centroidBin = mSum > 1e-4 ? wSum / mSum : 0;
      this.centroid = envFollow(this.centroid, centroidBin / shapeEnd, 0.05, 0.05, dt);
      const flat = mSum > 1e-4 ? Math.exp(geo / (shapeEnd - 1)) / (ari / (shapeEnd - 1)) : 1;
      this.flatness = envFollow(this.flatness, flat, 0.1, 0.1, dt);
      let roll = 0;
      for (i = 1; i < shapeEnd && cum < total * 0.85; i++) cum += freq[i] / 255, roll = i;
      this.rolloff = envFollow(this.rolloff, roll / shapeEnd, 0.1, 0.1, dt);

      // ---- zero-crossing rate ----
      let zc = 0;
      for (i = 1; i < time.length; i++) if ((time[i - 1] < 0) !== (time[i] < 0)) zc++;
      this.zcr = envFollow(this.zcr, zc / time.length, 0.08, 0.08, dt);

      // ---- spectral flux + onsets ----
      if (!this._prevSpec) this._prevSpec = new Uint8Array(n);
      let flux = 0;
      const fluxEnd = Math.min(n, Math.round(8000 / binHz));
      for (i = 1; i < fluxEnd; i++) {
        const d = freq[i] - this._prevSpec[i];
        if (d > 0) flux += d;
      }
      flux /= fluxEnd * 255;
      this._prevSpec.set(freq);
      this.fluxRaw = flux;
      this.flux = envFollow(this.flux, flux, 0.03, 0.15, dt);

      this._fluxHist[this._fluxIdx] = flux;
      this._fluxIdx = (this._fluxIdx + 1) % HIST;

      // adaptive threshold: mean + k*std over recent history
      let mean = 0;
      for (i = 0; i < HIST; i++) mean += this._fluxHist[i];
      mean /= HIST;
      let varr = 0;
      for (i = 0; i < HIST; i++) { const d = this._fluxHist[i] - mean; varr += d * d; }
      const std = Math.sqrt(varr / HIST);

      this.onset *= Math.pow(0.5, dt / 0.07); // fast decay
      if (flux > mean + 1.6 * std && flux > 0.01 && this._time - this._lastOnsetT > 0.09) {
        this.onset = 1;
        this._lastOnsetT = this._time;
      }

      // ---- tempo: autocorrelation of onset-strength history ----
      this._tempoTimer = (this._tempoTimer || 0) + dt;
      if (this._tempoTimer > 0.5) {
        this._tempoTimer = 0;
        this._estimateTempo(dt);
      }

      // beat phase + pulse
      this.beat *= Math.pow(0.5, dt / 0.09);
      if (this.bpm > 0) {
        const period = 60 / this.bpm;
        this.beatPhase = (this.beatPhase + dt / period) % 1;
        // re-anchor phase to strong onsets near the predicted beat
        if (this.onset === 1) {
          const ph = this.beatPhase;
          if (ph < 0.15 || ph > 0.85) this.beatPhase = 0;
        }
        if (this.beatPhase < (this._prevPhase || 0)) { // wrapped
          this.beat = 1;
          this._lastBeatT = this._time;
        }
        this._prevPhase = this.beatPhase;
      }

      // ---- phase accumulators ----
      this.phaseLevel += dt * (0.05 + this.level * 1.2);
      this.phaseBass += dt * (0.04 + this.bass * 1.5);
      this.phaseTreble += dt * (0.04 + this.treble * 1.5);

      // ---- pitch (autocorrelation, time domain) ----
      this._updatePitch(time, eng.ctx ? eng.ctx.sampleRate : 44100, dt);
    }

    _estimateTempo(dt) {
      // autocorrelate flux history; frame spacing assumed ~1/60s.
      const fps = 60;
      const minLag = Math.round(fps * 60 / 200); // 200 BPM
      const maxLag = Math.round(fps * 60 / 60);  // 60 BPM
      const h = new Float32Array(HIST);
      // unroll ring buffer
      for (let i = 0; i < HIST; i++) h[i] = this._fluxHist[(this._fluxIdx + i) % HIST];
      let mean = 0;
      for (let i = 0; i < HIST; i++) mean += h[i];
      mean /= HIST;
      for (let i = 0; i < HIST; i++) h[i] -= mean;

      let bestLag = 0, bestVal = 0, norm = 1e-9;
      for (let i = 0; i < HIST; i++) norm += h[i] * h[i];
      for (let lag = minLag; lag <= maxLag && lag < HIST / 2; lag++) {
        let s = 0;
        for (let i = 0; i + lag < HIST; i++) s += h[i] * h[i + lag];
        s /= norm;
        if (s > bestVal) { bestVal = s; bestLag = lag; }
      }
      if (bestLag > 0 && bestVal > 0.12) {
        const bpm = 60 * fps / bestLag;
        this.bpm = this.bpm ? this.bpm * 0.7 + bpm * 0.3 : bpm;
        this.beatConf = Math.min(1, bestVal * 2.5);
      } else {
        this.beatConf *= 0.8;
        if (this.beatConf < 0.05) this.bpm = 0;
      }
    }

    _updatePitch(buf, sr, dt) {
      // lightweight NSDF-style autocorrelation over 80..1000 Hz
      const N = 1024; // analysis window from start of buffer
      const minLag = Math.floor(sr / 1000), maxLag = Math.floor(sr / 80);
      let rms = 0;
      for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / N);
      let voicedNow = 0, hz = 0;
      if (rms > 0.008) {
        let bestLag = -1, bestVal = 0;
        for (let lag = minLag; lag <= maxLag; lag++) {
          let ac = 0, m = 1e-9;
          for (let i = 0; i + lag < N; i++) {
            ac += buf[i] * buf[i + lag];
            m += buf[i] * buf[i] + buf[i + lag] * buf[i + lag];
          }
          const nsdf = 2 * ac / m;
          if (nsdf > bestVal) { bestVal = nsdf; bestLag = lag; }
        }
        if (bestVal > 0.55 && bestLag > 0) {
          hz = sr / bestLag;
          voicedNow = Math.min(1, (bestVal - 0.55) / 0.35);
        }
      }
      this.voiced = envFollow(this.voiced, voicedNow, 0.05, 0.2, dt);
      if (hz > 0) {
        this.pitchHz = this.pitchHz > 0 ? this.pitchHz * 0.6 + hz * 0.4 : hz;
        this.pitchNorm = Math.max(0, Math.min(1,
          (Math.log2(this.pitchHz) - Math.log2(80)) / (Math.log2(1000) - Math.log2(80))));
      } else if (this.voiced < 0.1) {
        this.pitchHz = 0;
      }
    }
  }

  window.ORPHIC = window.ORPHIC || {};
  window.ORPHIC.FeatureExtractor = FeatureExtractor;
})();
