/* ORPHIC — Electron main process
 * Serves the renderer over a hardened custom scheme and answers system-audio
 * capture requests with the OS loopback device on every platform:
 *   Windows  — WASAPI loopback (built into Chromium)
 *   macOS    — CoreAudio process taps, macOS 14.2+ (default since Electron 39)
 *   Linux    — PulseAudio/PipeWire monitor source (feature-flagged below)
 */
import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { MEDIA_COMMANDS, sendMediaCommand, type MediaCommand, type MediaResult } from './media'

const APP_SCHEME = 'orphic'
const APP_ORIGIN = `${APP_SCHEME}://app`

/** `npm run test:smoke` — loads the renderer's #test self-check, which
 * compiles and renders every scene once, then exits with a pass/fail code.
 * The --smoke flag exists because `VAR=1 cmd` env syntax doesn't run on
 * Windows shells. */
const isSmokeTest = process.env.ORPHIC_SMOKE === '1' || process.argv.includes('--smoke')

// Linux is unofficial (untested) but kept working: PulseAudio loopback is
// still behind a default-off feature flag (Chromium 148, June 2026), and
// Wayland sessions need the PipeWire capturer to enumerate a screen source —
// without one the display-media handler can't attach the loopback audio.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch(
    'enable-features',
    'PulseaudioLoopbackForScreenShare,WebRTCPipeWireCapturer',
  )
}

// Never let Chromium claim the hardware media keys: ORPHIC only listens,
// and play/next/previous must keep driving the user's real player.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling')

// Registered before app ready so orphic:// behaves like a standard origin
// (relative URL resolution, fetch, streaming media).
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

// The renderer is fully local — no remote content of any kind.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
].join('; ')

function registerAppProtocol(): void {
  const root = app.getAppPath()
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      // decodeURIComponent throws on malformed escapes; net.fetch rejects on
      // missing files — both must answer with a response, not a net error
      const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html'
      const file = path.resolve(root, rel)
      if (!file.startsWith(root + path.sep)) {
        return new Response('Forbidden', { status: 403 })
      }
      const res = await net.fetch(pathToFileURL(file).toString())
      const headers = new Headers(res.headers)
      headers.set('Content-Security-Policy', CSP)
      // never cache renderer assets: they're plain classic scripts read off
      // disk, so a window reload must always pick up the latest edit
      headers.set('Cache-Control', 'no-store')
      return new Response(res.body, { status: res.status, headers })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}

function hardenSession(ses: Electron.Session): void {
  // getDisplayMedia from the renderer lands here: skip any picker UI and
  // answer with OS loopback audio alone. Never attach a screen video source —
  // on macOS that drags in the Screen Recording permission (a System Settings
  // trip), while audio-only loopback needs just the one-click "System Audio
  // Recording Only" consent.
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    callback({ audio: 'loopback' })
  })

  // Only what the visualizer needs: mic, system-audio capture, fullscreen.
  const allowed = new Set(['media', 'display-capture', 'fullscreen'])
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission))
  })
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
}

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#030208',
    title: 'ORPHIC',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // keep rendering at full rate when the window is occluded or minimized
      backgroundThrottling: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // a crashed renderer must not leave a permanently blank window
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || details.reason === 'killed') return
    console.error(`[main] renderer gone (${details.reason}) — reloading`)
    win.webContents.reload()
  })

  // Local-only app: never open child windows or navigate off-origin.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) event.preventDefault()
  })

  void win.loadURL(`${APP_ORIGIN}/index.html${isSmokeTest ? '#test' : ''}`)
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  return win
}

function runSmokeTest(win: BrowserWindow): void {
  const timeout = setTimeout(() => {
    console.error('[smoke] timed out waiting for the scene self-test')
    app.exit(2)
  }, 30_000)
  let failures = 0
  win.webContents.on('console-message', (event) => {
    console.log(`[renderer] ${event.message}`)
    if (event.message.includes('SCENE FAIL')) failures += 1
    if (event.message.startsWith('TEST DONE') || event.message.startsWith('TEST ABORT')) {
      clearTimeout(timeout)
      app.exit(event.message.startsWith('TEST ABORT') || failures > 0 ? 1 : 0)
    }
  })
}

// Smoke runs are disposable test processes — they must not contend with (or
// silently defer to) a running dev/production instance.
if (!isSmokeTest && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // HUD transport buttons / j-k-l shortcuts → the OS media player
  ipcMain.handle('media:command', (event, cmd: unknown): Promise<MediaResult> | MediaResult => {
    if (!event.senderFrame?.url.startsWith(APP_ORIGIN)) return { ok: false }
    if (typeof cmd !== 'string' || !MEDIA_COMMANDS.has(cmd)) return { ok: false }
    return sendMediaCommand(cmd as MediaCommand)
  })

  app.whenReady().then(() => {
    // System-audio loopback rides CoreAudio process taps, which appeared in
    // macOS 14.2 — on anything older capture is permanently silent, so refuse
    // to run rather than ship a broken-looking app. (Packaged builds also set
    // LSMinimumSystemVersion; this covers dev runs and zip-extracted apps.)
    if (process.platform === 'darwin') {
      const [major = 0, minor = 0] = process.getSystemVersion().split('.').map(Number)
      if (major < 14 || (major === 14 && minor < 2)) {
        dialog.showErrorBox(
          'ORPHIC needs macOS 14.2 or later',
          'System-audio capture uses CoreAudio process taps, introduced in macOS 14.2 (Sonoma). Please update macOS to run ORPHIC.',
        )
        app.exit(1)
        return
      }
    }
    registerAppProtocol()
    hardenSession(session.defaultSession)
    mainWindow = createWindow()
    if (isSmokeTest) runSmokeTest(mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  }).catch((err: unknown) => {
    // a failed startup must not leave a windowless zombie process
    console.error('[main] startup failed:', err)
    app.exit(1)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || isSmokeTest) app.quit()
  })
}
