// Electron WINDOW smoke (findings #4, phase B) — requires a desktop session.
//
// Launches the real app (`electron . --smoke`), which boots the Electron
// window, opens the demo workspace (native index in the MAIN process), and
// probes the renderer through the live contextBridge/IPC seam. Passes only on
// `SMOKE_OK` — the window was created, the renderer rendered a document, and
// window.tributary is live.
//
// Cannot run in headless/CI-like sandboxes (no display); on a desktop session:
//   pnpm --filter app-desktop smoke:window

import { execFileSync } from 'node:child_process';
import { electronBinary, env, appRoot, rebuildForElectron, restoreForNode } from './electron-abi.mjs';

try {
  rebuildForElectron();
  console.log('→ launching Electron window with --smoke');
  const res = execFileSync(
    electronBinary,
    ['--no-sandbox', '--disable-gpu', '.', '--smoke'],
    { cwd: appRoot, env, stdio: 'pipe', timeout: 120_000 },
  );
  const stdout = res.stdout ? String(res.stdout) : '';
  const stderr = res.stderr ? String(res.stderr) : '';
  console.log(`(electron exited with status ${res.status})`);
  console.log((stderr + '\n' + stdout).split('\n').filter((l) => l.trim()).slice(-40).join('\n'));

  if (!stdout.includes('SMOKE_OK')) {
    throw new Error('SMOKE_OK not observed in Electron output (window/IPC probe failed)');
  }
  console.log('✓ Electron window smoke passed (window + renderer + IPC)');
} finally {
  restoreForNode();
}