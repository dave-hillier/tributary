import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { parseMarkdown, stringifyMarkdown } from '@tributary/markdown';
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
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
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
export class Workspace {
  readonly ref: WorkspaceRef;
  readonly documents: Document[];
  readonly duplicateIds: DuplicateIdReport[];

  private constructor(ref: WorkspaceRef, documents: Document[], duplicateIds: DuplicateIdReport[]) {
    this.ref = ref;
    this.documents = documents;
    this.duplicateIds = duplicateIds;
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

  /** Write a document and record a semantic checkpoint commit. */
  async save(doc: Document, message?: string): Promise<{ commit: string }> {
    const abs = join(this.ref.rootPath, doc.path);
    mkdirSync(dirname(abs), { recursive: true });
    const source = doc.source ?? stringifyMarkdown(doc);
    writeFileSync(abs, source, 'utf8');
    git(this.ref.rootPath, ['add', '--', doc.path]);
    git(this.ref.rootPath, ['commit', '-q', '-m', message ?? 'edit ' + doc.path]);
    const commit = git(this.ref.rootPath, ['rev-parse', 'HEAD']);
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