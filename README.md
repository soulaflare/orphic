# MYTHOS — audio-reactive generative visualizer

Nine GPU pattern simulations that react live to **music (MP3/WAV/OGG/M4A)** or your
**microphone**, with automatic speech-vs-music detection that re-tunes the visuals
for voice.

## Run it

Just open `index.html` in Chrome, Edge, Firefox or Safari (double-click works —
no server, no build, no dependencies). Then:

- **play a file** — or drag & drop any audio file onto the window
- **use microphone** — live music or speech (grant mic permission)

### Controls

| key | action |
|---|---|
| `←` `→` | previous / next pattern |
| `1`–`9` | jump straight to a pattern (disables auto-cycle) |
| `space` | pause / resume playback |
| `a` | toggle auto-cycle (switches pattern every ~45 s, on a beat) |
| `f` / double-click | fullscreen |
| `h` | hide the HUD entirely |

## The nine patterns

| # | scene | system | reacts how |
|---|---|---|---|
| 1 | **physarum · living network** | Jeff Jones (2010) slime-mold agents, 262k on GPU, 3 competing species | bass → speed, centroid → branching, onsets scatter, beats pull the web inward |
| 2 | **ink nebula · stable fluids** | Jos Stam (1999) fluids + vorticity confinement | beats fire ink-jet rings, onsets side jets, treble adds swirl, speech rides pitch |
| 3 | **turing bloom · reaction-diffusion** | Gray-Scott (Pearson 1993), drifts between mitosis/worms/coral regimes | bass → feed rate, centroid → kill rate, beats stamp seeds on a golden-angle ring |
| 4 | **star river · curl-noise flow** | Bridson (2007) divergence-free curl noise, 262k particles | centroid → turbulence scale, bass → flow speed, onsets detonate respawn rings |
| 5 | **lenia · alien garden** | Bert Chan's continuous cellular automaton (2019) | bass shifts growth optimum, level speeds time, beats sow organisms |
| 6 | **chladni resonance · cymatics** | Chladni plate eigenmodes, three superimposed pairs | mode pairs weighted by bass/mid/treble; beats re-strike the plate |
| 7 | **chaos cathedral · de jong attractor** | Peter de Jong map, 262k iterated particles | beat-synced morphing between known-good parameter sets, bass breathes the camera |
| 8 | **hyperdrive · neon tunnel** | demoscene polar tunnel, synthwave dress | speed rides the loudness phase accumulator, beats launch rings, kick → chromatic aberration |
| 9 | **voice aurora · pitch contour** | live pitch tracking drawn as flowing arcs | speech-only scene: ribbon rides your pitch, sibilance shadows above, consonants spark |

## How it listens

- 4096-bin FFT (Web Audio `AnalyserNode`) → band energies with asymmetric
  attack/release envelopes, AGC-normalized level, spectral centroid / flatness /
  rolloff, half-wave-rectified spectral flux
- onsets via adaptive threshold (mean + 1.6 σ over ~4 s of flux history)
- tempo via autocorrelation of the onset-strength signal; beat phase re-anchors
  on strong onsets and coasts through silent gaps
- pitch via NSDF-style autocorrelation (80–1000 Hz)
- **phase accumulators** — loudness counters that advance faster when the music
  is louder — drive all slow scene motion (no per-frame amplitude jitter)
- speech vs music: syllabic-rate (≈4 Hz) energy modulation, pause ratio,
  voiced/unvoiced alternation, beat confidence — smoothed with hysteresis; the
  HUD badge shows the current decision and scenes re-tune accordingly

Design choices follow the verified findings of a deep research pass (June 2026):
Gray-Scott F/k as the ideal two-scalar audio target (Munafo's xmorphia map),
Lenia for stability under live perturbation (Plantec et al. 2023), envelope-
smoothed + AGC-normalized mappings and phase accumulators over raw values
(Listeningway, Graf-Opara-Barthet 2021 user study), event triggers for beats
and onsets (Patin's 1.3× energy rule lineage), and the IEEE/ACM TASLP 2020
finding that speech traces smooth arcs in time-frequency space — which scene 9
renders literally.

## Developer notes

- WebGL2, classic scripts (no modules) so `file://` works; RGBA16F ping-pong
  buffers via `EXT_color_buffer_float` (graceful RGBA8 fallback)
- `index.html#test` — headless self-test: builds, steps and renders every scene
  once, logs `SCENE OK/FAIL` per scene
- `index.html#shot-N` — drives scene N with synthetic audio (600 sim frames)
  for screenshots
