/* ORPHIC — app shell
 * Bootstraps audio + GL, runs the render loop, manages scenes and UI.
 * Scenes self-register via ORPHIC.registerScene({name, modes, create}).
 * create(glc) -> { update(dt, audio, t), render(out), resize(w,h), dispose() }
 */
(function () {
  'use strict';
  const M = window.ORPHIC = window.ORPHIC || {};
  M.scenes = M.scenes || []; // registry itself lives in scene-utils.js

  window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('view');
    const glc = new M.GL(canvas);
    const engine = new M.AudioEngine();
    const features = new M.FeatureExtractor(engine);
    const classifier = new M.SpeechMusicClassifier(features);
    const audioTex = new M.AudioTextures(glc, engine);

    const ui = {
      overlay: document.getElementById('overlay'),
      hud: document.getElementById('hud'),
      sceneName: document.getElementById('scene-name'),
      sourceName: document.getElementById('source-name'),
      modeBadge: document.getElementById('mode-badge'),
      bpmBadge: document.getElementById('bpm-badge'),
      fileBtn: document.getElementById('btn-file'),
      micBtn: document.getElementById('btn-mic'),
      systemBtn: document.getElementById('btn-system'),
      fileInput: document.getElementById('file-input'),
      autoBtn: document.getElementById('btn-auto'),
      helpBar: document.getElementById('help-bar'),
      toast: document.getElementById('toast'),
    };

    // Desktop shell (Electron): system audio is captured natively from the
    // OS — reword the capture button, which is browser-tab-specific otherwise.
    const desktop = !!(window.orphic && window.orphic.isElectron);
    if (desktop) {
      const subs = {
        darwin: 'everything playing on this mac — first use asks permission',
        win32: 'everything playing on this pc',
        linux: 'everything playing — pipewire / pulseaudio',
      };
      ui.systemBtn.childNodes[0].textContent = 'capture system audio';
      ui.systemBtn.querySelector('.sub').textContent =
        subs[window.orphic.platform] || 'everything playing on this device';
    }

    function showToast(msg) {
      ui.toast.textContent = msg;
      ui.toast.classList.remove('hidden');
    }
    function hideToast() {
      ui.toast.classList.add('hidden');
    }

    // visual test: index.html#shot-N → scene N with synthetic audio, for screenshots
    const shotMatch = location.hash.match(/^#shot-(\d+)$/);
    if (shotMatch) {
      const idx = parseInt(shotMatch[1], 10);
      const dpr = 1;
      glc.resize(Math.round(canvas.clientWidth * dpr), Math.round(canvas.clientHeight * dpr));
      ui.overlay.style.display = 'none'; // no fade — screenshots must see the canvas
      const scene = M.scenes[idx].create(glc);
      if (scene.resize) scene.resize(glc.width, glc.height);
      const audio = { f: features, c: classifier, engine, tex: audioTex, mode: 'music' };
      let st = 0, frames = 0;
      function fakeFrame() {
        // headless rAF only delivers ~40 ticks before the screenshot, so run
        // several sim frames per tick to capture a developed state
        for (let k = 0; k < 8 && frames < 600; k++) stepOnce();
        if (frames < 600) requestAnimationFrame(fakeFrame);
        else console.log('SHOT READY: ' + M.scenes[idx].name);
      }
      function stepOnce() {
        const dt = 1 / 60;
        st += dt; frames++;
        const f = features;
        f.level = 0.55 + 0.2 * Math.sin(st * 2.1);
        f.bass = 0.5 + 0.35 * Math.sin(st * 4.0);
        f.bassFast = Math.max(0, Math.sin(st * 4.0)) * 0.8;
        f.mid = 0.4 + 0.2 * Math.sin(st * 3.1 + 1.0);
        f.treble = 0.35 + 0.25 * Math.sin(st * 5.3 + 2.0);
        f.centroid = 0.45 + 0.2 * Math.sin(st * 0.7);
        f.flux = 0.05 + 0.04 * Math.sin(st * 6.0);
        f.onset = (frames % 45 === 0) ? 1 : f.onset * 0.85;
        f.beat = (frames % 36 === 0) ? 1 : f.beat * 0.85;
        f.beatPhase = (frames % 36) / 36;
        f.bpm = 100; f.beatConf = 0.8;
        f.pitchNorm = 0.45 + 0.25 * Math.sin(st * 1.7);
        f.voiced = 0.8 + 0.2 * Math.sin(st * 2.3);
        f.pitchHz = 200;
        f.phaseLevel += dt * 0.8; f.phaseBass += dt; f.phaseTreble += dt;
        f.harmonic = 0.5 + 0.3 * Math.sin(st * 1.3);
        f.percussive = f.bassFast;
        f.quiet = 0; f.burst = f.beat;
        for (let c = 0; c < 12; c++) f.chroma[c] = 0.5 + 0.5 * Math.sin(st * 0.9 + c * 2.1);
        // synthetic spectrum/waveform so per-frequency scenes have content
        const fd = engine.freqData, td = engine.timeData;
        for (let i = 0; i < fd.length; i++) {
          const x = i / fd.length;
          let v = 200 * Math.exp(-x * 14) * (0.7 + 0.3 * Math.sin(st * 4.0));
          for (let k = 1; k < 6; k++) {
            const fc = 0.02 * k * k + 0.01 * Math.sin(st * 0.8 + k);
            v += 160 * Math.exp(-Math.pow((x - fc) * 220, 2.0)) * (0.5 + 0.5 * Math.sin(st * 3.0 + k * 1.7));
          }
          fd[i] = Math.max(0, Math.min(255, v));
        }
        for (let i = 0; i < td.length; i++) {
          const ph = i / td.length * 6.28318 * 16;
          td[i] = 0.4 * Math.sin(ph + st * 8) + 0.2 * Math.sin(ph * 2.7 + st * 5);
        }
        audioTex.update();
        if (scene.update) scene.update(dt, audio, st);
        scene.render(null, audio, st);
      }
      requestAnimationFrame(fakeFrame);
      return;
    }

    // headless self-test: open index.html#test → compile/run every scene once
    if (location.hash === '#test') {
      try {
        glc.resize(640, 360);
        audioTex.update();
        const audio = { f: features, c: classifier, engine, tex: audioTex, mode: 'music' };
        for (const def of M.scenes) {
          try {
            const s = def.create(glc);
            if (s.resize) s.resize(640, 360);
            if (s.update) s.update(1 / 60, audio, 0.5);
            s.render(null, audio, 0.5);
            const err = glc.gl.getError();
            if (err !== 0) throw new Error('glError 0x' + err.toString(16));
            if (s.dispose) s.dispose();
            console.log('SCENE OK: ' + def.name);
          } catch (e) {
            console.error('SCENE FAIL: ' + def.name + ' :: ' + e.message);
          }
        }
        console.log('TEST DONE: ' + M.scenes.length + ' scenes');
      } catch (e) {
        console.error('TEST ABORT: ' + e.message);
      }
      return;
    }

    let active = null, activeIdx = -1;
    let autoCycle = true;
    let cycleTimer = 0;
    const CYCLE_SECONDS = 45;
    let lastT = performance.now() / 1000;
    let hudFade = 0;

    function setScene(idx, why) {
      const defs = M.scenes;
      if (!defs.length) return;
      idx = ((idx % defs.length) + defs.length) % defs.length;
      if (idx === activeIdx) return;
      if (active && active.dispose) active.dispose();
      activeIdx = idx;
      active = defs[idx].create(glc);
      if (active.resize) active.resize(glc.width, glc.height);
      ui.sceneName.textContent = defs[idx].name;
      ui.sceneName.classList.remove('flash');
      void ui.sceneName.offsetWidth; // restart animation
      ui.sceneName.classList.add('flash');
      cycleTimer = 0;
    }

    function sceneFits(i, mode) {
      const d = M.scenes[i];
      return !d.modes || d.modes.includes(mode);
    }
    function pickSceneForMode(mode) {
      // jump somewhere fresh that suits the mode
      const ok = M.scenes.map((d, i) => sceneFits(i, mode) ? i : -1).filter(i => i >= 0);
      if (!ok.length) return activeIdx;
      const fresh = ok.filter(i => i !== activeIdx);
      const pool = fresh.length ? fresh : ok;
      return pool[Math.floor(Math.random() * pool.length)];
    }
    function nextSceneForMode(mode) {
      // next index (wrapping) that fits the mode — used by auto-cycle
      const n = M.scenes.length;
      for (let step = 1; step <= n; step++) {
        const i = (activeIdx + step) % n;
        if (sceneFits(i, mode)) return i;
      }
      return activeIdx + 1;
    }

    // ---- input wiring ----
    ui.fileBtn.addEventListener('click', () => ui.fileInput.click());
    ui.fileInput.addEventListener('change', e => {
      if (e.target.files[0]) startFile(e.target.files[0]);
    });
    ui.micBtn.addEventListener('click', startMic);
    ui.systemBtn.addEventListener('click', startSystem);
    ui.autoBtn.addEventListener('click', () => {
      autoCycle = !autoCycle;
      ui.autoBtn.classList.toggle('on', autoCycle);
      ui.autoBtn.textContent = autoCycle ? 'auto-cycle: on' : 'auto-cycle: off';
    });

    async function startFile(file) {
      try {
        await engine.loadFile(file);
        ui.overlay.classList.add('hidden');
        ui.sourceName.textContent = file.name.replace(/\.[^.]+$/, '');
      } catch (err) {
        alert('Could not play file: ' + err.message);
      }
    }
    async function startMic() {
      try {
        await engine.useMic();
        ui.overlay.classList.add('hidden');
        ui.sourceName.textContent = 'live microphone';
      } catch (err) {
        alert('Microphone unavailable: ' + err.message);
      }
    }
    async function startSystem() {
      try {
        await engine.useSystemAudio();
        ui.overlay.classList.add('hidden');
        ui.sourceName.textContent = desktop ? 'system audio' : 'tab audio';
      } catch (err) {
        if (err.name === 'NotAllowedError') return; // user cancelled the picker
        alert((desktop ? 'System audio unavailable: ' : 'Tab audio unavailable: ') + err.message);
      }
    }
    engine.onSourceEnd = () => {
      // "Stop sharing" pressed in the browser UI — back to the source picker
      ui.sourceName.textContent = '';
      hideToast();
      ui.overlay.classList.remove('hidden');
    };
    engine.onCaptureSilent = () => {
      showToast(desktop && window.orphic.platform === 'darwin'
        ? 'no sound detected — play something; if it stays silent, allow “System Audio Recording” for ORPHIC in System Settings → Privacy & Security, then retry'
        : 'no sound detected yet — play something');
    };
    engine.onCaptureSound = hideToast;

    // drag & drop anywhere
    window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
    window.addEventListener('dragleave', e => { if (e.target === document.body || e.relatedTarget === null) document.body.classList.remove('dragging'); });
    window.addEventListener('drop', e => {
      e.preventDefault();
      document.body.classList.remove('dragging');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && f.type.startsWith('audio')) startFile(f);
      else if (f) startFile(f); // try anyway (m4a sometimes has odd MIME)
    });

    // keyboard
    window.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'n') setScene(activeIdx + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'p') setScene(activeIdx - 1);
      else if (e.key === ' ') { e.preventDefault(); engine.togglePlayback(); }
      else if (e.key === 'a') ui.autoBtn.click();
      else if (e.key === 'f') toggleFullscreen();
      else if (e.key === 'h') ui.hud.classList.toggle('hidden-hud');
      else if (/^[0-9]$/.test(e.key)) { autoCycle = false; ui.autoBtn.classList.remove('on'); ui.autoBtn.textContent = 'auto-cycle: off'; setScene(e.key === '0' ? 9 : parseInt(e.key, 10) - 1); }
    });
    function toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    }
    canvas.addEventListener('dblclick', toggleFullscreen);

    // mouse wakes the HUD
    window.addEventListener('mousemove', () => { hudFade = 3.5; ui.hud.classList.remove('asleep'); ui.helpBar.classList.remove('asleep'); });

    // ---- render loop ----
    let modeHold = 0;
    function frame() {
      requestAnimationFrame(frame);
      const now = performance.now() / 1000;
      let dt = Math.min(0.05, now - lastT);
      lastT = now;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (glc.resize(w, h) && active && active.resize) active.resize(w, h);

      features.update(dt);
      classifier.update(dt);
      audioTex.update();

      // HUD info
      ui.modeBadge.textContent = classifier.mode;
      ui.modeBadge.className = 'badge mode-' + classifier.mode;
      ui.bpmBadge.textContent = features.bpm > 0 && features.beatConf > 0.2
        ? Math.round(features.bpm) + ' bpm' : '·';
      hudFade -= dt;
      if (hudFade < 0) { ui.hud.classList.add('asleep'); ui.helpBar.classList.add('asleep'); }

      // auto-cycle scenes; bias switches to land on beats
      if (autoCycle && M.scenes.length > 1 && engine.mode !== 'none') {
        cycleTimer += dt;
        const due = cycleTimer > CYCLE_SECONDS;
        if (due && (features.beat > 0.9 || cycleTimer > CYCLE_SECONDS + 4)) {
          setScene(nextSceneForMode(classifier.mode));
        }
      }

      // mode-aware scene preference: on sustained mode change, jump to a fitting scene
      modeHold = (classifier.mode === (M._lastMode || 'music')) ? modeHold + dt : 0;
      if (classifier.mode !== M._lastMode && modeHold === 0) M._pendingMode = classifier.mode;
      if (M._pendingMode && M._pendingMode === classifier.mode) {
        M._modePendingT = (M._modePendingT || 0) + dt;
        if (M._modePendingT > 2.5) {
          M._lastMode = classifier.mode;
          M._pendingMode = null; M._modePendingT = 0;
          if (autoCycle) setScene(pickSceneForMode(classifier.mode));
        }
      } else { M._modePendingT = 0; }

      const audio = { f: features, c: classifier, engine, tex: audioTex, mode: classifier.mode };
      if (!active && M.scenes.length) setScene(0);
      if (active) {
        if (active.update) active.update(dt, audio, now);
        active.render(null, audio, now);
      }
    }
    requestAnimationFrame(frame);
  });
})();
