/* ORPHIC agent driver — runs the app in an offscreen Electron window
 * (no visible window, no xvfb needed on macOS) and exposes three modes:
 *
 *   npx electron .claude/skills/run-orphic/driver.cjs test
 *     → runs the app's #test self-test (compile+run every scene once),
 *       prints SCENE OK/FAIL lines, exit 0 iff all scenes pass.
 *
 *   npx electron .claude/skills/run-orphic/driver.cjs shot <scene> [secs] [outdir] [silent]
 *     → runs scene <scene> (index, or unique name substring) in #shot mode
 *       with synthetic audio for [secs] simulated seconds (default 10),
 *       saving a PNG every 10 sim-seconds to [outdir] (default /tmp/orphic-shots).
 *       Add the word `silent` to drive the scene's quiet/idle path instead of
 *       synthetic music — the only way to verify silent-mode looks.
 *
 *   npx electron .claude/skills/run-orphic/driver.cjs repl
 *     → loads the real app (idle attract mode — no audio source headless)
 *       and reads commands from stdin, one per line:
 *         ss [file]    capture a screenshot (default /tmp/orphic-shots/repl.png)
 *         key <key>    dispatch a keydown to the app (ArrowRight, n, s, h, ...)
 *         eval <js>    run JS in the page, print the JSON-ified result
 *         quit         exit
 *       Prints READY when the app is loaded and ACK after each command.
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..', '..', '..');
const INDEX = 'file://' + path.join(APP_ROOT, 'index.html');
const [, , mode = 'test', ...args] = process.argv;

// scene order = <script src="js/scene-*.js"> order in index.html
function sceneList() {
  const html = fs.readFileSync(path.join(APP_ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/js\/scene-(?!utils)([a-z-]+)\.js/g)].map(m => m[1]);
}

function resolveScene(arg) {
  const scenes = sceneList();
  if (/^\d+$/.test(arg)) return { idx: +arg, name: scenes[+arg] || '?' };
  const hits = scenes.map((n, i) => [n, i]).filter(([n]) => n.includes(arg));
  if (hits.length !== 1) {
    console.error(`scene "${arg}" matched ${hits.length}: ` +
      scenes.map((n, i) => `${i}=${n}`).join(' '));
    app.exit(2); // process.exit() is swallowed in the Electron main process
    throw new Error('ambiguous scene');
  }
  return { idx: hits[0][1], name: hits[0][0] };
}

function makeWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 880, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(60);
  win.webContents.on('render-process-gone', (e, d) => {
    console.error('renderer gone:', d && d.reason);
    process.exit(2);
  });
  return win;
}

// 'console-message' changed shape across Electron versions:
// old: (event, level, message, ...) — new: (event{message}, ...)
function onConsole(win, fn) {
  win.webContents.on('console-message', (e, ...rest) => {
    const msg = typeof e === 'object' && e.message !== undefined ? e.message : rest[1];
    if (typeof msg === 'string') fn(msg);
  });
}

async function capture(win, file) {
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, img.toPNG());
  console.log('saved ' + file);
}

app.whenReady().then(() => {
  const win = makeWindow();
  let chain = Promise.resolve(); // serialize async captures

  if (mode === 'test') {
    let fails = 0;
    onConsole(win, msg => {
      if (msg.startsWith('SCENE') || msg.startsWith('TEST')) console.log(msg);
      if (msg.startsWith('SCENE FAIL')) fails++;
      if (msg.startsWith('TEST DONE')) app.exit(fails ? 1 : 0);
      if (msg.startsWith('TEST ABORT')) app.exit(1);
    });
    win.loadURL(INDEX + '#test');
    setTimeout(() => { console.error('TIMEOUT'); app.exit(3); }, 60000);

  } else if (mode === 'shot') {
    // a `silent` token anywhere drives the scene's quiet/idle path (no level,
    // no onsets, quiet=1, empty spectrum) so silent-mode looks can be verified
    const silent = args.includes('silent');
    const pos = args.filter(a => a !== 'silent');
    const { idx, name } = resolveScene(pos[0] ?? '0');
    const secs = Math.max(10, +(pos[1] || 10));
    const outdir = pos[2] || '/tmp/orphic-shots';
    const label = f => `${outdir}/${String(idx).padStart(2, '0')}-${name}-t${String(f / 60).padStart(3, '0')}.png`;
    console.log(`scene ${idx} (${name}) for ${secs} sim-seconds`);
    onConsole(win, msg => {
      const t = msg.match(/^SHOT T (\d+)$/);
      if (t) chain = chain.then(() => capture(win, label(+t[1])));
      else if (msg.startsWith('SHOT READY')) {
        chain = chain.then(() => capture(win, label(secs * 60)))
          .then(() => app.exit(0));
      } else console.log('PAGE: ' + msg); // scene debug telemetry flows through
    });
    win.loadURL(`${INDEX}#shot-${idx}-${secs}${silent ? '-q' : ''}`);
    // shot mode runs ~8 sim-frames per rAF tick → ~8x faster than real time
    setTimeout(() => { console.error('TIMEOUT'); app.exit(3); }, 30000 + secs * 4000);

  } else if (mode === 'repl') {
    // gate all commands on load + first paint: piped stdin arrives instantly,
    // and capturePage on an unpainted offscreen window throws UnknownVizError
    chain = new Promise(resolve => win.webContents.once('did-finish-load', () =>
      setTimeout(() => { console.log('READY'); resolve(); }, 1500)));
    win.loadURL(INDEX);
    const rl = require('readline').createInterface({ input: process.stdin });
    rl.on('line', line => {
      const [cmd, ...rest] = line.trim().split(/\s+/);
      const arg = rest.join(' ');
      chain = chain.then(async () => {
        if (cmd === 'ss') await capture(win, arg || '/tmp/orphic-shots/repl.png');
        else if (cmd === 'key') await win.webContents.executeJavaScript(
          `window.dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(arg)}}))`);
        else if (cmd === 'eval') console.log(JSON.stringify(
          await win.webContents.executeJavaScript(arg).catch(e => 'ERR ' + e.message)));
        else if (cmd === 'quit') app.exit(0);
        else if (cmd) console.log('unknown command: ' + cmd);
        if (cmd && cmd !== 'quit') console.log('ACK ' + cmd);
      }).catch(e => console.error('ERR', e.message));
    });
    rl.on('close', () => chain.then(() => app.exit(0)));

  } else {
    console.error('usage: electron driver.cjs test | shot <scene> [secs] [outdir] [silent] | repl');
    app.exit(2);
  }
});
