/* ORPHIC — Electron main process
 * Serves the renderer over a hardened custom scheme and answers system-audio
 * capture requests with the OS loopback device on every platform:
 *   Windows  — WASAPI loopback (built into Chromium)
 *   macOS    — CoreAudio process taps, macOS 14.2+ (default since Electron 39)
 *   Linux    — PulseAudio/PipeWire monitor source (feature-flagged below)
 */
import { app, BrowserWindow, desktopCapturer, net, protocol, session } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const APP_SCHEME = 'orphic'
const APP_ORIGIN = `${APP_SCHEME}://app`

/** `npm run test:smoke` — loads the renderer's #test self-check, which
 * compiles and renders every scene once, then exits with a pass/fail code. */
const isSmokeTest = process.env.ORPHIC_SMOKE === '1'

// Chromium's PulseAudio loopback capture is still behind a default-off
// feature flag on Linux (Chromium 148, June 2026).
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'PulseaudioLoopbackForScreenShare')
}

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
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html'
    const file = path.resolve(root, rel)
    if (file !== root && !file.startsWith(root + path.sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    const res = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(res.headers)
    headers.set('Content-Security-Policy', CSP)
    return new Response(res.body, { status: res.status, headers })
  })
}

function hardenSession(ses: Electron.Session): void {
  // getDisplayMedia from the renderer lands here: skip any picker UI and
  // answer with the primary screen (a video track is mandatory in the API —
  // the renderer stops it immediately) plus OS loopback audio.
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        const screen = sources[0]
        if (screen) callback({ video: screen, audio: 'loopback' })
        else callback({})
      })
      .catch(() => callback({}))
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

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    registerAppProtocol()
    hardenSession(session.defaultSession)
    mainWindow = createWindow()
    if (isSmokeTest) runSmokeTest(mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || isSmokeTest) app.quit()
  })
}
