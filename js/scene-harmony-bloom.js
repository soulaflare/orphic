/* ORPHIC scene — HARMONY BLOOM · chroma mandala
 * A twelve-petaled flower where each petal is a pitch class: the notes
 * actually sounding swell their petals, so chords are visible shapes (a major
 * triad is a three-armed star, a cluster a ragged bloom). Petal hues sit on
 * the circle of fifths, so consonant harmony reads as related colors. Inside,
 * concentric rings are a frequency ladder lit by the live spectrum — bass at
 * the core, treble at the rim. Beats step the mandala around the golden
 * angle, and a roto-zoom feedback echo blossoms everything outward.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;

  const SCENE_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + M.GLSL_SPECTRUM + `
  uniform vec2 uRes;
  uniform float uSpin, uKeyHue;

  float chromaAt(float a) { // a in turns around the wheel
    float x = fract(a) * 12.0;
    float i = floor(x), f = x - i;
    f = f * f * (3.0 - 2.0 * f);
    return mix(uChroma[int(i)], uChroma[int(mod(i + 1.0, 12.0))], f);
  }

  void main() {
    vec2 uv = (vUV - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.5;
    float r = length(uv);
    float a = atan(uv.y, uv.x) / 6.28318 + 0.5 + uSpin;

    float c = chromaAt(a);
    // idle bloom: with no chord to shape it, a slow wave of openness rolls
    // around the petals on uTime, so in silence the mandala keeps breathing and
    // blooming instead of freezing to a dark bud.
    float cIdle = 0.35 + 0.35 * sin(uTime * 0.5 + fract(a) * 18.849556); // 3 lobes circling the wheel
    c = mix(c, max(c, cIdle), uQuiet);
    float petal = 0.30 - uQuiet * 0.14 + 0.58 * c;
    float pc = floor(fract(a) * 12.0);
    float noteHue = uKeyHue + mod(pc * 7.0, 12.0) / 12.0 * 0.75;
    vec3 noteCol = pal(noteHue, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));

    // glowing petal outline — the chord's silhouette
    vec3 col = noteCol * exp(-abs(r - petal) * 24.0) * (0.4 + c * 1.5);

    // interior frequency ladder: ring radius = log frequency, lit live
    float rr = clamp(r / 1.4, 0.0, 1.0);
    float ring = specLog(rr);
    // idle: a slow breathing ripple lights the interior ladder when silent
    ring = mix(ring, max(ring, (0.45 + 0.4 * sin(rr * 26.0 - uTime * 1.2))
                                * smoothstep(1.0, 0.12, rr)), uQuiet);
    float inside = smoothstep(petal, petal - 0.05, r);
    float lad = 0.45 + 0.55 * pow(abs(sin(rr * 52.0 - uPhaseLevel * 2.0)), 6.0);
    col += pal(uKeyHue + rr * 0.5, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67))
           * ring * ring * inside * lad * 1.3;

    // bass core
    col += noteCol * exp(-r * 6.0) * (0.25 + uBassFast * 1.3);

    // onset sparks scattered with 12-fold symmetry
    float spark = step(0.995, hash12(floor(vec2(fract(a * 12.0), rr) * 64.0) + floor(uTime * 24.0)));
    col += vec3(1.0) * spark * uOnset * 0.7 * inside;

    col *= 1.0 + uBurst * 0.9; // the return makes the whole bloom flash
    fragColor = vec4(col, 1.0);
  }`;

  const FEED_FRAG = M.FRAG_HEADER + `
  uniform sampler2D uScene, uPrev;
  uniform float uDecay, uZoom, uRot, uAspect;
  void main() {
    vec2 c = (vUV - 0.5) * vec2(uAspect, 1.0);
    float cs = cos(uRot), sn = sin(uRot);
    vec2 q = mat2(cs, -sn, sn, cs) * c * uZoom / vec2(uAspect, 1.0) + 0.5;
    vec3 prev = texture(uPrev, q).rgb;
    vec3 cur = texture(uScene, vUV).rgb;
    fragColor = vec4(cur * 0.5 + prev * uDecay, 1.0);
  }`;

  const SHOW_FRAG = M.FRAG_HEADER + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uTex;
  void main() {
    vec3 col = texture(uTex, vUV).rgb * (1.0 + uBeat * 0.2);
    float v = length(vUV - 0.5);
    col *= 1.0 - v * v * 0.8;
    fragColor = vec4(aces(col), 1.0);
  }`;

  M.registerScene({
    name: 'harmony bloom · chroma mandala',
    modes: ['music', 'ambient'],
    create(glc) {
      const pScene = glc.program(SCENE_FRAG);
      const pFeed = glc.program(FEED_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      let sceneT = null, accum = null;
      let keyHue = 0.1, spin = 0, spinTarget = 0, beatLatch = 0;

      return {
        resize(w, h) {
          if (!sceneT) sceneT = glc.target(w, h);
          else sceneT.resize(w, h);
          if (!accum) accum = glc.pingpong(w, h);
          else accum.resize(w, h);
          accum.a.clear(); accum.b.clear();
        },
        update(dt, audio, t) {
          if (!sceneT) return;
          const f = audio.f;
          keyHue = M.chromaHue(f.chroma, keyHue, dt);
          beatLatch -= dt;
          if ((f.beat > 0.9 || f.burst === 1) && beatLatch <= 0) {
            spinTarget += 1 / 24; // golden-ish step per beat
            beatLatch = 0.25;
          }
          spinTarget += dt * 0.025 * f.quiet; // gentle self-rotation while quiet
          spin += (spinTarget - spin) * (1 - Math.exp(-dt * 5));

          pScene.use();
          M.audioUniforms(pScene, audio, t);
          M.spectrumUniforms(pScene, audio, 0);
          pScene.v2('uRes', sceneT.w, sceneT.h)
                .f('uSpin', spin).f('uKeyHue', keyHue);
          glc.draw(pScene, sceneT);

          pFeed.use()
               .f('uDecay', Math.min(0.92, 0.85 + f.treble * 0.08))
               .f('uZoom', 0.984 - f.bass * 0.006)
               .f('uRot', Math.sin(f.phaseLevel * 0.3) * 0.01)
               .f('uAspect', glc.width / glc.height)
               .tex('uScene', sceneT.tex, 0)
               .tex('uPrev', accum.read.tex, 1);
          glc.draw(pFeed, accum.write);
          accum.swap();
        },
        render(out, audio, t) {
          if (!accum) return;
          pShow.use().tex('uTex', accum.read.tex, 0);
          M.audioUniforms(pShow, audio, t);
          glc.draw(pShow, out);
        },
        dispose() {
          if (sceneT) sceneT.dispose();
          if (accum) accum.dispose();
          for (const p of [pScene, pFeed, pShow]) p.dispose();
        },
      };
    },
  });
})();
