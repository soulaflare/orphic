---
name: run-orphic
description: Run, drive, screenshot, and test ORPHIC (the audio visualizer). Use when asked to run the app, watch or screenshot a scene, verify a visual change, test all scenes, or capture how a scene evolves over time.
---

ORPHIC is an audio-reactive WebGL visualizer: a plain-JS renderer (`js/`,
loads from `file://`) inside an Electron shell. Agents drive it through
`.claude/skills/run-orphic/driver.cjs`, which runs the app in an
**offscreen** Electron window — no visible window, no display server
needed (verified on macOS; the repo's own Electron binary does the
rendering).

All paths are relative to the repo root.

## Setup

```bash
npm install   # repo's Electron is the only thing the driver needs
```

## Run (agent path)

Three subcommands. Electron/Chromium writes `[pid:...]` log noise to
stderr — filter with `grep -v "^\["`.

**Watch a scene evolve** (the main tool for visual verification).
Runs scene N with synthetic music (beats, bass, level) for a number of
*simulated* seconds, saving a PNG every 10 sim-seconds:

```bash
npx electron .claude/skills/run-orphic/driver.cjs shot lenia 30 2>&1 | grep -v "^\["
# scene 4 (lenia) for 30 sim-seconds
# saved /tmp/orphic-shots/04-lenia-t010.png
# saved /tmp/orphic-shots/04-lenia-t020.png
# saved /tmp/orphic-shots/04-lenia-t030.png
```

Scene = index or unique name substring (ambiguity prints the full
indexed list). Optional third arg overrides the output dir. Wall-clock
runs ~8x faster than sim time. **Read the PNGs** — a black frame at
t≥20 usually means the simulation died, not that nothing rendered.

**Smoke-test every scene** (compile + one update/render, GL error check):

```bash
npx electron .claude/skills/run-orphic/driver.cjs test 2>&1 | grep -v "^\["
# SCENE OK: ... x16, TEST DONE: 16 scenes — exit 0 iff no FAIL
```

**Drive the real app** (home screen + idle attract mode; line-based
commands on stdin, safe to pipe — commands queue until the page is
ready):

```bash
{ echo "ss /tmp/orphic-shots/home.png"; sleep 2
  echo "key ArrowRight"; sleep 3
  echo "ss /tmp/orphic-shots/next-scene.png"
  echo "eval ORPHIC.scenes.length"
  echo "quit"; } | npx electron .claude/skills/run-orphic/driver.cjs repl 2>&1 | grep -v "^\["
```

| command | what it does |
|---|---|
| `ss [file]` | screenshot → file (default `/tmp/orphic-shots/repl.png`) |
| `key <key>` | keydown to the app: `ArrowRight`/`ArrowLeft` scene, `s` panel, `h` HUD |
| `eval <js>` | run JS in the page, prints JSON result |
| `quit` | exit |

The driver prints `READY` once loaded and `ACK <cmd>` after each command.

## Run (human path)

Open the Electron app via electron-vite (`npm run dev`-style scripts in
`package.json`) or open `index.html` directly in a browser — the
renderer is dependency-free. Audio capture needs a real user gesture +
OS permission, so it's human-only.

## Hacking on a scene

`index.html#shot-N-SECS` is the underlying app mode the driver uses
(`#shot-4-30` = lenia, 30 sim-seconds; default 10). It logs `SHOT T
<frames>` every 600 frames and `SHOT READY` at the end. For
scene-internal telemetry while debugging, add a temporary
`console.log('LENIA ...')` in the scene's `update()` and grep the
driver output for it — page console flows through to stdout.

## Gotchas

- **Offscreen + `backgroundThrottling: false` are both required.** A
  plain hidden window suspends `requestAnimationFrame` and the render
  loop never ticks; offscreen without the flag throttles too.
- **No real audio headless.** `shot` mode's synthetic features are the
  only way to see music-reactive behavior. In `repl` mode the app sits
  in idle attract mode; do **not** send `key Enter` / `key " "` — they
  trigger the system-audio capture flow, which needs OS permission UI.
- **`capturePage()` before first paint throws `UnknownVizError`.** The
  driver already gates on `did-finish-load` + 1.5s; if you write your
  own capture code, do the same.
- **Shot mode forces `dpr=1`** and sizes the sim to the window
  (1440×880), so on-screen feature sizes are ~2x larger relative to a
  real retina fullscreen run. Judge structure and dynamics, not pixels.
- **Runs are not reproducible** — scene seeds use `Math.random()`.
  Marginal behaviors (e.g. a Lenia die-off) can differ run to run; do
  two runs before declaring something fixed.
- **`console-message` event shape varies across Electron versions**
  (positional args vs event object). The driver normalizes; copy
  `onConsole()` if you build on it.

## Troubleshooting

- **`TIMEOUT` / exit 3**: the page never emitted its done-marker —
  usually a JS error before the loop started. Re-run without the
  `grep` filter and look for the stack trace in the noise.
- **`scene "f" matched 3: 0=physarum 1=fluid ...`** (exit 2): name
  substring not unique; the error lists all 16 `index=name` pairs —
  use the index.
