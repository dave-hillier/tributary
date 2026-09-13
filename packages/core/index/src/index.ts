import type { Document, DocumentId, Node, Parent, Text, WorkItem } from '@tributary/api';
import type { Heading } from '@tributary/api';

// ---------------------------------------------------------------------------
// Transclusion targets (arch §3, Stage 2): resolve a `target#heading` reference
// to the section slice of root children that it denotes.
// ---------------------------------------------------------------------------

/** Flatten the visible text of phrasing content (heading labels etc.). */
export function headingText(node: Node): string {
  let out = '';
  const walk = (n: Node): void => {
    if (n.type === 'text') out += (n as Text).value;
    if ('children' in n) for (const c of (n as Parent).children) walk(c);
  };
  walk(node);
  return out;
}

/**
 * Find a heading section by its (case-insensitive) text label.
 * Returns the root children `[heading, ...following nodes]` up to (not
 * including) the next heading of the same or higher level.
 */
export function findSection(doc: Document, heading: string): Node[] | undefined {
  const want = heading.trim().toLowerCase();
  const children = doc.root.children;
  for (let i = 0; i < children.length; i++) {
    const n = children[i]!;
    if (n.type !== 'heading') continue;
    if (headingText(n).trim().toLowerCase() !== want) continue;
    const depth = (n as Heading).depth ?? 1;
    const slice: Node[] = [n];
    for (let j = i + 1; j < children.length; j++) {
      const s = children[j]!;
      if (s.type === 'heading' && ((s as Heading).depth ?? 1) <= depth) break;
      slice.push(s);
    }
    return slice;
  }
  return undefined;
}

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
