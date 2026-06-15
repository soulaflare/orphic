/* ORPHIC — audio feature extraction
 * Turns raw FFT/waveform into musically meaningful, frame-rate signals:
 *   bands (bass/mid/treble) with attack/release envelopes,
 *   spectral flux + adaptive onset detection, beat tracking (BPM via
 *   autocorrelation of onset strength), spectral centroid/flatness,
 *   pitch (NSDF-lite autocorrelation).
 */
(function () {
  'use strict';

  const HIST = 512;        // ~8.5s of onset history on the 60Hz envelope grid
  const ENV_STEP = 1 / 60; // flux is resampled onto this fixed grid (rAF rate varies)

  function envFollow(current, target, attack, release, dt) {
    const k = target > current ? attack : release;
    return current + (target - current) * (1 - Math.exp(-dt / k));
  }

  function median9(a) { // insertion sort 9 elements in place, return middle
    for (let i = 1; i < 9; i++) {
      const v = a[i];
      let j = i - 1;
      while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; }
      a[j + 1] = v;
    }
    return a[4];
  }

  class FeatureExtractor {
    constructor(engine) {
      this.engine = engine;

      // Smoothed envelopes (0..~1)
      this.bass = 0; this.mid = 0; this.treble = 0; this.level = 0;
      this.bassFast = 0; // snappier bass for kick punch
      this.rawLevel = 0; // instantaneous level, pre-envelope (the classifier's input)

      this.centroid = 0;       // normalized 0..1 (0..~8kHz)
      this.flatness = 0;       // 0 tonal .. 1 noisy
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

      // formants: the two lowest spectral-envelope resonances of the vocal
      // tract. F1 (openness) and F2 (frontness) place a vowel in articulation
      // space; held through brief unvoiced gaps so the vowel reads steadily.
      this.f1 = 0.35;          // normalized in 220..1000 Hz
      this.f2 = 0.5;           // normalized in 800..3000 Hz
      this.f1Hz = 0; this.f2Hz = 0;
      this._fPre = null;       // prefix-sum scratch for envelope smoothing

      // HPSS (Fitzgerald 2010, median-filter proxy): harmonic = sustained
      // tonal energy (horizontal spectrogram ridges), percussive = broadband
      // transient energy (vertical)
      this.harmonic = 0;
      this.percussive = 0;
      this._hpssHist = null;
      this._hpssIdx = 0;
      this._med9 = new Uint8Array(9);

      // rests: quiet rises ~0.6s into silence and snaps away on sound;
      // burst spikes to 1 when music returns after a real rest
      this.quiet = 0;
      this.burst = 0;
      this._quietT = 0;

      // chroma: energy folded into 12 pitch classes (C=0), each 0..1
      this.chroma = new Float32Array(12);
      this._chromaRaw = new Float32Array(12);
      this._chromaBinPC = null; // per-FFT-bin pitch class, built lazily

      // phase accumulators (Listeningway-style): loudness counters that
      // advance faster when the band is louder — smooth BPM-independent
      // animation time, far better than per-frame amplitude jitter.
      this.phaseLevel = 0;
      this.phaseBass = 0;
      this.phaseTreble = 0;

      this._prevSpec = null;
      this._fluxHist = new Float32Array(HIST);
      this._fluxIdx = 0;
      this._envT = 0;    // time owed to the 60Hz envelope grid
      this._envMax = 0;  // peak flux within the current grid slot
      this._bpmHist = []; // recent raw tempo estimates, for median gating
      this._bpmMiss = 0;  // consecutive estimates disagreeing with the lock
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

      this.rawLevel = lvl;
      this.bass     = envFollow(this.bass, bass, 0.02, 0.18, dt);
      this.bassFast = envFollow(this.bassFast, bass, 0.008, 0.08, dt);
      this.mid      = envFollow(this.mid, mid, 0.03, 0.22, dt);
      this.treble   = envFollow(this.treble, treb, 0.02, 0.20, dt);
      this.level    = envFollow(this.level, lvl, 0.02, 0.25, dt);

      // ---- spectral shape ----
      let wSum = 0, mSum = 0, geo = 0, ari = 0;
      const shapeEnd = Math.min(n, Math.round(8000 / binHz));
      for (i = 1; i < shapeEnd; i++) {
        const m = freq[i] / 255;
        wSum += m * i; mSum += m;
        const p = m + 1e-6;
        geo += Math.log(p); ari += p;
      }
      const centroidBin = mSum > 1e-4 ? wSum / mSum : 0;
      this.centroid = envFollow(this.centroid, centroidBin / shapeEnd, 0.05, 0.05, dt);
      const flat = mSum > 1e-4 ? Math.exp(geo / (shapeEnd - 1)) / (ari / (shapeEnd - 1)) : 1;
      this.flatness = envFollow(this.flatness, flat, 0.1, 0.1, dt);

      // ---- chroma (12 pitch classes) ----
      this._updateChroma(freq, binHz, dt);

      // ---- HPSS: harmonic vs percussive energy ----
      this._updateHPSS(freq, dt);

      // ---- rests: silence detection + return-burst ----
      const silent = this.rawLevel < 0.06 && this.fluxRaw < 0.004;
      this.quiet = envFollow(this.quiet, silent ? 1 : 0, 0.6, 0.08, dt);
      this.burst *= Math.pow(0.5, dt / 0.15);
      if (silent) {
        this._quietT += dt;
      } else {
        if (this._quietT > 0.45) this.burst = 1;
        this._quietT = 0;
      }

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

      // resample flux onto a fixed 60Hz grid — rAF runs anywhere from 24 to
      // 120Hz (ProMotion), and tempo lags are only meaningful on a steady
      // clock. Keep each slot's peak so onset spikes survive resampling.
      this._envMax = Math.max(this._envMax, flux);
      this._envT += dt;
      while (this._envT >= ENV_STEP) {
        this._envT -= ENV_STEP;
        this._fluxHist[this._fluxIdx] = this._envMax;
        this._fluxIdx = (this._fluxIdx + 1) % HIST;
        this._envMax = 0;
      }

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
        this._estimateTempo();
      }

      // beat phase + pulse
      this.beat *= Math.pow(0.5, dt / 0.09);
      if (this.bpm > 0) {
        const period = 60 / this.bpm;
        this.beatPhase = (this.beatPhase + dt / period) % 1;
        // detect the natural beat wrap BEFORE any re-anchor, so snapping
        // the phase below can't manufacture a second wrap the same frame
        let beatNow = this.beatPhase < (this._prevPhase || 0);
        // re-anchor phase to strong onsets near the predicted beat
        if (this.onset === 1) {
          const ph = this.beatPhase;
          if (ph > 0.85) {        // onset just before the predicted beat:
            this.beatPhase = 0;   // snap forward and let it fire now
            beatNow = true;
          } else if (ph < 0.15) { // onset just after the beat already fired:
            this.beatPhase = 0;   // realign phase only, never re-trigger
          }
        }
        if (beatNow) {
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

      // ---- formants (spectral-envelope peaks, needs fresh voicing) ----
      this._updateFormants(freq, binHz, dt);
    }

    _updateFormants(freq, binHz, dt) {
      // Box-smooth the magnitude spectrum to flatten the harmonic comb, then
      // peak-pick the envelope: the broad energy humps ARE the formants. F2 is
      // forced above the F1 peak so the pair never collapses onto one ridge.
      const n = freq.length;
      if (!this._fPre || this._fPre.length !== n + 1) this._fPre = new Float32Array(n + 1);
      const pre = this._fPre;
      for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + freq[i];
      const W = Math.max(2, Math.round(250 / binHz)); // ~250 Hz smoothing window
      const peak = (lo, hi) => {
        let bestBin = lo, best = -1;
        for (let i = lo; i <= hi; i++) {
          const a = Math.max(0, i - W), b = Math.min(n - 1, i + W);
          const m = (pre[b + 1] - pre[a]) / (b - a + 1);
          if (m > best) { best = m; bestBin = i; }
        }
        return [bestBin, best];
      };
      // only trust formant tracking while voiced; otherwise hold the last vowel
      if (this.voiced > 0.2) {
        const [b1, m1] = peak(Math.round(220 / binHz), Math.round(1000 / binHz));
        const f2lo = Math.max(b1 + Math.round(150 / binHz), Math.round(800 / binHz));
        const [b2] = peak(f2lo, Math.max(f2lo + 1, Math.round(3000 / binHz)));
        if (m1 > 4) { // above the byte-FFT noise floor
          this.f1Hz = b1 * binHz; this.f2Hz = b2 * binHz;
          const t1 = Math.min(1, Math.max(0, (this.f1Hz - 220) / 780));
          const t2 = Math.min(1, Math.max(0, (this.f2Hz - 800) / 2200));
          this.f1 = envFollow(this.f1, t1, 0.08, 0.12, dt);
          this.f2 = envFollow(this.f2, t2, 0.08, 0.12, dt);
        }
      }
    }

    _updateHPSS(freq, dt) {
      // median across time per bin ≈ harmonic (sustained ridges survive),
      // median across frequency per frame ≈ percussive (broadband verticals)
      const N = Math.min(1024, freq.length); // up to ~11 kHz is plenty
      if (!this._hpssHist) this._hpssHist = new Uint8Array(N * 9);
      const hist = this._hpssHist, tmp = this._med9, idx = this._hpssIdx;
      for (let i = 0; i < N; i++) hist[i * 9 + idx] = freq[i];
      this._hpssIdx = (idx + 1) % 9;

      let hSum = 0, pSum = 0;
      for (let i = 0; i < N; i++) {
        for (let k = 0; k < 9; k++) tmp[k] = hist[i * 9 + k];
        hSum += median9(tmp);
        for (let k = 0; k < 9; k++) {
          const j = i + k - 4;
          tmp[k] = freq[j < 0 ? 0 : j >= N ? N - 1 : j];
        }
        pSum += median9(tmp);
      }
      const hAvg = hSum / (N * 255), pAvg = pSum / (N * 255);
      this.harmonic = envFollow(this.harmonic, Math.min(1, hAvg * 3.5), 0.04, 0.30, dt);
      this.percussive = envFollow(this.percussive, Math.min(1, pAvg * 3.5), 0.012, 0.10, dt);
    }

    _updateChroma(freq, binHz, dt) {
      // map each FFT bin (55 Hz..5 kHz) to its pitch class once, then fold
      // squared magnitudes into a 12-bin profile normalized to its max
      if (!this._chromaBinPC || this._chromaBinHz !== binHz) {
        this._chromaBinHz = binHz;
        const pc = new Int8Array(freq.length).fill(-1);
        const lo = Math.ceil(55 / binHz), hi = Math.min(freq.length, Math.floor(5000 / binHz));
        for (let i = lo; i < hi; i++) {
          const midi = 69 + 12 * Math.log2((i * binHz) / 440);
          pc[i] = ((Math.round(midi) % 12) + 12) % 12;
        }
        this._chromaBinPC = pc;
      }
      const raw = this._chromaRaw;
      raw.fill(0);
      const pcMap = this._chromaBinPC;
      for (let i = 0; i < freq.length; i++) {
        const p = pcMap[i];
        if (p < 0) continue;
        const m = freq[i] / 255;
        raw[p] += m * m;
      }
      let max = 1e-6;
      for (let p = 0; p < 12; p++) if (raw[p] > max) max = raw[p];
      for (let p = 0; p < 12; p++) {
        this.chroma[p] = envFollow(this.chroma[p], raw[p] / max, 0.05, 0.4, dt);
      }
    }

    _estimateTempo() {
      // autocorrelate the flux envelope (fixed 60Hz grid, so lag→BPM is exact)
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

      let norm = 1e-9;
      for (let i = 0; i < HIST; i++) norm += h[i] * h[i];
      // normalized autocorrelation out to 3x the slowest beat lag so the
      // harmonic scoring below can see each candidate's multiples
      const acN = Math.min((HIST / 2) | 0, maxLag * 3 + 1);
      const ac = new Float32Array(acN + 1);
      for (let lag = minLag; lag <= acN; lag++) {
        let s = 0;
        for (let i = 0; i + lag < HIST; i++) s += h[i] * h[i + lag];
        ac[lag] = s / norm;
      }

      // pick the beat lag, not just the strongest peak: a true beat also has
      // energy at 2x/3x its period, and a gentle log-gaussian prior around
      // 120 BPM breaks ties between a beat and its hi-hat subdivision
      let bestLag = 0, bestScore = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let s = ac[lag];
        if (2 * lag <= acN) s += 0.5 * ac[2 * lag];
        if (3 * lag <= acN) s += 0.33 * ac[3 * lag];
        const oct = Math.log2(60 * fps / lag / 120);
        s *= Math.exp(-0.5 * (oct / 0.9) * (oct / 0.9));
        if (s > bestScore) { bestScore = s; bestLag = lag; }
      }
      // resolve the metrical octave. The comb score above can land on a
      // subdivision (a beat read at 2x, e.g. 90→180) or on a backbeat (read
      // at 1/2x, e.g. 123→61). Re-judge the half / chosen / double lag by
      // prior-weighted periodicity — overlap-compensated autocorrelation
      // times the 120-BPM log-gaussian — and keep the strongest. Because the
      // prior favours the level nearest a perceptual tempo, this pulls both a
      // subdivision and a backbeat back onto the true beat in one step.
      if (bestLag) {
        const wStrength = (lag) => {
          if (lag < minLag || lag > acN || lag >= HIST) return -1;
          const oct = Math.log2(60 * fps / lag / 120);
          return ac[lag] * HIST / (HIST - lag) * Math.exp(-0.5 * (oct / 0.9) * (oct / 0.9));
        };
        const half = Math.round(bestLag / 2), dbl = bestLag * 2;
        let bw = wStrength(bestLag);
        const wh = wStrength(half), wd = wStrength(dbl);
        if (wh > bw) { bw = wh; bestLag = half; }
        if (wd > bw) { bw = wd; bestLag = dbl; }
      }
      const peak = bestLag > 0 ? ac[bestLag] : 0;
      // hysteresis: acquiring a lock needs a clear peak, holding one doesn't
      if (!bestLag || peak < (this.bpm ? 0.07 : 0.12)) {
        this.beatConf *= 0.8;
        if (this.beatConf < 0.05) {
          this.bpm = 0;
          this._bpmHist.length = 0;
          this._bpmMiss = 0;
        }
        return;
      }

      // parabolic interpolation around the peak: sub-frame lag precision,
      // otherwise BPM is quantized to ±4 at pop tempos
      let lagF = bestLag;
      if (bestLag > minLag && bestLag < acN) {
        const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
        const d = a - 2 * b + c;
        if (d < 0) lagF = bestLag + 0.5 * (a - c) / d;
      }
      const est = 60 * fps / lagF;
      this.beatConf = Math.min(1, peak * 2.5);

      // median of recent estimates + a locked value that only moves on
      // sustained evidence — one bad estimate never jerks the BPM around
      const recent = this._bpmHist;
      recent.push(est);
      if (recent.length > 5) recent.shift();
      const med = recent.slice().sort((x, y) => x - y)[recent.length >> 1];
      if (!this.bpm) {
        if (recent.length >= 3) this.bpm = med;
        return;
      }
      // octave continuity: a stray estimate an octave off the lock is the
      // SAME tempo at another metrical level — snap it onto the lock so the
      // reading never flip-flops between a beat and its half/double. Only a
      // disagreement that no octave can reconcile, sustained ~2s, counts as a
      // real tempo change and re-acquires.
      let cand = med;
      if (Math.abs(cand * 2 - this.bpm) < this.bpm * 0.08) cand *= 2;
      else if (Math.abs(cand * 0.5 - this.bpm) < this.bpm * 0.08) cand *= 0.5;
      if (Math.abs(cand - this.bpm) < this.bpm * 0.08) {
        this._bpmMiss = 0;
        this.bpm += (cand - this.bpm) * 0.25;
      } else if (++this._bpmMiss >= 4) { // ~2s of disagreement: real tempo change
        this._bpmMiss = 0;
        this.bpm = med;
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
