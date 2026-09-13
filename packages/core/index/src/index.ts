import type { Document, DocumentId, RelationKind, WorkItem } from '@tributary/api';
import {
  frontmatterRelations,
  projectWorkItems,
  resolveDocument,
} from '@tributary/ontology';

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
  /** Typed work-item projection from frontmatter (arch §3.3, ADR-005). */
  workItems: WorkItem[];
  /** Typed edges: prose references and frontmatter relations (ADR-005 §8). */
  relations: Relation[];
  /** Resolve a target by id, path, alias or title (ADR-005 §7). */
  resolve(target: string): Document | undefined;
}

/** A resolved typed edge between two documents. */
export interface Relation {
  from: DocumentId;
  to: DocumentId;
  kind: RelationKind;
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

  // One resolution rule for the whole system (ADR-005 §7): id, path, alias,
  // title. The shell uses the same function, so they cannot disagree.
  const resolve = (target: string): Document | undefined => resolveDocument(documents, target);

  const relations: Relation[] = [];
  const links = new Map<DocumentId, DocumentId[]>();
  for (const d of documents) {
    const resolved = collectTargets(d)
      .map((t) => resolve(t))
      .filter((x): x is Document => x !== undefined)
      .map((x) => x.id);
    links.set(d.id, [...new Set(resolved)]);
    for (const to of new Set(resolved)) relations.push({ from: d.id, to, kind: 'link' });
    // Frontmatter edges (project/parent/blocks) are typed relations, not prose
    // mentions, so a board grouping survives a rename (ADR-005 §4, §8).
    for (const rel of frontmatterRelations(d)) {
      const target = resolve(rel.target);
      if (target) relations.push({ from: d.id, to: target.id, kind: rel.kind });
    }
  }

  const backlinks = new Map<DocumentId, DocumentId[]>();
  for (const [fromId, toIds] of links) {
    for (const toId of toIds) {
      const arr = backlinks.get(toId) ?? [];
      arr.push(fromId);
      backlinks.set(toId, arr);
    }
  }

  const workItems = projectWorkItems(documents);

  return { documents, byId, byPath, links, backlinks, workItems, relations, resolve };
}

export { SqliteIndex } from './sqlite.js';
