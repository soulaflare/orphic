/* ORPHIC extension — stash the tabCapture stream ID from the URL hash
 * before main.js boots; main.js auto-starts this source if present.
 * Loaded only by visualizer.html (extension build), never by the web app.
 */
(function () {
  'use strict';
  const m = location.hash.match(/^#stream=(.+)$/);
  if (!m) return;
  const M = window.ORPHIC = window.ORPHIC || {};
  M.pendingTabStreamId = decodeURIComponent(m[1]);
  // a stale ID (e.g. page reload) is handled by main.js's catch
  history.replaceState(null, '', location.pathname);
})();
