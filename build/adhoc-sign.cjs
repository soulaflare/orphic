// electron-builder afterSign hook.
//
// Flipping the Electron fuses patches the Electron Framework binary AFTER it
// was ad-hoc signed upstream, so its signature no longer matches. On Apple
// Silicon the kernel SIGKILLs any process whose executable pages fail
// signature validation ("Code Signature Invalid" in IsRunAsNodeEnabled).
// electron-builder only re-signs when a Developer ID identity exists; with
// none it skips signing entirely and ships a crashing app. This hook ad-hoc
// signs the bundle in that case so unsigned local builds still launch.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

module.exports = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  try {
    execFileSync('codesign', ['--verify', '--deep', app], { stdio: 'ignore' })
    return // a real identity already signed it — leave that signature alone
  } catch {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  }
}
