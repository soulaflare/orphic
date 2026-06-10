/** Shape of the bridge exposed by src/preload/index.ts.
 * The renderer is plain JS; this exists for documentation and editor hints.
 * In a browser `window.orphic` is undefined — always feature-check it. */
export interface OrphicBridge {
  readonly isElectron: true
  readonly platform: NodeJS.Platform
  /** Drive the OS media player. Resolves {ok:false, hint} when no player
   * could be reached — surface the hint to the user. */
  media(cmd: 'playpause' | 'next' | 'previous'): Promise<{ ok: boolean; hint?: string }>
}

declare global {
  interface Window {
    orphic?: OrphicBridge
  }
}
