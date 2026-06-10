/* ORPHIC — system media transport (main process)
 * The visualizer renders whatever the OS is playing, so the HUD's transport
 * buttons command the system's media player, not ORPHIC itself:
 *   macOS   — scripts a running player app (Spotify/Music) via osascript;
 *             otherwise posts a hardware media-key event, which drives
 *             whatever owns the system "Now Playing" (browsers included)
 *   Windows — synthesizes VK_MEDIA_* key events (keybd_event)
 *   Linux   — playerctl when present, raw MPRIS over dbus-send otherwise
 */
import { execFile } from 'node:child_process'

export type MediaCommand = 'playpause' | 'next' | 'previous'
export const MEDIA_COMMANDS: ReadonlySet<string> = new Set(['playpause', 'next', 'previous'])

export interface MediaResult {
  ok: boolean
  /** user-facing toast text when the command could not reach a player */
  hint?: string
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 5000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || '').trim() || err.message))
      else resolve(stdout)
    })
  })
}

/* ---------- macOS ---------- */

// JXA, not AppleScript: the media-key fallback needs the ObjC bridge.
// Scriptable players are tried first because they need no Accessibility
// permission — only a one-time per-app Automation consent.
const MAC_JXA = `
function run(argv) {
  const cmd = argv[0];
  let chosen = null;
  for (const name of ['Spotify', 'Music']) {
    try {
      const app = Application(name);
      if (!app.running()) continue;
      if (!chosen) chosen = app;
      try { if (app.playerState() === 'playing') { chosen = app; break; } } catch (e) {}
    } catch (e) {}
  }
  if (chosen) {
    if (cmd === 'playpause') chosen.playpause();
    else if (cmd === 'next') chosen.nextTrack();
    else chosen.previousTrack();
    return 'app';
  }
  ObjC.import('Cocoa');
  const key = { playpause: 16, next: 19, previous: 20 }[cmd]; // NX_KEYTYPE_PLAY/FAST/REWIND
  for (const flags of [0xa00, 0xb00]) { // key down, key up
    const ev = $.NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(
      14 /* NSEventTypeSystemDefined */, $.CGPointMake(0, 0), flags, 0, 0, 0, 8, (key << 16) | flags, -1);
    $.CGEventPost($.kCGHIDEventTap, ev.CGEvent);
  }
  return 'key';
}`

async function macMedia(cmd: MediaCommand): Promise<MediaResult> {
  try {
    await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_JXA, cmd])
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      hint: msg.includes('-1743')
        ? 'player control needs consent — allow ORPHIC under System Settings → Privacy & Security → Automation'
        : 'couldn’t reach a player — is something playing?',
    }
  }
}

/* ---------- Windows ---------- */

const WIN_VK: Record<MediaCommand, number> = {
  playpause: 0xb3, // VK_MEDIA_PLAY_PAUSE
  next: 0xb0, //      VK_MEDIA_NEXT_TRACK
  previous: 0xb1, //  VK_MEDIA_PREV_TRACK
}

async function winMedia(cmd: MediaCommand): Promise<MediaResult> {
  const vk = '0x' + WIN_VK[cmd].toString(16)
  const ps = [
    '$k = Add-Type -Namespace Orphic -Name Media -PassThru -MemberDefinition ' +
      '\'[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);\'',
    `$k::keybd_event(${vk}, 0, 1, [UIntPtr]::Zero)`, // KEYEVENTF_EXTENDEDKEY
    `$k::keybd_event(${vk}, 0, 3, [UIntPtr]::Zero)`, // … | KEYEVENTF_KEYUP
  ].join('; ')
  try {
    await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps,
    ])
    return { ok: true }
  } catch {
    return { ok: false, hint: 'couldn’t send the media key' }
  }
}

/* ---------- Linux ---------- */

const MPRIS_METHOD: Record<MediaCommand, string> = {
  playpause: 'PlayPause',
  next: 'Next',
  previous: 'Previous',
}

async function linuxMedia(cmd: MediaCommand): Promise<MediaResult> {
  try {
    // playerctl already picks the most recently active player
    const verb = cmd === 'playpause' ? 'play-pause' : cmd
    await run('playerctl', [verb])
    return { ok: true }
  } catch {
    // not installed (or it found nothing) — speak MPRIS directly
  }
  try {
    const names = await run('dbus-send', [
      '--session', '--print-reply', '--dest=org.freedesktop.DBus',
      '/org/freedesktop/DBus', 'org.freedesktop.DBus.ListNames',
    ])
    const players = [...names.matchAll(/"(org\.mpris\.MediaPlayer2\.[^"]+)"/g)].map((m) => m[1])
    if (!players.length) {
      return { ok: false, hint: 'no controllable player found — needs an MPRIS player (spotify, vlc, most browsers)' }
    }
    let target = players[0]
    for (const p of players) {
      // prefer the player that is actually playing when several are open
      try {
        const status = await run('dbus-send', [
          '--session', '--print-reply', `--dest=${p}`, '/org/mpris/MediaPlayer2',
          'org.freedesktop.DBus.Properties.Get',
          'string:org.mpris.MediaPlayer2.Player', 'string:PlaybackStatus',
        ])
        if (status.includes('Playing')) { target = p; break }
      } catch { /* a vanished player must not abort the sweep */ }
    }
    await run('dbus-send', [
      '--session', '--type=method_call', `--dest=${target}`,
      '/org/mpris/MediaPlayer2', `org.mpris.MediaPlayer2.Player.${MPRIS_METHOD[cmd]}`,
    ])
    return { ok: true }
  } catch {
    return { ok: false, hint: 'couldn’t reach a player over mpris — is dbus available?' }
  }
}

export function sendMediaCommand(cmd: MediaCommand): Promise<MediaResult> {
  switch (process.platform) {
    case 'darwin': return macMedia(cmd)
    case 'win32': return winMedia(cmd)
    case 'linux': return linuxMedia(cmd)
    default: return Promise.resolve({ ok: false, hint: 'media keys aren’t supported on this platform' })
  }
}
