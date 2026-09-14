import type { Cell, Document } from '@tributary/api';

/** Resolve a transclusion target to a full document (heading section ignored). */
export type TransclusionLookup = (target: string) => Document | undefined;

/** A cell plus the document and local index it belongs to. */
export interface CollectedCell {
  cell: Cell;
  /** Id of the document that owns the cell. */
  docId: string;
  /** 0-based index of the cell within its owning document (document order). */
  index: number;
  /** Host name for the cell — unique within its host, constant for its lifetime. */
  name: string;
}

/**
 * Name a cell for its host. Cells are anonymous in the dialect, so the name is
 * derived: document id plus the cell's index within that document. It needs to
 * be unique within one host and stable for that host's lifetime only — any
 * reparse rebuilds the hosts and mints fresh names.
 */
export function cellName(docId: string, index: number): string {
  return docId + '#' + index;
}

/**
 * True when a reparse changed the fence layout, so cell names derived from the
 * previous layout no longer address the same cells. A changed count is the
 * detectable case — and the only evidence available, since cells carry no
 * stable identity in the dialect. When this is true the caller must rebuild its
 * index rather than edit through a name minted against the old layout.
 */
export function cellsRenumbered(before: readonly Cell[], after: readonly Cell[]): boolean {
  return before.length !== after.length;
}

/** Mirrors the render-time guard in @tributary/components. */
const MAX_EMBED_DEPTH = 12;

/** Cells declared directly in one document, in document order. */
export function collectOwnCells(doc: Document): Cell[] {
  const out: Cell[] = [];
  const walk = (n: unknown): void => {
    const node = n as { type?: string; children?: unknown[] };
    if (node.type === 'cell') out.push(node as unknown as Cell);
    if (node.children) for (const c of node.children) walk(c);
  };
  walk(doc.root);
  return out;
}

/**
 * The host document plus every document reachable through `![[…]]`, each once
 * and depth/cycle guarded. Only full documents are returned, so a cell reached
 * through a heading section still maps back to its owning document (and its
 * full-document index).
 */
export function reachableDocuments(host: Document, lookup: TransclusionLookup): Document[] {
  const out: Document[] = [];
  const seen = new Set<string>();
  const visit = (doc: Document, depth: number): void => {
    if (seen.has(doc.id)) return;
    seen.add(doc.id);
    out.push(doc);
    if (depth >= MAX_EMBED_DEPTH) return;
    const walk = (n: unknown): void => {
      const node = n as { type?: string; children?: unknown[]; target?: string };
      if (node.type === 'transclusion' && typeof node.target === 'string') {
        const target = lookup(node.target);
        if (target) visit(target, depth + 1);
      }
      if (node.children) for (const c of node.children) walk(c);
    };
    walk(doc.root);
  };
  visit(host, 0);
  return out;
}
