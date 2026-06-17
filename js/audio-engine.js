/* ORPHIC — audio engine
 * Captures system and/or microphone audio into one Web Audio graph and exposes
 * raw FFT + waveform data each frame. The two inputs are independent: either,
 * both, or neither can be live. Each source feeds its own GainNode into a shared
 * mix bus that drives a single AnalyserNode, so everything downstream (features,
 * classifier, textures, scenes) sees one combined spectrum and needs no changes.
 *
 *   [system loopback] → MediaStreamSource → gain ─┐
 *                                                 ├─→ mixBus → AnalyserNode
 *   [microphone]      → MediaStreamSource → gain ─┘
 *
 * The analyser is never connected to ctx.destination, so the mic is analysed but
 * never played back — no echo, no feedback loop.
 * Classic script (no modules) so the app runs from file://.
 */
(function () {
  'use strict';

  const FFT_SIZE = 4096; // 2048 frequency bins; ~10.7 Hz/bin at 44.1k

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.analyser = null;
      this.mixBus = null;           // GainNode summing every source into the analyser
      // independent input slots — each null when off, else { stream, node, gain }
      this.sources = { system: null, mic: null };
      this.micDeviceId = null;      // preferred mic device (remembered across toggles)

      this.freqData = new Uint8Array(FFT_SIZE / 2);
      this.timeData = new Float32Array(FFT_SIZE);
      this.binHz = 0;
      this.onSourceEnd = null;      // callback(which) — a source stopped externally
      this.onSourcesChanged = null; // callback() — any enable/disable; resync UI
      this.onCaptureSilent = null;  // callback() — system capture running but silent
      this.onCaptureSound = null;   // callback() — first signal after onCaptureSilent
      this._silenceTimer = null;
    }

    // ---- state the UI reads ----
    get active()   { return !!(this.sources.system || this.sources.mic); }
    get systemOn() { return !!this.sources.system; }
    get micOn()    { return !!this.sources.mic; }

    _ensureContext() {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = FFT_SIZE;
        this.analyser.smoothingTimeConstant = 0; // we do our own smoothing
        this.mixBus = this.ctx.createGain();
        this.mixBus.gain.value = 1;
        this.mixBus.connect(this.analyser); // analyser only — never ctx.destination
        this.binHz = this.ctx.sampleRate / FFT_SIZE;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    _attachSource(key, stream) {
      const node = this.ctx.createMediaStreamSource(stream);
      const gain = this.ctx.createGain();
      gain.gain.value = 1; // simple equal-gain sum
      node.connect(gain).connect(this.mixBus);
      this.sources[key] = { stream, node, gain };
    }

    _detachSource(key) {
      const s = this.sources[key];
      if (!s) return;
      try { s.node.disconnect(); } catch (e) {}
      try { s.gain.disconnect(); } catch (e) {}
      s.stream.getTracks().forEach(t => t.stop());
      this.sources[key] = null;
    }

    /** Capture system / tab audio via getDisplayMedia.
     *  Desktop app: the Electron main process answers with the OS loopback
     *  device (WASAPI / CoreAudio taps / PulseAudio monitor) — whole-system
     *  audio, no picker.
     *  Browser: screen-share picker; tab audio on Chrome/Edge only. */
    async enableSystem() {
      this._ensureContext();
      const desktop = !!(window.orphic && window.orphic.isElectron);

      // ask BEFORE tearing down any existing system source, so a cancelled
      // picker leaves the current capture untouched
      const stream = await navigator.mediaDevices.getDisplayMedia(desktop ? {
        // audio-only: the display-media handler answers with OS loopback and
        // no video source — requesting video here would make Electron throw
        // ("Video was requested, but no video stream was provided"), and a
        // screen track would cost the Screen Recording permission on macOS
        video: false,
        audio: true,
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

      // video frames are wasted work — audio keeps flowing without them
      stream.getVideoTracks().forEach(t => t.stop());

      this._detachSource('system');
      this._attachSource('system', stream);
      stream.getAudioTracks()[0].addEventListener('ended', () => {
        // external stop ("Stop sharing" in the browser, device unplugged)
        if (this.sources.system && this.sources.system.stream === stream) {
          this.disableSystem();
          if (this.onSourceEnd) this.onSourceEnd('system');
        }
      });
      if (desktop && window.orphic.platform === 'darwin') this._watchForSilentCapture();
      if (this.onSourcesChanged) this.onSourcesChanged();
    }

    disableSystem() {
      this._detachSource('system');
      if (this._silenceTimer) {
        clearInterval(this._silenceTimer);
        this._silenceTimer = null;
      }
      this._clearIfIdle();
      if (this.onSourcesChanged) this.onSourcesChanged();
    }

    /** Capture a microphone via getUserMedia. On macOS this is the light
     *  one-click "Microphone" consent (a plain TCC alert) — never the Screen
     *  Recording / System Settings trip that system-audio loopback needs.
     *  Works in every browser too, unlike getDisplayMedia.
     *  Raw signal: echo cancellation / noise suppression / AGC all OFF, so the
     *  visualizer sees the real waveform rather than voice-processed audio. */
    async enableMic(deviceId) {
      this._ensureContext();
      const audio = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      if (deviceId) audio.deviceId = { exact: deviceId };
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      } catch (err) {
        // a remembered device that's since been unplugged → fall back to default
        if (deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
          this.micDeviceId = null;
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            video: false,
          });
        } else {
          throw err;
        }
      }

      const track = stream.getAudioTracks()[0];
      // remember what we actually got so the picker can highlight it
      const settings = track.getSettings ? track.getSettings() : {};
      this.micDeviceId = settings.deviceId || deviceId || null;

      this._detachSource('mic');
      this._attachSource('mic', stream);
      track.addEventListener('ended', () => {
        if (this.sources.mic && this.sources.mic.stream === stream) {
          this.disableMic();
          if (this.onSourceEnd) this.onSourceEnd('mic');
        }
      });
      if (this.onSourcesChanged) this.onSourcesChanged();
    }

    disableMic() {
      this._detachSource('mic');
      this._clearIfIdle();
      if (this.onSourcesChanged) this.onSourcesChanged();
    }

    /** Input (microphone) devices. Labels are blank until mic permission has
     *  been granted at least once — callers should enable the mic first (with
     *  the default device) to unlock real names. */
    async listMics() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput');
    }

    /** macOS quirk: when the app lacks the "System Audio Recording" consent,
     *  Chromium delivers a stream that stays silent forever instead of
     *  raising an error (electron/electron#49607). Silence is also what an
     *  idle music player produces, so only hint — never block. Watches the
     *  system source specifically; mic silence is just a quiet room. */
    _watchForSilentCapture() {
      if (this._silenceTimer) clearInterval(this._silenceTimer);
      const startedAt = performance.now();
      let warned = false;
      this._silenceTimer = setInterval(() => {
        if (!this.sources.system) {
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

    // zero the spectrum once nothing is live, so the idle groove starts clean
    _clearIfIdle() {
      if (!this.active) {
        this.freqData.fill(0);
        this.timeData.fill(0);
      }
    }

    /** Stop every source and return to the idle state. */
    stop() {
      this._detachSource('system');
      this._detachSource('mic');
      if (this._silenceTimer) {
        clearInterval(this._silenceTimer);
        this._silenceTimer = null;
      }
      this.freqData.fill(0);
      this.timeData.fill(0);
      if (this.onSourcesChanged) this.onSourcesChanged();
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
