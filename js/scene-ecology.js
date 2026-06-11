/* ORPHIC scene — LIVING ECOLOGY · neural CA
 * An ecosystem of cellular automata that compete for a shared world. Three
 * species live in the colour channels, sensing their surroundings through a
 * centre-surround kernel (the "neural" perception of a neural CA) that grows
 * each into reticulated colonies and slime-mould fronts. They are locked in a
 * cyclic rock–paper–scissors: red is overrun by green, green by blue, blue by
 * red — so no species ever wins and the territory turns over in slow spiral
 * invasions (May–Leonard cyclic dominance). A shared resource field is drained
 * by growth and regrows slowly, giving the whole ecosystem its breathing
 * cycles of bloom and die-back — the ebb-and-flow Coralai shows when organisms
 * deplete and recover (ALIFE 2024).
 *
 * Audio feeds the world: loud passages pour resource in and the colonies surge
 * out of the dark; bright/percussive content speeds the competition into faster
 * spirals; rests starve the sheet and it recedes to black.
 */
(function () {
  'use strict';
  const M = window.ORPHIC;
  const GRID = 256;

  const HEAD = M.FRAG_HEADER;
  const TEX = `uniform vec2 uTexel;`;

  // scatter sparse colonies of each species; resource starts near full
  const INIT_FRAG = HEAD + M.GLSL_LIB + `
  uniform float uSeed;
  void main() {
    vec3 sp = vec3(0.0);
    for (int k = 0; k < 3; k++) {
      for (int i = 0; i < 7; i++) {
        vec2 h = hash22(vec2(float(i) * 3.7 + float(k) * 51.0, uSeed));
        if (length(vUV - h) < 0.035) sp[k] = 0.9;
      }
    }
    float res = 0.8 + 0.2 * fbm(vUV * 6.0 + uSeed);
    fragColor = vec4(sp, res);
  }`;

  const SIM_FRAG = HEAD + M.GLSL_LIB + TEX + `
  uniform sampler2D uState;
  uniform float uDt, uGrow, uComp, uDiff, uPat, uRegen, uConsume, uInflux, uDecay;
  uniform vec4 uSplat;   // xy pos, z radius, w resource amount
  void main() {
    vec4 c = texture(uState, vUV);
    vec4 l = texture(uState, vUV - vec2(uTexel.x, 0));
    vec4 r = texture(uState, vUV + vec2(uTexel.x, 0));
    vec4 d = texture(uState, vUV - vec2(0, uTexel.y));
    vec4 u = texture(uState, vUV + vec2(0, uTexel.y));
    vec4 near = (l + r + d + u) * 0.25;
    vec4 lap = l + r + d + u - 4.0 * c;
    // far ring (radius 3 texels) for the surround of the perception kernel
    float R = 3.0;
    vec4 f1 = texture(uState, vUV + vec2(R, 0) * uTexel);
    vec4 f2 = texture(uState, vUV - vec2(R, 0) * uTexel);
    vec4 f3 = texture(uState, vUV + vec2(0, R) * uTexel);
    vec4 f4 = texture(uState, vUV - vec2(0, R) * uTexel);
    vec4 far = (f1 + f2 + f3 + f4) * 0.25;
    vec3 dog = near.rgb - far.rgb;       // centre-surround perception

    vec3 sp = c.rgb;
    float res = c.a;

    // a static fertility field: barren sea (black) between habitable islands,
    // so the ecosystem never parks at full coverage
    float fert = smoothstep(0.28, 0.62, fbm(vUV * 2.4 + 11.0));

    vec3 grow = res * sp * (1.0 - sp) * uGrow * fert;
    vec3 pred = sp.gbr;                   // cyclic predator: r←g, g←b, b←r
    vec3 comp = -uComp * sp * pred;
    vec3 diff = uDiff * lap.rgb;
    vec3 pattern = uPat * dog;
    // starvation: where resource runs low, colonies die back to bare black
    vec3 death = -uDecay * sp * (0.25 + (1.0 - smoothstep(0.06, 0.4, res)));
    vec3 spn = sp + uDt * (grow + comp + diff + pattern + death);
    spn = clamp(spn, 0.0, 1.4) * smoothstep(0.10, 0.28, fert);  // cull the barren sea

    float total = sp.r + sp.g + sp.b;
    float dres = uRegen * (1.0 - res) - uConsume * total * res + 0.4 * lap.a;
    float resn = res + uDt * dres + uInflux;
    if (uSplat.w > 0.0) {
      float dd = length((vUV - uSplat.xy) * vec2(uTexel.y / uTexel.x, 1.0));
      resn += uSplat.w * smoothstep(uSplat.z, uSplat.z * 0.3, dd);
    }
    fragColor = vec4(spn, clamp(resn, 0.0, 1.5));
  }`;

  const SHOW_FRAG = HEAD + M.GLSL_LIB + M.GLSL_AUDIO + TEX + `
  uniform sampler2D uState;
  uniform float uKeyHue, uRes;
  void main() {
    vec4 c = texture(uState, vUV);
    vec3 sp = c.rgb;
    float res = c.a;

    // three vivid organic species colours, keyed to the music
    vec3 cR = pal(uKeyHue + 0.02, vec3(0.65, 0.32, 0.22), vec3(0.55, 0.32, 0.20), vec3(1.0), vec3(0.0, 0.10, 0.20));
    vec3 cG = pal(uKeyHue + 0.40, vec3(0.24, 0.58, 0.42), vec3(0.30, 0.48, 0.34), vec3(1.0), vec3(0.0, 0.15, 0.30));
    vec3 cB = pal(uKeyHue + 0.68, vec3(0.34, 0.36, 0.66), vec3(0.34, 0.34, 0.52), vec3(1.0), vec3(0.0, 0.10, 0.25));
    vec3 col = (sp.r * cR + sp.g * cG + sp.b * cB) * 1.5;

    // colony relief from the total-density gradient
    float tl = dot(texture(uState, vUV - vec2(uTexel.x, 0)).rgb, vec3(1.0));
    float tr = dot(texture(uState, vUV + vec2(uTexel.x, 0)).rgb, vec3(1.0));
    float td = dot(texture(uState, vUV - vec2(0, uTexel.y)).rgb, vec3(1.0));
    float tu = dot(texture(uState, vUV + vec2(0, uTexel.y)).rgb, vec3(1.0));
    vec2 g = vec2(tr - tl, tu - td);
    vec3 n = normalize(vec3(-g * 4.0, 1.0));
    float diff = max(dot(n, normalize(vec3(0.4, 0.5, 0.8))), 0.0);
    col *= 0.5 + diff * 0.9;

    // bright bioluminescent invasion fronts where species collide
    float front = smoothstep(0.09, 0.45, length(g));
    col += (col + 0.25) * front * (1.1 + uBeat * 1.1 + uTreble * 0.7);

    // faint resource shimmer in the empty dark (the world breathing)
    float life = clamp(sp.r + sp.g + sp.b, 0.0, 1.0);
    col += vec3(0.015, 0.025, 0.045) * res * (1.0 - life);

    col *= 0.9 + uLevel * 0.5;
    col *= 1.0 - uQuiet * 0.25;
    fragColor = vec4(min(col, vec3(8.0)), 1.0);   // linear HDR for the bloom pass
  }`;

  const POST_FRAG = HEAD + M.GLSL_LIB + M.GLSL_AUDIO + `
  uniform sampler2D uScene, uBloom;
  uniform vec2 uRes;
  void main() {
    vec3 c = texture(uScene, vUV).rgb + texture(uBloom, vUV).rgb * (0.6 + uLevel * 0.5);
    float vg = length(vUV - 0.5);
    c *= 1.0 - vg * vg * 0.7;
    c += (hash12(vUV * uRes) - 0.5) / 255.0;
    fragColor = vec4(aces(c), 1.0);
  }`;

  M.registerScene({
    name: 'living ecology · neural ca',
    modes: ['music', 'ambient'],
    create(glc) {
      const state = glc.pingpong(GRID, GRID);
      let scene = null;
      const bloom = M.makeBloom(glc, { div: 3, passes: 2 });
      const pInit = glc.program(INIT_FRAG);
      const pSim = glc.program(SIM_FRAG);
      const pShow = glc.program(SHOW_FRAG);
      const pPost = glc.program(POST_FRAG);
      const texel = [1 / GRID, 1 / GRID];
      let keyHue = 0.1;
      let beatCount = 0;

      function seed() {
        pInit.use().f('uSeed', Math.random() * 100);
        glc.draw(pInit, state.read);
      }
      seed();

      return {
        resize(w, h) {
          if (!scene) scene = glc.target(w, h);
          else scene.resize(w, h);
          bloom.resize(w, h);
        },
        update(dt, audio, t) {
          const f = audio.f;
          keyHue = M.chromaHue(f.chroma, keyHue, dt);

          const grow = 0.9 + f.level * 0.8;
          const comp = 1.1 + f.centroid * 0.9 + f.treble * 0.5;  // bright = faster spirals
          // resource pours in with loudness, dries up in rests → die-back to black
          const influx = (0.0016 + f.level * 0.011) * (1.0 - f.quiet);
          const decay = 0.10 + f.quiet * 0.35;
          let splat = [0, 0, 0, 0];
          if (f.burst === 1) {
            splat = [0.5, 0.5, 0.14, 0.5];
          } else if (f.beat > 0.9) {
            beatCount++;
            const ang = beatCount * 2.399963;
            splat = [0.5 + Math.cos(ang) * 0.32, 0.5 + Math.sin(ang) * 0.32,
                     0.05 + f.bass * 0.05, 0.3 + f.bassFast * 0.3];
          }

          const STEPS = 2;
          for (let s = 0; s < STEPS; s++) {
            pSim.use().v2('uTexel', texel[0], texel[1])
              .f('uDt', 0.16).f('uGrow', grow).f('uComp', comp)
              .f('uDiff', 0.09).f('uPat', 0.13)
              .f('uRegen', 0.05).f('uConsume', 0.6).f('uDecay', decay)
              .f('uInflux', s === 0 ? influx : 0)
              .v4('uSplat', splat[0], splat[1], splat[2], s === 0 ? splat[3] : 0)
              .tex('uState', state.read.tex, 0);
            glc.draw(pSim, state.write);
            state.swap();
          }
        },
        render(out, audio, t) {
          if (!scene) return;
          pShow.use().v2('uTexel', texel[0], texel[1])
            .f('uKeyHue', keyHue).f('uRes', glc.height)
            .tex('uState', state.read.tex, 0);
          M.audioUniforms(pShow, audio, t);
          glc.draw(pShow, scene);

          bloom.render(scene.tex, glc.width, glc.height, 0.6);

          pPost.use().v2('uRes', glc.width, glc.height)
            .tex('uScene', scene.tex, 0).tex('uBloom', bloom.tex, 1);
          M.audioUniforms(pPost, audio, t);
          glc.draw(pPost, out);
        },
        dispose() {
          state.dispose();
          if (scene) scene.dispose();
          bloom.dispose();
          for (const p of [pInit, pSim, pShow, pPost]) p.dispose();
        },
      };
    },
  });
})();
