/* ORPHIC — scene transition compositor
 * On a scene switch the outgoing scene stays alive: both scenes render to
 * offscreen targets and a composite shader blends them with an organic,
 * audio-reactive dissolve. The mask is keyed on swirling fbm noise plus the
 * outgoing frame's own luminance — the new scene blooms in through the dark
 * negative space first while the old scene's bright cores hold longest, so
 * every scene pair dissolves differently. A luminous seam rides the front
 * (flaring on beats, widened by bass) and the old image heat-shimmers where
 * it's being consumed. Generic over any pair — scenes honor render(out).
 */
(function () {
  'use strict';
  const M = window.ORPHIC = window.ORPHIC || {};

  const DURATION = 1.6; // seconds — long enough to read, never lingers

  const FRAG = M.FRAG_HEADER + M.GLSL_AUDIO + M.GLSL_LIB + `
  uniform sampler2D uOld, uNew;
  uniform float uProg, uAspect;

  void main() {
    float p = uProg;
    vec2 c = vUV - 0.5;
    // parting motion: old drifts toward the viewer as it burns away, new
    // settles back into place — both stay sampled inside [0,1]
    vec2 oldUV = 0.5 + c * (1.0 - 0.055 * p);
    vec2 newUV = 0.5 + c * (1.0 - 0.045 * (1.0 - p));

    float lum = dot(texture(uOld, oldUV).rgb, vec3(0.299, 0.587, 0.114));

    // dissolve key: animated noise + the old frame's luminance — the new
    // scene seeps in through darkness first, bright cores resist
    vec2 q = c * vec2(uAspect, 1.0);
    float n = fbm(q * 2.6 + vec2(uTime * 0.16, -uTime * 0.12));
    n = n * 0.8 + 0.33 * fbm(q * 6.4 + vec2(-uTime * 0.21, uTime * 0.27));
    float key = mix(n, clamp(lum * 1.5, 0.0, 1.0), 0.38);

    float edge = 0.10 + 0.08 * uBass;            // bass widens the ragged front
    float th = mix(-edge + 0.06, 1.0 + edge + 0.08, p) + 0.05 * uBeat;
    float m = smoothstep(-edge, edge, th - key);  // 1 = new scene visible

    // heat-shimmer where the front is consuming the old image
    float s = 1.0 - min(abs(th - key) / (edge + 0.04), 1.0);
    float a = n * 12.0 + uTime * 2.0;
    vec3 oldC = texture(uOld, oldUV + s * 0.018 * vec2(cos(a), sin(a))).rgb;
    vec3 newC = texture(uNew, newUV).rgb;

    vec3 col = mix(oldC * (1.0 - 0.20 * p), newC, m);
    // luminous seam riding the dissolve front, flaring on beats — the faint
    // floor keeps a visible filament sweeping through even black-on-black
    float gain = s * s * (0.30 + 0.45 * uBassFast + 0.55 * uBeat);
    col += (newC * 0.8 + oldC * 0.3 + 0.045) * gain;
    fragColor = vec4(col, 1.0);
  }`;

  class Transition {
    constructor(glc) {
      this.glc = glc;
      this.prog = glc.program(FRAG);
      this.A = null; this.B = null; // byte targets: scenes tonemap to 0-1
      this.old = null;              // outgoing scene — owned here once started
      this.p = 0;
      this.rate = 1;
    }
    get running() { return !!this.old; }
    start(oldScene) {
      if (this.old && this.old.dispose) this.old.dispose();
      this.old = oldScene;
      this.p = 0;
      this.rate = 1;
    }
    /** A queued switch flushes the current blend fast instead of lingering. */
    hurry() { this.rate = 4; }
    resize(w, h) {
      if (this.A) { this.A.resize(w, h); this.B.resize(w, h); }
      if (this.old && this.old.resize) this.old.resize(w, h);
    }
    /** Advance and draw one blended frame to the screen (the incoming scene
     *  is updated by the caller; the outgoing is updated here). Returns true
     *  on the frame the transition completes. */
    frame(dt, incoming, audio, t) {
      const glc = this.glc;
      this.p += dt * this.rate / DURATION;
      if (this.p >= 1) {
        if (this.old.dispose) this.old.dispose();
        this.old = null;
        incoming.render(null, audio, t);
        return true;
      }
      if (!this.A) {
        this.A = glc.target(glc.width, glc.height, { byte: true });
        this.B = glc.target(glc.width, glc.height, { byte: true });
      } else {
        this.A.resize(glc.width, glc.height);
        this.B.resize(glc.width, glc.height);
      }
      if (this.old.update) this.old.update(dt, audio, t);
      // fresh sims are born with empty buffers — run extra steps early in
      // the blend so content has developed by the time it's revealed
      if (this.p < 0.35 && incoming.update) {
        incoming.update(dt, audio, t);
        incoming.update(dt, audio, t);
      }
      this.old.render(this.A, audio, t);
      incoming.render(this.B, audio, t);
      // ease-out: the front moves the instant you switch, settles gracefully
      const e = 1 - Math.pow(1 - this.p, 1.7);
      this.prog.use()
        .tex('uOld', this.A.tex, 0)
        .tex('uNew', this.B.tex, 1)
        .f('uProg', e)
        .f('uAspect', glc.width / glc.height);
      M.audioUniforms(this.prog, audio, t);
      glc.draw(this.prog, null);
      return false;
    }
  }

  M.Transition = Transition;
})();
