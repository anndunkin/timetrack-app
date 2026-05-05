/**
 * electron-builder afterPack hook
 * Embeds the custom icon into TimeTrack.exe using rcedit (via Wine on Linux).
 * This runs after the app is packaged but before the NSIS installer is built,
 * so both the exe and the installer get the correct icon.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

module.exports = async function afterPack(context) {
  // Only applies to Windows targets
  if (context.electronPlatformName !== 'win32') return;

  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productName}.exe`);
  const icoPath = path.join(__dirname, '..', 'build', 'icon.ico');

  // Find rcedit — prefer electron-builder's cached copy, fall back to node_modules
  const rceditPaths = [
    path.join(os.homedir(), '.cache/electron-builder/winCodeSign/winCodeSign-2.6.0/rcedit-x64.exe'),
    path.join(__dirname, '..', 'node_modules/electron-winstaller/vendor/rcedit.exe'),
  ];
  const rcedit = rceditPaths.find(p => fs.existsSync(p));

  if (!rcedit) {
    console.warn('[afterPack] rcedit not found — skipping icon embed');
    return;
  }

  if (!fs.existsSync(exePath)) {
    console.warn('[afterPack] exe not found at', exePath);
    return;
  }

  console.log('[afterPack] Embedding icon into', path.basename(exePath));

  try {
    if (os.platform() === 'win32') {
      execFileSync(rcedit, [exePath, '--set-icon', icoPath], { stdio: 'pipe' });
    } else {
      // Linux/macOS CI — run rcedit through Wine
      execFileSync('wine', [rcedit, exePath, '--set-icon', icoPath], {
        stdio: 'pipe',
        env: { ...process.env, WINEDEBUG: '-all' },
      });
    }
    console.log('[afterPack] Icon embedded successfully');
  } catch (err) {
    // Non-zero exit from rcedit is fatal; Wine noise on stderr is not
    console.error('[afterPack] rcedit failed:', err.message);
    throw err;
  }
};
