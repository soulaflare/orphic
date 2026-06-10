/* ORPHIC — preload
 * Minimal bridge. The renderer needs to know that it is running inside the
 * desktop shell (where system-audio loopback is native) and on which OS, and
 * gets one verb: media(cmd) to drive the OS media player's transport.
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('orphic', {
  isElectron: true,
  platform: process.platform,
  media: (cmd: string) => ipcRenderer.invoke('media:command', cmd),
})
