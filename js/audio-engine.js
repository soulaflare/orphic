/* MYTHOS — audio engine
 * Handles input sources (MP3 file / microphone), the Web Audio graph,
 * and exposes raw FFT + waveform data each frame.
 * Classic script (no modules) so the app runs from file://.
 */
(function () {
  'use strict';

  const FFT_SIZE = 4096; // 2048 frequency bins; ~10.7 Hz/bin at 44.1k

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.analyser = null;
      this.sourceNode = null;       // current MediaElementSource or MediaStreamSource
      this.mediaEl = null;          // <audio> element for file playback
      this.micStream = null;
      this.mode = 'none';           // 'none' | 'file' | 'mic'

      this.freqData = new Uint8Array(FFT_SIZE / 2);
      this.timeData = new Float32Array(FFT_SIZE);
      this.binHz = 0;
      this.onSourceChange = null;   // callback(mode)
    }

    _ensureContext() {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = FFT_SIZE;
        this.analyser.smoothingTimeConstant = 0; // we do our own smoothing
        this.binHz = this.ctx.sampleRate / FFT_SIZE;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    _disconnectSource() {
      if (this.sourceNode) {
        try { this.sourceNode.disconnect(); } catch (e) {}
        this.sourceNode = null;
      }
      if (this.micStream) {
        this.micStream.getTracks().forEach(t => t.stop());
        this.micStream = null;
      }
      if (this.mediaEl) {
        this.mediaEl.pause();
      }
    }

    /** Play an audio File (MP3/WAV/OGG/etc). */
    async loadFile(file) {
      this._ensureContext();
      this._disconnectSource();

      if (!this.mediaEl) {
        this.mediaEl = new Audio();
        this.mediaEl.crossOrigin = 'anonymous';
        this._mediaSource = this.ctx.createMediaElementSource(this.mediaEl);
      }
      if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = URL.createObjectURL(file);
      this.mediaEl.src = this._objectUrl;
      this.mediaEl.loop = false;

      this.sourceNode = this._mediaSource;
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.ctx.destination); // hear the music
      this._analyserToSpeakers = true;

      await this.mediaEl.play();
      this.mode = 'file';
      if (this.onSourceChange) this.onSourceChange(this.mode, file.name);
    }

    /** Capture the microphone. */
    async useMic() {
      this._ensureContext();
      this._disconnectSource();

      // Don't route mic to speakers (feedback). Disconnect analyser output.
      if (this._analyserToSpeakers) {
        try { this.analyser.disconnect(); } catch (e) {}
        this._analyserToSpeakers = false;
      }

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });
      this.sourceNode = this.ctx.createMediaStreamSource(this.micStream);
      this.sourceNode.connect(this.analyser);
      this.mode = 'mic';
      if (this.onSourceChange) this.onSourceChange(this.mode, 'microphone');
    }

    togglePlayback() {
      if (this.mode !== 'file' || !this.mediaEl) return;
      if (this.mediaEl.paused) this.mediaEl.play();
      else this.mediaEl.pause();
    }

    get isPlaying() {
      if (this.mode === 'mic') return true;
      if (this.mode === 'file' && this.mediaEl) return !this.mediaEl.paused;
      return false;
    }

    /** Pull current FFT + waveform. Call once per render frame. */
    sample() {
      if (!this.analyser) return false;
      this.analyser.getByteFrequencyData(this.freqData);
      this.analyser.getFloatTimeDomainData(this.timeData);
      return true;
    }
  }

  window.MYTHOS = window.MYTHOS || {};
  window.MYTHOS.AudioEngine = AudioEngine;
})();
