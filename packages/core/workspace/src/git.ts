import { execFileSync } from 'node:child_process';

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

/** Initialize a repo if needed and set a local identity (for seed/commit in tests). */
export function ensureRepo(cwd: string): void {
  if (!isGitRepo(cwd)) {
    git(cwd, ['init', '-q']);
  }
  git(cwd, ['config', 'user.name', 'Tributary']);
  git(cwd, ['config', 'user.email', 'tributary@example.com']);
}