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
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { electronBinary, env, appRoot, repoRoot, rebuildForElectron, restoreForNode } from './electron-abi.mjs';

const marker = join(repoRoot, '.smoke-window-marker');

try {
  rebuildForElectron();
  console.log('→ launching Electron window with --smoke');
  console.log('  (expecting: ELECTRON_BOOT → window → SMOKE_OK)');

  try {
    execFileSync(
      electronBinary,
      ['--no-sandbox', '--disable-gpu', '.', '--smoke'],
      { cwd: appRoot, env: { ...env, SMOKE_MARKER: marker }, stdio: 'inherit', timeout: 120_000 },
    );
  } catch (err) {
    // Non-zero exit / timeout: the marker (written by the app) carries the verdict.
    const rough = err && typeof err === 'object' ? String(err.message ?? err) : String(err);
    console.log('(electron exited abnormally: ' + rough.split('\n')[0] + ')');
  }

  const got = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : '';
  console.log('  marker:', got || '(absent)');
  if (!got.startsWith('SMOKE_OK')) {
    throw new Error([
      'SMOKE_OK not observed — window/IPC/renderer probe failed.',
      'Common causes: stale build artifacts (run `pnpm --filter app-desktop build`),',
      'renderer assets not loading under file:// (vite base must be "./"),',
      'or no display session available.',
      got ? 'app said: ' + got : '',
    ].filter(Boolean).join('\n'));
  }
  console.log('✓ Electron window smoke passed (window + renderer + IPC)');
} finally {
  restoreForNode();
  try {
    const { rm } = await import('node:fs/promises');
    await rm(marker, { force: true });
  } catch {
    // marker cleanup is best-effort
  }
}