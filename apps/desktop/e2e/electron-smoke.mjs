// Electron bundled-Node ABI probe (findings #4, phase A — runs anywhere).
//
// Launches Electron's OWN Node runtime (`ELECTRON_RUN_AS_NODE=1`, no display
// needed) and, from inside it, imports and exercises the same native sqlite
// binding the main process uses. If @electron/rebuild had not happened (or the
// ABI were wrong), loading better-sqlite3 here would fail with a dlopen error.
//
// Phase B (the real window + IPC + renderer probe) is `electron-window-smoke.mjs`.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { electronBinary, env, appRoot, repoRoot, rebuildForElectron, restoreForNode } from './electron-abi.mjs';

const marker = join(repoRoot, '.smoke-abi-marker');

try {
  rebuildForElectron();

  const probe = join(appRoot, 'e2e', 'electron-node-probe.mjs');
  console.log('→ running probe under Electron bundled Node (ELECTRON_RUN_AS_NODE)');
  try {
    execFileSync(electronBinary, [probe], {
      cwd: appRoot,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1', SMOKE_MARKER: marker },
      stdio: 'inherit',
      timeout: 60_000,
    });
  } catch (err) {
    console.log('  (probe exited non-zero; inspecting marker)');
  }

  const got = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : '';
  console.log('  marker:', got || '(absent)');
  if (!got.startsWith('ELECTRON_NODE_ABI_OK')) {
    throw new Error('ELECTRON_NODE_ABI_OK not observed — native binding did not load under Electron Node');
  }
  console.log('✓ native ABI verified under Electron bundled Node (' + got.split('=')[1] + ')');
} finally {
  restoreForNode();
  try {
    const { rm } = await import('node:fs/promises');
    await rm(marker, { force: true });
  } catch {
    // marker cleanup is best-effort
  }
}