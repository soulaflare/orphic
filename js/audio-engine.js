/* ORPHIC — audio engine
 * Captures system/tab audio into a Web Audio graph and exposes raw FFT +
 * waveform data each frame.
 * Classic script (no modules) so the app runs from file://.
 */
(function () {
  'use strict';

  const FFT_SIZE = 4096; // 2048 frequency bins; ~10.7 Hz/bin at 44.1k

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.analyser = null;
      this.sourceNode = null;       // current MediaStreamSource
      this.stream = null;           // the captured MediaStream
      this.mode = 'none';           // 'none' | 'system'

      this.freqData = new Uint8Array(FFT_SIZE / 2);
      this.timeData = new Float32Array(FFT_SIZE);
      this.binHz = 0;
      this.onSourceEnd = null;      // callback() — system capture stopped externally
      this.onCaptureSilent = null;  // callback() — capture running but never any signal
      this.onCaptureSound = null;   // callback() — first signal after onCaptureSilent
      this._silenceTimer = null;
    }

    _ensureContext() {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = FFT_SIZE;
        this.analyser.smoothingTimeConstant = 0; // we do our own smoothing
        this.binHz = this.ctx.sampleRate / FFT_SIZE;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    _disconnectSource() {
      if (this._silenceTimer) {
        clearInterval(this._silenceTimer);
        this._silenceTimer = null;
      }
      if (this.sourceNode) {
        try { this.sourceNode.disconnect(); } catch (e) {}
        this.sourceNode = null;
      }
      if (this.stream) {
        this.stream.getTracks().forEach(t => t.stop());
        this.stream = null;
      }
    }

    /** Capture system / tab audio via getDisplayMedia.
     *  Desktop app: the Electron main process answers with the OS loopback
     *  device (WASAPI / CoreAudio taps / PulseAudio monitor) — whole-system
     *  audio, no picker.
     *  Browser: screen-share picker; tab audio on Chrome/Edge only. */
    async useSystemAudio() {
      this._ensureContext();
      const desktop = !!(window.orphic && window.orphic.isElectron);

      // ask BEFORE tearing down the current source, so a cancelled picker
      // leaves the current playback untouched
      const stream = await navigator.mediaDevices.getDisplayMedia(desktop ? {
        video: true, // a video track is mandatory in the API; stopped below
        audio: true, // the display-media handler swaps in loopback audio
      } : {
        video: true, // a video track is mandatory; stopped below
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: false, // keep hearing the source
        },
        selfBrowserSurface: 'exclude',  // capturing ourselves is never useful
        surfaceSwitching: 'include',    // let the user retarget the share live
        systemAudio: 'include',         // offer whole-system audio on Windows
      });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach(t => t.stop());
        throw new Error(desktop
          ? 'system audio capture returned no audio track'
          : 'no audio was shared — use Chrome or Edge, share a tab, and tick "Share tab audio" in the picker');
      }

      this._disconnectSource();
      // video frames are wasted work — audio keeps flowing without them
      stream.getVideoTracks().forEach(t => t.stop());

      this.stream = stream;
      this.sourceNode = this.ctx.createMediaStreamSource(stream);
      this.sourceNode.connect(this.analyser);
      this.mode = 'system';
      stream.getAudioTracks()[0].addEventListener('ended', () => {
        if (this.mode === 'system' && this.onSourceEnd) this.onSourceEnd();
      });
      if (desktop && window.orphic.platform === 'darwin') this._watchForSilentCapture();
    }

    /** macOS quirk: when the app lacks the "System Audio Recording" consent,
     *  Chromium delivers a stream that stays silent forever instead of
     *  raising an error (electron/electron#49607). Silence is also what an
     *  idle music player produces, so only hint — never block. */
    _watchForSilentCapture() {
      if (this._silenceTimer) clearInterval(this._silenceTimer);
      const startedAt = performance.now();
      let warned = false;
      this._silenceTimer = setInterval(() => {
        if (this.mode !== 'system') {
          clearInterval(this._silenceTimer);
          this._silenceTimer = null;
          return;
        }
        let peak = 0;
        for (let i = 0; i < this.timeData.length; i++) {
          const a = Math.abs(this.timeData[i]);
          if (a > peak) peak = a;
        }
        if (peak > 1e-6) {
          clearInterval(this._silenceTimer);
          this._silenceTimer = null;
          if (warned && this.onCaptureSound) this.onCaptureSound();
        } else if (!warned && performance.now() - startedAt > 6000) {
          warned = true;
          if (this.onCaptureSilent) this.onCaptureSilent();
        }
      }, 500);
    }

    /** Stop the current source and return to the idle state. */
    stop() {
      this.mode = 'none'; // set first so 'ended' listeners see a deliberate stop
      this._disconnectSource();
      this.freqData.fill(0);
      this.timeData.fill(0);
    }

    /** Pull current FFT + waveform. Call once per render frame. */
    sample() {
      if (!this.analyser) return false;
      this.analyser.getByteFrequencyData(this.freqData);
      this.analyser.getFloatTimeDomainData(this.timeData);
      return true;
    }
  }

  window.ORPHIC = window.ORPHIC || {};
  window.ORPHIC.AudioEngine = AudioEngine;
})();
