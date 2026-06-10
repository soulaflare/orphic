/* ORPHIC — custom cursor
 * The OS arrow over a living canvas breaks the spell. Instead: a bright
 * mote that snaps to the hand, inside a halo that trails on a soft spring,
 * stretches with speed, breathes with the music, and blooms into a gradient
 * ring over anything clickable. It has no rAF of its own — main.js drives
 * it from the render loop so it shares the frame's audio features.
 */
(function () {
  'use strict';
  const M = window.ORPHIC = window.ORPHIC || {};

  // shared wake timeout: the cursor sleeps on the HUD's rhythm (main.js)
  M.HUD_WAKE_SECONDS = 3.5;

  M.createCursor = function () {
    // touch / coarse pointers keep the native cursor story
    if (!window.matchMedia || !matchMedia('(pointer: fine)').matches) return null;

    document.documentElement.classList.add('orphic-cursor');
    const root = document.createElement('div');
    root.id = 'cursor';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div id="cursor-halo"><div id="cursor-glow"></div></div>' +
      '<div id="cursor-dot"></div>' +
      '<div id="cursor-ripple"></div>';
    document.body.append(root);
    const halo = root.querySelector('#cursor-halo');
    const glow = root.querySelector('#cursor-glow');
    const dot = root.querySelector('#cursor-dot');
    const ripple = root.querySelector('#cursor-ripple');

    let mx = 0, my = 0;               // pointer — the dot never lags it
    let hx = 0, hy = 0;               // halo — chases on a spring
    let seen = false, inside = true, fade = 0;
    let hot = false, down = false;
    let hoverS = 1, pressS = 1, dotS = 1, beatEnv = 0, angle = 0;
    let lastDot = '', lastHalo = '', lastGlow = -1, lastGone = null, lastSpeech = null;

    window.addEventListener('mousemove', e => {
      mx = e.clientX; my = e.clientY;
      fade = M.HUD_WAKE_SECONDS;
      if (!seen) { seen = true; hx = mx; hy = my; }
    });
    window.addEventListener('mousedown', () => { down = true; fade = M.HUD_WAKE_SECONDS; });
    window.addEventListener('mouseup', e => {
      down = false;
      ripple.style.left = e.clientX + 'px';
      ripple.style.top = e.clientY + 'px';
      ripple.classList.remove('live');
      void ripple.offsetWidth; // restart the one-shot animation
      ripple.classList.add('live');
    });
    // every clickable in the app is a <button>; [data-cursor="hot"] is the
    // opt-in for anything future that isn't
    window.addEventListener('mouseover', e => {
      hot = !!(e.target.closest && e.target.closest('button, a, [data-cursor="hot"]'));
      root.classList.toggle('hot', hot);
    });
    document.addEventListener('mouseleave', () => { inside = false; });
    document.addEventListener('mouseenter', () => { inside = true; });

    function frame(dt, f, mode) {
      fade -= dt;
      const gone = !(seen && inside && fade > 0);
      if (gone !== lastGone) { lastGone = gone; root.classList.toggle('gone', gone); }
      // frozen while hidden — on wake the halo swooshes in from where it slept
      if (gone) return;

      const speech = mode === 'speech';
      if (speech !== lastSpeech) {
        lastSpeech = speech;
        root.classList.toggle('mode-speech', speech);
      }

      // halo spring + squash-and-stretch along its motion
      const k = 1 - Math.exp(-dt * 15);
      const px = hx, py = hy;
      hx += (mx - hx) * k;
      hy += (my - hy) * k;
      const inv = 1 / Math.max(dt, 1e-4);
      const vx = (hx - px) * inv, vy = (hy - py) * inv;
      const speed = Math.hypot(vx, vy);
      if (speed > 60) angle = Math.atan2(vy, vx); // hold heading when still
      const stretch = Math.min(0.32, speed * 0.00038);

      // breathe with the signal, pop on the beat, bloom over clickables
      beatEnv = Math.max(beatEnv * Math.exp(-dt * 5), (f && f.beat) || 0);
      const a = 1 - Math.exp(-dt * 14);
      hoverS += ((hot ? 1.55 : 1) - hoverS) * a;
      pressS += ((down ? 0.78 : 1) - pressS) * a;
      dotS += ((down ? 0.6 : 1) - dotS) * a;
      const s = hoverS * pressS * (1 + 0.15 * beatEnv);

      // skip identical writes — a settled cursor costs nothing
      const dotT = 'translate3d(' + mx + 'px,' + my + 'px,0) scale(' + dotS.toFixed(3) + ')';
      if (dotT !== lastDot) { lastDot = dotT; dot.style.transform = dotT; }
      const haloT = 'translate3d(' + hx.toFixed(2) + 'px,' + hy.toFixed(2) + 'px,0)'
        + ' rotate(' + angle.toFixed(3) + 'rad)'
        + ' scale(' + (s * (1 + stretch)).toFixed(3) + ',' + (s * (1 - stretch * 0.6)).toFixed(3) + ')';
      if (haloT !== lastHalo) { lastHalo = haloT; halo.style.transform = haloT; }
      const g = Math.round((0.25 + 0.6 * Math.min(1, ((f && f.level) || 0) * 1.5)) * 100) / 100;
      if (g !== lastGlow) { lastGlow = g; glow.style.opacity = g; }
    }

    return { frame };
  };
})();
