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
    let glc;
    try {
      glc = new M.GL(canvas);
    } catch (err) {
      // no WebGL2: leave the landing overlay up with an explanation instead
      // of a dead start button
      document.querySelector('#overlay .cta').disabled = true;
      document.querySelector('#overlay .hint').textContent =
        'this browser or device has no WebGL2 — ORPHIC needs it to draw';
      return;
    }
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
      mediaGroup: document.getElementById('media-group'),
      prevBtn: document.getElementById('btn-prev'),
      playBtn: document.getElementById('btn-play'),
      nextBtn: document.getElementById('btn-next'),
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
    // Web target: tab/system audio sharing only works in desktop Chromium
    // browsers; Safari & Firefox never return an audio track, so we block them
    // up front rather than let the share picker silently no-op.
    let webBlocked = false;
    if (desktop) {
      const subs = {
        darwin: 'to everything playing on this mac',
        win32: 'to everything playing on this pc',
        linux: 'to everything playing on this machine',
      };
      ui.systemBtn.querySelector('.sub').textContent =
        subs[window.orphic.platform] || 'to everything playing on this device';
    } else {
      const nudge = document.getElementById('overlay-nudge');
      const uaData = navigator.userAgentData;
      const chromium = uaData && Array.isArray(uaData.brands)
        ? uaData.brands.some(b => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand))
        : /\bChrome\//.test(navigator.userAgent) || /\bChromium\//.test(navigator.userAgent);

      if (chromium) {
        // works here — but still steer toward the native app for real
        // whole-system audio and the smoother, picker-free experience
        nudge.innerHTML =
          'For whole-system audio (no tab picker) and the best experience, get the <b>desktop app</b>.';
        nudge.hidden = false;
      } else {
        webBlocked = true;
        ui.systemBtn.disabled = true;
        ui.systemBtn.querySelector('.cta-label').textContent = 'audio sharing unavailable';
        ui.systemBtn.querySelector('.sub').textContent = "this browser can't share audio";
        nudge.classList.add('error');
        nudge.innerHTML =
          "Safari and Firefox don't let a page capture audio, so ORPHIC can't hear anything here. " +
          '<b>Open this page in Chrome</b>, or download the desktop app for full system audio.';
        nudge.hidden = false;
      }
    }

    let toastTimer = 0;
    function showToast(msg, seconds) {
      ui.toast.textContent = msg;
      ui.toast.classList.remove('hidden');
      clearTimeout(toastTimer);
      if (seconds) toastTimer = setTimeout(hideToast, seconds * 1000);
    }
    function hideToast() {
      ui.toast.classList.add('hidden');
    }

    // a GPU reset silently freezes WebGL while audio keeps running — pause
    // the loop and reload once the browser hands the context back
    let contextLost = false;
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault(); // required, or the context is never restored
      contextLost = true;
      showToast('graphics device reset — recovering…');
    });
    canvas.addEventListener('webglcontextrestored', () => location.reload());

    // the pattern count in the copy is derived — scenes self-register
    const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six',
      'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
      'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
    for (const el of document.querySelectorAll('.pattern-count')) {
      el.textContent = (COUNT_WORDS[M.scenes.length] || M.scenes.length) + ' patterns';
    }

    // ---- system transport (desktop only) ----
    // The buttons drive whatever player the OS is running — ORPHIC just
    // visualizes it, so a web page has nothing to send these commands to.
    const media = desktop && window.orphic.media ? window.orphic.media : null;
    // No player API can tell us play/pause state across apps; infer it from
    // the captured signal instead. A press flips the icon optimistically and
    // holds it briefly so the dying/arriving audio can't fight the flip.
    let mediaPlaying = false, mediaSilence = 0, mediaHold = 0;
    function setPlayingUi(p) {
      if (p === mediaPlaying) return;
      mediaPlaying = p;
      ui.playBtn.classList.toggle('playing', p);
    }
    function mediaSend(cmd) {
      if (!media) return;
      if (cmd === 'playpause') {
        setPlayingUi(!mediaPlaying);
        mediaHold = 1.6;
        mediaSilence = mediaPlaying ? 0 : 99;
      }
      media(cmd).then(res => {
        if (res && res.ok === false && res.hint) showToast(res.hint, 6);
      }).catch(() => {});
    }
    if (media) {
      ui.mediaGroup.hidden = false;
      for (const el of document.querySelectorAll('.desktop-only')) el.hidden = false;
      ui.prevBtn.addEventListener('click', () => mediaSend('previous'));
      ui.playBtn.addEventListener('click', () => mediaSend('playpause'));
      ui.nextBtn.addEventListener('click', () => mediaSend('next'));
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

    // luminous mote cursor — created after the shot/test early-returns so
    // captures never include it; fed from the render loop further down
    const cursor = M.createCursor ? M.createCursor() : null;

    let active = null, activeIdx = -1;
    let pendingIdx = -1; // switch requested mid-transition — applied when it lands
    const trans = new M.Transition(glc);
    let autoCycle = true;
    let cycleTimer = 0;
    const CYCLE_SECONDS = 45;
    let lastT = performance.now() / 1000;
    let hudFade = 0;
    let hudBeatHeld = false;
    // last-written HUD values: DOM writes (even no-op textContent/className
    // assignments) invalidate style every frame — only write on change
    let hudMode = '', hudBpm = '', hudCycle = -1;

    // relative navigation steps from where we're headed, not where we are —
    // pressing next twice mid-blend must advance two scenes, not one
    function targetIdx() { return pendingIdx >= 0 ? pendingIdx : activeIdx; }

    function hudScene(idx) {
      const defs = M.scenes;
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
    }

    function setScene(idx, why) {
      const defs = M.scenes;
      if (!defs.length) return;
      idx = ((idx % defs.length) + defs.length) % defs.length;
      if (trans.running) {
        // mid-blend: flush the current dissolve fast and queue this switch —
        // rapid presses just retarget the queue, skipping intermediates
        pendingIdx = idx === activeIdx ? -1 : idx;
        if (pendingIdx >= 0) trans.hurry();
        hudScene(idx);
        cycleTimer = 0;
        return;
      }
      if (idx === activeIdx) return;
      let incoming;
      try {
        incoming = defs[idx].create(glc);
      } catch (err) {
        // a pattern that fails to build (e.g. a driver-specific shader bug)
        // must not corrupt the active one — stay put, let the cycle move on
        console.error('pattern failed to create: ' + defs[idx].name, err);
        cycleTimer = 0;
        return;
      }
      if (active) trans.start(active); // outgoing scene lives on in the blender
      activeIdx = idx;
      active = incoming;
      if (active.resize) active.resize(glc.width, glc.height);
      hudScene(idx);
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
    // right-click anywhere browses patterns — no OS context menu in a stage app
    window.addEventListener('contextmenu', e => {
      e.preventDefault();
      togglePanel();
    });
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
      if (starting || webBlocked) return;
      starting = true;
      try {
        await engine.useSystemAudio();
        ui.overlay.classList.add('hidden');
      } catch (err) {
        if (err.name === 'NotAllowedError') return; // user cancelled the picker
        showToast((desktop ? 'system audio unavailable: ' : 'tab audio unavailable: ') + err.message, 8);
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
      // step to the next/prev scene. On the home screen only the idledrive
      // backdrops are browsable, so the menu never lands on a scene that has
      // no idle state; once capturing, every scene is reachable.
      const browse = dir => {
        if (onLanding && idleScenes.length) {
          const n = idleScenes.length;
          const base = Math.max(0, idleScenes.indexOf(targetIdx()));
          setScene(idleScenes[((base + dir) % n + n) % n]);
        } else setScene(targetIdx() + dir);
      };

      if (e.key === 'Enter' || e.key === ' ') {
        // preventDefault also keeps a focused button from double-firing
        e.preventDefault();
        if (onLanding) startSystem();
        else if (panelOpen) { disableAuto(); togglePanel(false); } // pick the highlighted one
        else if (e.key === ' ') setScene(targetIdx() + 1);         // space skips while playing
      }
      else if (e.key === 'ArrowRight' || e.key === 'n') browse(1);
      else if (e.key === 'ArrowLeft' || e.key === 'p') browse(-1);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // with the pattern panel open, vertical arrows step by grid row
        if (!panelOpen) return;
        e.preventDefault(); // don't scroll the panel — selection drives it
        const cols = getComputedStyle(ui.sceneGrid).gridTemplateColumns.split(' ').length;
        setScene(targetIdx() + (e.key === 'ArrowDown' ? cols : -cols));
      }
      else if (e.key === 'j' && media) mediaSend('previous');
      else if (e.key === 'k' && media) mediaSend('playpause');
      else if (e.key === 'l' && media) mediaSend('next');
      else if (e.key === 'a') ui.autoBtn.click();
      else if (e.key === 's') togglePanel();
      else if (e.key === 'Escape') {
        if (panelOpen) togglePanel(false);
        // esc that exits fullscreen must never also kill the session
        else if (!onLanding && !document.fullscreenElement) stopCapture();
      }
      else if (e.key === 'f') toggleFullscreen();
    });
    function toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    }
    canvas.addEventListener('dblclick', toggleFullscreen);

    // mouse wakes the HUD (not on the landing screen — nothing to control yet)
    window.addEventListener('mousemove', () => {
      if (engine.mode === 'none') return;
      hudFade = M.HUD_WAKE_SECONDS;
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
      // the transport is desktop-only — surface it in the design preview too
      ui.mediaGroup.hidden = false;
      for (const el of document.querySelectorAll('.desktop-only')) el.hidden = false;
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
    // synthesize a gentle resting groove. Shared by the landing screen and by
    // the silence fallback in the render loop; its beat never exceeds 0.5, so
    // it animates continuous, level-based motion without firing any BPM-gated
    // action (every scene trigger checks f.beat > 0.9). `gain` (0..1) scales
    // every loudness term so the silence fallback can ease the groove in from a
    // standstill instead of popping; the landing screen calls it at full gain.
    function grooveFeatures(dt, gain = 1) {
      idleT += dt;
      const f = features, t = idleT, g = gain;
      const swell = 0.5 + 0.5 * Math.sin(t * 0.45);                      // ~14 s breath
      const pulse = Math.pow(Math.max(0, Math.sin(t * 3.42)), 6.0);      // soft pulse every ~1.8 s
      f.level = g * (0.28 + 0.16 * swell);
      f.bass = g * (0.26 + 0.22 * swell + 0.18 * pulse);
      f.bassFast = g * 0.45 * pulse;
      f.mid = g * (0.22 + 0.14 * Math.sin(t * 0.31 + 1.2));
      f.treble = g * (0.16 + 0.12 * Math.sin(t * 0.53 + 2.4));
      f.centroid = 0.36 + 0.12 * Math.sin(t * 0.21);
      f.flux = g * (0.015 + 0.012 * swell);
      f.onset = 0;
      f.beat = g * 0.5 * pulse;
      f.beatPhase = (t * 3.42 / (2 * Math.PI)) % 1;
      f.beatConf = 0.15; // below the HUD's display threshold
      f.pitchNorm = 0.4 + 0.15 * Math.sin(t * 0.17);
      f.voiced = 0;
      f.harmonic = g * (0.38 + 0.18 * swell);
      f.percussive = g * 0.35 * pulse;
      f.quiet = 1 - g; f.burst = 0; // eases the quiet-gated effects in with the groove
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
        fd[i] = Math.max(0, Math.min(255, g * v));
      }
      for (let i = 0; i < td.length; i++) {
        const ph = i / td.length * 6.28318 * 12;
        td[i] = g * (0.22 * Math.sin(ph + t * 5) + 0.1 * Math.sin(ph * 2.3 + t * 3.1));
      }
    }

    // landing-screen attract loop: the resting groove plus a slow wander
    // through the photogenic scenes
    function idleDrive(dt) {
      grooveFeatures(dt);
      // wander through the photogenic scenes while idling
      idleCycle += dt;
      if (idleCycle > IDLE_CYCLE_SECONDS && idleScenes.length > 1) {
        idleCycle = 0;
        setScene(idleScenes[idleNext % idleScenes.length]);
        idleNext++;
      }
    }

    // ---- render loop ----
    // mode watcher: lastMode starts at the classifier's default so the first
    // classification after capture doesn't count as a change
    let lastMode = 'music', pendingMode = null, pendingModeT = 0;
    let silenceT = 0;    // seconds the live source has been truly silent
    let silenceGain = 0; // 0..1 ramp of the silence groove fading in
    function frame() {
      requestAnimationFrame(frame);
      if (contextLost) return; // frozen until webglcontextrestored reloads
      const now = performance.now() / 1000;
      let dt = Math.min(0.05, now - lastT);
      lastT = now;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (glc.resize(w, h)) {
        if (active && active.resize) active.resize(w, h);
        trans.resize(w, h);
      }

      features.update(dt);
      classifier.update(dt);
      const idle = engine.mode === 'none';
      if (idle) idleDrive(dt);
      audioTex.update();
      // on the landing screen the idle groove breathes through the cursor too
      if (cursor) cursor.frame(dt, features, classifier.mode);

      // play/pause icon follows the captured signal (with hysteresis), once
      // any post-press hold has expired
      if (media && !idle) {
        mediaHold -= dt;
        if (mediaHold <= 0) {
          mediaSilence = features.rawLevel > 0.02 ? 0 : mediaSilence + dt;
          setPlayingUi(mediaSilence < 1.2);
        }
      }

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

      // mode-aware scene preference: when the input's character changes for
      // good (music ↔ speech ↔ ambient), move off a scene that doesn't suit
      // it — but a scene that fits both modes just stays put
      if (!idle) {
        if (classifier.mode !== lastMode) {
          if (classifier.mode !== pendingMode) { pendingMode = classifier.mode; pendingModeT = 0; }
          pendingModeT += dt;
          if (pendingModeT > 2.5) {
            lastMode = pendingMode;
            pendingMode = null; pendingModeT = 0;
            if (autoCycle && !sceneFits(activeIdx, lastMode)) {
              setScene(pickSceneForMode(lastMode));
            }
          }
        } else { pendingMode = null; pendingModeT = 0; }
      }

      // silence fallback: when a live source goes truly silent, the scenes used
      // as menu backdrops (idleScenes) ease back into the same groove they show
      // on the landing screen instead of going blank — the way they settle when
      // you press escape to the menu. Every other scene hand-builds its own rest
      // state and is left alone. rawLevel/fluxRaw are read from the real input
      // (the groove never writes them), so this can't feed back on itself; the
      // groove's beat stays < 0.9 so no BPM action fires. Applied here, AFTER
      // the media play/pause inference above, so that reads the genuine signal.
      const reallySilent = !idle && features.rawLevel < 0.06 && features.fluxRaw < 0.004;
      silenceT = reallySilent ? silenceT + dt : 0;
      const grooving = silenceT > 0.4 && active && idleScenes.includes(activeIdx);
      if (grooving) {
        silenceGain = Math.min(1, silenceGain + dt / 1.5); // ~1.5 s swell into the groove
        grooveFeatures(dt, silenceGain);
      } else {
        silenceGain = 0; // sound is back: hand straight back to the live signal
      }

      // grooving scenes read as their landing-screen selves, so present them
      // the same 'music' mode the idle attract loop uses
      const audio = { f: features, c: classifier, engine, tex: audioTex, mode: (idle || grooving) ? 'music' : classifier.mode };
      if (!active && M.scenes.length) setScene(idle && idleScenes.length ? idleScenes[0] : 0);
      if (active) {
        if (active.update) active.update(dt, audio, now);
        if (trans.running) {
          // blend outgoing → incoming; chain a queued switch when it lands
          if (trans.frame(dt, active, audio, now) && pendingIdx >= 0) {
            const next = pendingIdx;
            pendingIdx = -1;
            setScene(next);
          }
        } else {
          active.render(null, audio, now);
        }
      }
    }
    requestAnimationFrame(frame);
  });
})();
