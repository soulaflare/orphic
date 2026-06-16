// Render build/icon-source.html → build/icon.png (1024×1024, transparent).
//   npx electron build/render-icon.cjs
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false,
    transparent: true, frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadFile(path.join(__dirname, 'icon-source.html'));
  await new Promise(r => setTimeout(r, 800)); // let the canvas paint
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(path.join(__dirname, 'icon.png'), img.toPNG());
  console.log('wrote build/icon.png');
  app.quit();
});
