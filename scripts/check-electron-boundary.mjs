#!/usr/bin/env node
/**
 * Boundary guard: no non-shell package may depend on or import Electron.
 *
 * Scans every package under `packages/*` (the domain/runtime/ui packages) and
 * fails if any of them declares `electron` as a dependency or imports it in
 * source. `apps/desktop` is the only package allowed to touch Electron.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const violations = [];
for (const group of ['core', 'runtime', 'ui']) {
  const base = join(root, 'packages', group);
  if (!existsSync(base)) continue;
  for (const pkgName of readdirSync(base)) {
    const pkgDir = join(base, pkgName);
    if (!statSync(pkgDir).isDirectory()) continue;

    // 1. dependency declaration check
    const pkgJsonPath = join(pkgDir, 'package.json');
    if (existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
      if (Object.keys(all).some((d) => d === 'electron')) {
        violations.push(`${pkgName}: declares electron as a dependency`);
      }
    }

    // 2. source import check
    const srcDir = join(pkgDir, 'src');
    if (!existsSync(srcDir)) continue;
    for (const file of walk(srcDir)) {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      if (/from\s+['"]electron['"]/.test(text) || /require\(['"]electron['"]\)/.test(text)) {
        violations.push(`${pkgName}/${file.replace(pkgDir, '')}: imports electron`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Electron boundary violated (non-shell packages must not use Electron):');
  for (const v of violations) console.error('  - ' + v);
  process.exit(1);
}
console.log('Electron boundary OK: no non-shell package depends on or imports Electron.');
