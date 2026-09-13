import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { parseMarkdown, stringifyMarkdown, updateFrontmatter } from '@tributary/markdown';
import type { Document, DocumentId, WorkspaceRef } from '@tributary/api';
import { git, isGitRepo, ensureRepo } from './git.js';
import { DEMO_FILES } from './seed.js';

export interface DuplicateIdReport {
  id: DocumentId;
  paths: string[];
}

export interface CommitInfo {
  hash: string;
  message: string;
  date: string;
}

export function deriveId(frontmatterId: string | undefined, path: string): string {
  return frontmatterId ?? (path.replace(/\.md$/, '') || 'doc');
}

function listMarkdownFiles(rootPath: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.tributary' || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) out.push(p);
    }
  };
  walk(rootPath);
  return out;
}

/**
 * A local workspace over one Git repository (arch §5.2). Git is the durable
 * truth; this class reads from it and writes semantic checkpoints back to it.
 */
export class StaleBaseError extends Error {
  readonly id: DocumentId;
  constructor(id: DocumentId) {
    super('Stale base for document ' + id + ': it changed since it was opened');
    this.name = 'StaleBaseError';
    this.id = id;
  }
}

/**
 * A local workspace over one Git repository (arch §5.2). Git is the durable
 * truth; this class reads from it and writes semantic checkpoints back to it.
 */
export class Workspace {
  readonly ref: WorkspaceRef;
  readonly documents: Document[];
  readonly duplicateIds: DuplicateIdReport[];
  private baseBlobs = new Map<DocumentId, string>();

  private constructor(ref: WorkspaceRef, documents: Document[], duplicateIds: DuplicateIdReport[]) {
    this.ref = ref;
    this.documents = documents;
    this.duplicateIds = duplicateIds;
    for (const d of documents) {
      try {
        this.baseBlobs.set(d.id, git(ref.rootPath, ['rev-parse', 'HEAD:' + d.path]));
      } catch {
        // untracked file: no base blob to guard against
      }
    }
  }

  static async open(rootPath: string): Promise<Workspace> {
    if (!isGitRepo(rootPath)) {
      throw new Error('Not a Git repository: ' + rootPath);
    }
    const documents: Document[] = [];
    for (const abs of listMarkdownFiles(rootPath)) {
      const path = relative(rootPath, abs).split(sep).join('/');
      const source = readFileSync(abs, 'utf8');
      documents.push(parseMarkdown(source, { path }));
    }

    const byId = new Map<DocumentId, string[]>();
    for (const d of documents) {
      const paths = byId.get(d.id) ?? [];
      paths.push(d.path);
      byId.set(d.id, paths);
    }
    const duplicateIds: DuplicateIdReport[] = [...byId.entries()]
      .filter(([, paths]) => paths.length > 1)
      .map(([id, paths]) => ({ id, paths }));

    return new Workspace({ rootPath }, documents, duplicateIds);
  }

  getDocument(id: DocumentId): Document | undefined {
    return this.documents.find((d) => d.id === id);
  }

  /** Write a document and record a semantic checkpoint commit (skips no-ops). */
  async save(doc: Document, message?: string): Promise<{ commit: string | null; changed: boolean }> {
    const abs = join(this.ref.rootPath, doc.path);
    let newSource = doc.source ?? stringifyMarkdown(doc);
    // Backfill the current (path-derived) id into frontmatter so it survives
    // renames (finding 2). Persisting the existing id avoids changing identity.
    if (!doc.frontmatter.id) {
      newSource = updateFrontmatter(newSource, { id: doc.id });
    }

    // No-op skip: don't commit when content is unchanged.
    const currentDisk = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (currentDisk === newSource) {
      return { commit: null, changed: false };
    }

    // Stale-base guard: refuse to clobber a file that changed since open.
    const base = this.baseBlobs.get(doc.id);
    if (base) {
      let headBlob: string | null = null;
      try {
        headBlob = git(this.ref.rootPath, ['rev-parse', 'HEAD:' + doc.path]);
      } catch {
        headBlob = null;
      }
      if (headBlob && headBlob !== base) {
        throw new StaleBaseError(doc.id);
      }
    }

    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, newSource, 'utf8');
    git(this.ref.rootPath, ['add', '--', doc.path]);
    git(this.ref.rootPath, ['commit', '-q', '-m', message ?? 'edit ' + doc.path]);
    const commit = git(this.ref.rootPath, ['rev-parse', 'HEAD']);

    // Per-document invalidation: re-parse just this file, not the whole workspace.
    const updated = parseMarkdown(newSource, { path: doc.path });
    const idx = this.documents.findIndex((d) => d.id === doc.id);
    if (idx >= 0) this.documents[idx] = updated;
    else this.documents.push(updated);

    try {
      this.baseBlobs.set(doc.id, git(this.ref.rootPath, ['rev-parse', 'HEAD:' + doc.path]));
    } catch {
      this.baseBlobs.delete(doc.id);
    }

    return { commit, changed: true };
  }

  /** Rename/move a document, preserving its id (arch §3.1 identity). */
  async rename(id: DocumentId, newPath: string): Promise<{ commit: string }> {
    const doc = this.getDocument(id);
    if (!doc) throw new Error('Document not found: ' + id);
    const oldPath = doc.path;
    const absNew = join(this.ref.rootPath, newPath);
    mkdirSync(dirname(absNew), { recursive: true });
    git(this.ref.rootPath, ['mv', oldPath, newPath]);
    git(this.ref.rootPath, ['commit', '-q', '-m', 'rename ' + oldPath + ' -> ' + newPath]);
    const commit = git(this.ref.rootPath, ['rev-parse', 'HEAD']);
    const source = readFileSync(absNew, 'utf8');
    const updated = parseMarkdown(source, { path: newPath });
    const idx = this.documents.findIndex((d) => d.id === id);
    if (idx >= 0) this.documents[idx] = updated;
    else this.documents.push(updated);
    return { commit };
  }

  /** Commit history for a document path, oldest first. */
  async history(id: DocumentId): Promise<CommitInfo[]> {
    const doc = this.getDocument(id);
    if (!doc) return [];
    const out = git(this.ref.rootPath, ['log', '--pretty=format:%H%x1f%s%x1f%ci', '--', doc.path]);
    if (out === '') return [];
    return out
      .split('\n')
      .map((line) => {
        const parts = line.split('\u001f');
        return { hash: parts[0] ?? '', message: parts[1] ?? '', date: parts[2] ?? '' };
      })
      .reverse();
  }
}

export async function openWorkspace(rootPath: string): Promise<Workspace> {
  return Workspace.open(rootPath);
}

export { DEMO_FILES } from './seed.js';

/** Initialize a real Git repo, seed it with the demo files, and open it. */
export async function createDemoWorkspace(rootPath: string): Promise<Workspace> {
  mkdirSync(rootPath, { recursive: true });
  ensureRepo(rootPath);
  for (const [rel, content] of Object.entries(DEMO_FILES)) {
    const abs = join(rootPath, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  git(rootPath, ['add', '-A']);
  git(rootPath, ['commit', '-q', '-m', 'seed demo workspace']);
  return Workspace.open(rootPath);
}