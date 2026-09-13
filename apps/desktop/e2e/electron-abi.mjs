// Shared native-ABI plumbing for the Electron smoke scripts.
// better-sqlite3 is one native binding with one ABI at a time: rebuild it for
// Electron before any Electron-side check, and ALWAYS restore the Node-ABI
// build afterwards so the workspace Vitest suite stays green.

import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

export const here = dirname(fileURLToPath(import.meta.url)); // apps/desktop/e2e
export const appRoot = join(here, '..');
export const repoRoot = join(appRoot, '..', '..');
export const ELECTRON_VERSION = '33.4.11';
export const electronBinary = electronPath;

// Native-build caches must stay inside the workspace (sandboxed environments
// cannot write to the home caches).
export const env = {
  ...process.env,
  HOME: join(repoRoot, '.home'),
  ELECTRON_CACHE: join(repoRoot, '.electron-cache'),
  electron_config_cache: join(repoRoot, '.electron-cache'),
};

function electronRebuildBinary() {
  return join(appRoot, 'node_modules', '.bin', 'electron-rebuild');
}

export function rebuildForElectron() {
  console.log('→ rebuilding better-sqlite3 for Electron', ELECTRON_VERSION);
  execFileSync(electronRebuildBinary(), ['-f', '-w', 'better-sqlite3', '-v', ELECTRON_VERSION], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
  console.log('  electron ABI rebuild complete');
}

export function restoreForNode() {
  console.log('→ restoring better-sqlite3 for Node');
  execFileSync('pnpm', ['--filter', '@tributary/index', 'rebuild'], { cwd: repoRoot, stdio: 'inherit' });
  console.log('  node ABI rebuild complete');
}