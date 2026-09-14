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
