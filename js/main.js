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
      sceneNum: document.getElementById('scene-num'),
      scenePill: document.getElementById('scene-pill'),
      cycleBar: document.getElementById('cycle-bar'),
      modeBadge: document.getElementById('mode-badge'),
      bpmText: document.getElementById('bpm-text'),
      beatDot: document.getElementById('beat-dot'),
      systemBtn: document.getElementById('btn-system'),
      autoBtn: document.getElementById('btn-auto'),
      fsBtn: document.getElementById('btn-fs'),
      stopBtn: document.getElementById('btn-stop'),
      panel: document.getElementById('scene-panel'),
      sceneGrid: document.getElementById('scene-grid'),
      helpBar: document.getElementById('help-bar'),
      toast: document.getElementById('toast'),
    };

    // Desktop shell (Electron): system audio is captured natively from the
    // OS — reword the browser-specific hint under the capture button.
    const desktop = !!(window.orphic && window.orphic.isElectron);
    if (desktop) {
      const subs = {
        darwin: 'everything playing on this mac — first use asks permission',
        win32: 'everything playing on this pc',
        linux: 'everything playing — pipewire / pulseaudio',
      };
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

    // visual test: index.html#shot-N[-SECS] → scene N with synthetic audio
    // for SECS simulated seconds (default 10), logging "SHOT T <frames>"
    // every 10 sim-seconds so a driver can take timed captures — see
    // .claude/skills/run-orphic
    const shotMatch = location.hash.match(/^#shot-(\d+)(?:-(\d+))?$/);
    if (shotMatch) {
      const idx = parseInt(shotMatch[1], 10);
      const limit = (parseInt(shotMatch[2], 10) || 10) * 60;
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
        for (let k = 0; k < 8 && frames < limit; k++) stepOnce();
        if (frames % 600 === 0 && frames < limit) console.log('SHOT T ' + frames);
        if (frames < limit) requestAnimationFrame(fakeFrame);
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
        // synthetic vowel drift so formant-driven scenes articulate in shots
        f.f1 = 0.45 + 0.30 * Math.sin(st * 0.9);
        f.f2 = 0.50 + 0.33 * Math.sin(st * 0.6 + 1.7);
        f.phaseLevel += dt * 0.8; f.phaseBass += dt; f.phaseTreble += dt;
        f.harmonic = 0.5 + 0.3 * Math.sin(st * 1.3);
        f.percussive = f.bassFast;
        // burst marks music returning after a rest — rare (~once per scene
        // cycle). Firing it every beat floods burst-reactive scenes (fluid,
        // lenia, nebula) with detonations no real song produces, and a 10s
        // cadence aliases with the 10s SHOT T capture grid.
        f.quiet = 0; f.burst = (frames % 2700 === 900) ? 1 : 0;
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
    let hudBeatHeld = false;
    // last-written HUD values: DOM writes (even no-op textContent/className
    // assignments) invalidate style every frame — only write on change
    let hudMode = '', hudBpm = '', hudCycle = -1;

    function setScene(idx, why) {
      const defs = M.scenes;
      if (!defs.length) return;
      idx = ((idx % defs.length) + defs.length) % defs.length;
      if (idx === activeIdx) return;
      if (active && active.dispose) active.dispose();
      activeIdx = idx;
      active = defs[idx].create(glc);
      if (active.resize) active.resize(glc.width, glc.height);
      ui.sceneName.textContent = defs[idx].name.split(' · ')[0];
      ui.sceneName.classList.remove('flash');
      void ui.sceneName.offsetWidth; // restart animation
      ui.sceneName.classList.add('flash');
      ui.sceneNum.innerHTML = String(idx + 1).padStart(2, '0') + '<i>/' + defs.length + '</i>';
      for (const cell of ui.sceneGrid.children) {
        const current = Number(cell.dataset.idx) === idx;
        cell.classList.toggle('current', current);
        if (current && !ui.panel.classList.contains('hidden')) {
          cell.scrollIntoView({ block: 'nearest' }); // panel scrolls on short windows
        }
      }
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
    ui.systemBtn.addEventListener('click', startSystem);
    ui.autoBtn.addEventListener('click', () => {
      autoCycle = !autoCycle;
      ui.autoBtn.classList.toggle('on', autoCycle);
    });
    function disableAuto() {
      autoCycle = false;
      ui.autoBtn.classList.remove('on');
    }

    // scene panel: every pattern, numbered and clickable
    M.scenes.forEach((def, i) => {
      const parts = def.name.split(' · ');
      const cell = document.createElement('button');
      cell.className = 'scene-cell';
      cell.dataset.idx = i;
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(i + 1).padStart(2, '0');
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = parts[0];
      cell.append(num, title);
      if (parts[1]) {
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = parts[1];
        cell.append(sub);
      }
      if (def.modes && !def.modes.includes('music')) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = def.modes.join(' · ');
        cell.append(tag);
      }
      cell.addEventListener('click', () => {
        disableAuto(); // an explicit pick should stick
        setScene(i);
        togglePanel(false);
      });
      ui.sceneGrid.append(cell);
    });

    function togglePanel(open) {
      const want = open !== undefined ? open : ui.panel.classList.contains('hidden');
      if (want && engine.mode === 'none') return; // not on the landing screen
      ui.panel.classList.toggle('hidden', !want);
    }
    ui.scenePill.addEventListener('click', e => { e.stopPropagation(); togglePanel(); });
    window.addEventListener('click', e => {
      if (!ui.panel.classList.contains('hidden') && !ui.panel.contains(e.target)) togglePanel(false);
    });

    function stopCapture() {
      togglePanel(false);
      hideToast();
      engine.stop();
      ui.overlay.classList.remove('hidden');
    }
    ui.fsBtn.addEventListener('click', () => toggleFullscreen());
    ui.stopBtn.addEventListener('click', stopCapture);

    let starting = false; // a held/repeated start key must not open two captures
    async function startSystem() {
      if (starting) return;
      starting = true;
      try {
        await engine.useSystemAudio();
        ui.overlay.classList.add('hidden');
      } catch (err) {
        if (err.name === 'NotAllowedError') return; // user cancelled the picker
        alert((desktop ? 'System audio unavailable: ' : 'Tab audio unavailable: ') + err.message);
      } finally {
        starting = false;
      }
    }
    engine.onSourceEnd = () => {
      // "Stop sharing" pressed in the browser UI — back to the landing screen
      togglePanel(false);
      hideToast();
      ui.overlay.classList.remove('hidden');
    };
    engine.onCaptureSilent = () => {
      showToast(desktop && window.orphic.platform === 'darwin'
        ? 'no sound detected — play something; if it stays silent, allow “System Audio Recording” for ORPHIC in System Settings → Privacy & Security, then retry'
        : 'no sound detected yet — play something');
    };
    engine.onCaptureSound = hideToast;

    // keyboard
    window.addEventListener('keydown', e => {
      const panelOpen = !ui.panel.classList.contains('hidden');
      const onLanding = engine.mode === 'none';

      if (e.key === 'Enter' || e.key === ' ') {
        // preventDefault also keeps a focused button from double-firing
        e.preventDefault();
        if (onLanding) startSystem();
        else if (panelOpen) { disableAuto(); togglePanel(false); } // pick the highlighted one
        else if (e.key === ' ') setScene(activeIdx + 1);           // space skips while playing
      }
      else if (e.key === 'ArrowRight' || e.key === 'n') setScene(activeIdx + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'p') setScene(activeIdx - 1);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // with the pattern panel open, vertical arrows step by grid row
        if (!panelOpen) return;
        e.preventDefault(); // don't scroll the panel — selection drives it
        const cols = getComputedStyle(ui.sceneGrid).gridTemplateColumns.split(' ').length;
        setScene(activeIdx + (e.key === 'ArrowDown' ? cols : -cols));
      }
      else if (e.key === 'a') ui.autoBtn.click();
      else if (e.key === 's') togglePanel();
      else if (e.key === 'Escape') {
        if (panelOpen) togglePanel(false);
        // esc that exits fullscreen must never also kill the session
        else if (!onLanding && !document.fullscreenElement) stopCapture();
      }
      else if (e.key === 'f') toggleFullscreen();
      else if (e.key === 'h') {
        ui.hud.classList.toggle('hidden-hud');
        ui.helpBar.classList.toggle('hidden-hud');
      }
    });
    function toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    }
    canvas.addEventListener('dblclick', toggleFullscreen);

    // mouse wakes the HUD (not on the landing screen — nothing to control yet)
    window.addEventListener('mousemove', () => {
      if (engine.mode === 'none') return;
      hudFade = 3.5;
      ui.hud.classList.remove('asleep');
      ui.helpBar.classList.remove('asleep');
    });

    // dev preview: index.html#ui → HUD awake + panel open over the idle scene
    const uiPreview = location.hash === '#ui';
    if (uiPreview) {
      ui.overlay.classList.add('hidden');
      ui.hud.classList.remove('asleep');
      ui.helpBar.classList.remove('asleep');
      ui.panel.classList.remove('hidden');
    }

    // ---- idle attract mode ----
    // Before any capture starts, the landing shows a real scene breathing to
    // a gentle synthetic groove (runs AFTER features.update so it overrides
    // the silence-derived values; stops the moment a source is live).
    const IDLE_NAMES = ['stellar nursery', 'star river', 'aurora veil', 'ink nebula'];
    const idleScenes = IDLE_NAMES
      .map(n => M.scenes.findIndex(d => d.name.includes(n)))
      .filter(i => i >= 0);
    const IDLE_CYCLE_SECONDS = 26;
    let idleT = Math.random() * 60, idleCycle = 0, idleNext = 1;
    function idleDrive(dt) {
      idleT += dt;
      const f = features, t = idleT;
      const swell = 0.5 + 0.5 * Math.sin(t * 0.45);                      // ~14 s breath
      const pulse = Math.pow(Math.max(0, Math.sin(t * 3.42)), 6.0);      // soft pulse every ~1.8 s
      f.level = 0.28 + 0.16 * swell;
      f.bass = 0.26 + 0.22 * swell + 0.18 * pulse;
      f.bassFast = 0.45 * pulse;
      f.mid = 0.22 + 0.14 * Math.sin(t * 0.31 + 1.2);
      f.treble = 0.16 + 0.12 * Math.sin(t * 0.53 + 2.4);
      f.centroid = 0.36 + 0.12 * Math.sin(t * 0.21);
      f.flux = 0.015 + 0.012 * swell;
      f.onset = 0;
      f.beat = 0.5 * pulse;
      f.beatPhase = (t * 3.42 / (2 * Math.PI)) % 1;
      f.beatConf = 0.15; // below the HUD's display threshold
      f.pitchNorm = 0.4 + 0.15 * Math.sin(t * 0.17);
      f.voiced = 0;
      f.harmonic = 0.38 + 0.18 * swell;
      f.percussive = 0.35 * pulse;
      f.quiet = 0; f.burst = 0;
      f.phaseLevel += dt * (0.22 + 0.25 * swell);
      f.phaseBass += dt * (0.2 + 0.3 * (f.bass - 0.26));
      f.phaseTreble += dt * 0.25;
      for (let c = 0; c < 12; c++) {
        f.chroma[c] = 0.25 + 0.75 * Math.max(0, Math.cos(t * 0.11 + c * 2.62));
      }
      // dim synthetic spectrum + waveform so per-frequency scenes have form
      const fd = engine.freqData, td = engine.timeData;
      for (let i = 0; i < fd.length; i++) {
        const x = i / fd.length;
        let v = 120 * Math.exp(-x * 16) * (0.6 + 0.4 * swell);
        for (let k = 1; k < 5; k++) {
          const fc = 0.018 * k * k + 0.008 * Math.sin(t * 0.4 + k * 1.9);
          v += 90 * Math.exp(-Math.pow((x - fc) * 240, 2.0)) * (0.4 + 0.6 * Math.max(0, Math.sin(t * 0.9 + k * 1.7)));
        }
        fd[i] = Math.max(0, Math.min(255, v));
      }
      for (let i = 0; i < td.length; i++) {
        const ph = i / td.length * 6.28318 * 12;
        td[i] = 0.22 * Math.sin(ph + t * 5) + 0.1 * Math.sin(ph * 2.3 + t * 3.1);
      }
      // wander through the photogenic scenes while idling
      idleCycle += dt;
      if (idleCycle > IDLE_CYCLE_SECONDS && idleScenes.length > 1) {
        idleCycle = 0;
        setScene(idleScenes[idleNext % idleScenes.length]);
        idleNext++;
      }
    }

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
      const idle = engine.mode === 'none';
      if (idle) idleDrive(dt);
      audioTex.update();

      // HUD info (skip the DOM writes while the HUD is faded out)
      if (uiPreview) hudFade = 1;
      hudFade -= dt;
      if (hudFade < 0) {
        ui.hud.classList.add('asleep');
        ui.helpBar.classList.add('asleep');
      } else {
        if (classifier.mode !== hudMode) {
          hudMode = classifier.mode;
          ui.modeBadge.textContent = hudMode;
          ui.modeBadge.className = 'badge mode-' + hudMode;
        }
        const bpm = features.bpm > 0 && features.beatConf > 0.2
          ? Math.round(features.bpm) + ' bpm' : '·';
        if (bpm !== hudBpm) {
          hudBpm = bpm;
          ui.bpmText.textContent = bpm;
        }
        // quantized to ~1px steps so the bar animates with a few writes/s
        const cyc = Math.round(
          (uiPreview ? 0.4 : autoCycle && !idle ? Math.min(1, cycleTimer / CYCLE_SECONDS) : 0) * 200) / 200;
        if (cyc !== hudCycle) {
          hudCycle = cyc;
          ui.cycleBar.style.transform = 'scaleX(' + cyc + ')';
        }
        const beatNow = features.beat > 0.9;
        if (beatNow && !hudBeatHeld) {
          ui.beatDot.classList.remove('pulse');
          void ui.beatDot.offsetWidth; // restart the pulse animation
          ui.beatDot.classList.add('pulse');
        }
        hudBeatHeld = beatNow;
      }

      // auto-cycle scenes; bias switches to land on beats
      if (autoCycle && M.scenes.length > 1 && engine.mode !== 'none') {
        cycleTimer += dt;
        const due = cycleTimer > CYCLE_SECONDS;
        if (due && (features.beat > 0.9 || cycleTimer > CYCLE_SECONDS + 4)) {
          setScene(nextSceneForMode(classifier.mode));
        }
      }

      // mode-aware scene preference: on sustained mode change, jump to a fitting scene
      if (!idle) {
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
      }

      const audio = { f: features, c: classifier, engine, tex: audioTex, mode: idle ? 'music' : classifier.mode };
      if (!active && M.scenes.length) setScene(idle && idleScenes.length ? idleScenes[0] : 0);
      if (active) {
        if (active.update) active.update(dt, audio, now);
        active.render(null, audio, now);
      }
    }
    requestAnimationFrame(frame);
  });
})();
