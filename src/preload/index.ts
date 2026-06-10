/* ORPHIC — preload
 * Minimal, read-only bridge. The renderer only needs to know that it is
 * running inside the desktop shell (where system-audio loopback is native)
 * and on which OS, so it can word UI hints correctly.
 */
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('orphic', {
  isElectron: true,
  platform: process.platform,
})
