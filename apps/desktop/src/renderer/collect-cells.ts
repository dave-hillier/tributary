import type { Cell, Document } from '@tributary/api';

/** Resolve a transclusion target (optionally a heading section) to a document. */
export type TransclusionLookup = (target: string, heading?: string) => Document | undefined;

/** A cell plus the document and index it belongs to. */
export interface CollectedCell {
  cell: Cell;
  /** Id of the document that owns the cell. */
  docId: string;
  /** 0-based index of the cell within its owning document (document order). */
  index: number;
}

/** Mirrors the render-time guard in @tributary/components. */
const MAX_EMBED_DEPTH = 12;

/**
 * Collect every executable cell reachable from `doc`, expanding `![[…]]`
 * transclusions in document (render) order. Cells reached through an embed are
 * tagged with their owning document and local index, so an edit can be routed
 * back to the right document and `replaceCellSource` argument. A cell that
 * appears through more than one embed is collected once.
 */
export function collectCells(doc: Document, lookup?: TransclusionLookup): CollectedCell[] {
  const out: CollectedCell[] = [];
  const seen = new Set<Cell>();

  const walkDoc = (d: Document, chain: string[]): void => {
    let index = 0;
    const visit = (n: unknown): void => {
      const node = n as { type?: string; children?: unknown[]; target?: string; heading?: string };
      if (node.type === 'cell') {
        const cell = node as unknown as Cell;
        if (!seen.has(cell)) {
          seen.add(cell);
          out.push({ cell, docId: d.id, index });
        }
        index++;
        return;
      }
      if (node.type === 'transclusion' && lookup && typeof node.target === 'string') {
        const target = lookup(node.target, node.heading);
        if (target && !chain.includes(target.id) && chain.length < MAX_EMBED_DEPTH) {
          walkDoc(target, [...chain, target.id]);
        }
        return;
      }
      if (node.children) for (const c of node.children) visit(c);
    };
    visit(d.root);
  };

  // Match @tributary/components: the top-level render chain starts at 'doc'.
  walkDoc(doc, ['doc']);
  return out;
}
