/* ORPHIC extension — service worker
 * Toolbar click on a playing tab → mint a tabCapture stream ID →
 * open the visualizer page, which consumes it (see tab-source.js).
 */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id,
    });
    await chrome.tabs.create({
      url: chrome.runtime.getURL('visualizer.html#stream=' + encodeURIComponent(streamId)),
    });
  } catch (err) {
    // chrome:// pages and the web store can't be captured
    console.error('ORPHIC: could not capture tab —', err.message);
  }
});
