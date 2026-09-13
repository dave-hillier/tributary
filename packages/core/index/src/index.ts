import type { Document, DocumentId, WorkItem } from '@tributary/api';

// Section slicing for transclusion lives in the (pure) markdown package so
// shells and renderers can use it without pulling native deps; re-exported
// here for API continuity.
export { headingText, findSection } from '@tributary/markdown';

/** A disposable, in-memory projection over parsed documents (arch §5.3). */
export interface WorkspaceIndex {
  documents: Document[];
  byId: Map<DocumentId, Document>;
  byPath: Map<string, Document>;
  /** id -> resolved ids this document links to (wiki links / transclusions). */
  links: Map<DocumentId, DocumentId[]>;
  /** id -> ids of documents that link to it. */
  backlinks: Map<DocumentId, DocumentId[]>;
  /** Typed work-item projection from frontmatter (arch §3.3). */
  workItems: WorkItem[];
  /** Resolve a wiki-link/transclusion target to a document. */
  resolve(target: string): Document | undefined;
}

/** Collect raw wiki-link/transclusion targets from a document's AST. */
export function collectTargets(doc: Document): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    const n = node as { type?: string; target?: unknown; children?: unknown[] };
    if (n.type === 'wikiLink' || n.type === 'transclusion') {
      if (typeof n.target === 'string' && n.target !== '') out.push(n.target);
    }
    if (n.children) for (const c of n.children) walk(c);
  };
  walk(doc.root);
  return out;
}

export function buildIndex(documents: Document[]): WorkspaceIndex {
  const byId = new Map<DocumentId, Document>();
  const byPath = new Map<string, Document>();
  for (const d of documents) {
    byId.set(d.id, d);
    byPath.set(d.path, d);
  }

  const resolve = (target: string): Document | undefined => {
    if (byId.has(target)) return byId.get(target);
    if (byPath.has(target)) return byPath.get(target);
    if (byPath.has(target + '.md')) return byPath.get(target + '.md');
    return undefined;
  };

  const links = new Map<DocumentId, DocumentId[]>();
  for (const d of documents) {
    const resolved = collectTargets(d)
      .map((t) => resolve(t))
      .filter((x): x is Document => x !== undefined)
      .map((x) => x.id);
    links.set(d.id, [...new Set(resolved)]);
  }

  const backlinks = new Map<DocumentId, DocumentId[]>();
  for (const [fromId, toIds] of links) {
    for (const toId of toIds) {
      const arr = backlinks.get(toId) ?? [];
      arr.push(fromId);
      backlinks.set(toId, arr);
    }
  }

  const workItems: WorkItem[] = documents
    .filter((d) => d.frontmatter.kind === 'work-item')
    .map((d) => ({
      id: d.id,
      path: d.path,
      title: (d.frontmatter.title as string | undefined) ?? d.id,
      status: (d.frontmatter.status as string | undefined) ?? 'todo',
      assignee: d.frontmatter.assignee as string | undefined,
      priority: d.frontmatter.priority as string | undefined,
      project: d.frontmatter.project as string | undefined,
    }));

  return { documents, byId, byPath, links, backlinks, workItems, resolve };
}

export { SqliteIndex } from './sqlite.js';
