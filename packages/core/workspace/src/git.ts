import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Run git in a repo working directory, returning trimmed stdout. */
export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

/** True if cwd is inside a Git working tree. */
export function isGitRepo(cwd: string): boolean {
  try {
    return git(cwd, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

/** Three-way merge via git merge-file: merge ours and theirs onto a common base. */
export function gitMergeFile(base: string, ours: string, theirs: string): { merged: string; conflict: boolean } {
  const dir = mkdtempSync(join(tmpdir(), 'tributary-merge-'));
  const b = join(dir, 'base');
  const o = join(dir, 'ours');
  const t = join(dir, 'theirs');
  writeFileSync(b, base, 'utf8');
  writeFileSync(o, ours, 'utf8');
  writeFileSync(t, theirs, 'utf8');
  const res = spawnSync('git', ['merge-file', '-p', o, b, t], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  return { merged: res.stdout ?? '', conflict: res.status !== 0 };
}

/** Initialize a repo if needed and set a local identity (for seed/commit in tests). */
export function ensureRepo(cwd: string): void {
  if (!isGitRepo(cwd)) {
    git(cwd, ['init', '-q']);
  }
  git(cwd, ['config', 'user.name', 'Tributary']);
  git(cwd, ['config', 'user.email', 'tributary@example.com']);
}