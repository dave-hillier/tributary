import { describe, it, expect } from 'vitest';
import { collectCells } from '../src/renderer/collect-cells.js';
import type { Document } from '@tributary/api';

function doc(id: string, children: unknown[]): Document {
  return { id, path: id + '.md', frontmatter: {}, root: { type: 'root', children } } as unknown as Document;
}
const cell = (value: string) => ({ type: 'cell', lang: 'js', value, children: [] });
const trans = (target: string, heading?: string) => ({
  type: 'transclusion',
  target,
  ...(heading ? { heading } : {}),
  children: [],
});

describe('collectCells', () => {
  it("collects a transcluded document's cells in render order with owners (finding 5)", () => {
    const inner = doc('inner', [cell('a'), cell('b')]);
    const host = doc('host', [cell('h'), trans('inner'), cell('h2')]);
    const got = collectCells(host, (t) => (t === 'inner' ? inner : undefined));
    expect(got.map((g) => g.cell.value)).toEqual(['h', 'a', 'b', 'h2']);
    expect(got.map((g) => g.docId)).toEqual(['host', 'inner', 'inner', 'host']);
    expect(got.map((g) => g.index)).toEqual([0, 0, 1, 1]);
  });

  it('collects from a nested transclusion chain', () => {
    const c = doc('c', [cell('cc')]);
    const b = doc('b', [cell('bb'), trans('c')]);
    const a = doc('a', [trans('b')]);
    const byId: Record<string, Document> = { a, b, c };
    const got = collectCells(a, (t) => byId[t]);
    expect(got.map((g) => g.cell.value)).toEqual(['bb', 'cc']);
    expect(got.map((g) => g.docId)).toEqual(['b', 'c']);
  });

  it('collects a cell once when the same document is embedded twice', () => {
    const inner = doc('inner', [cell('x')]);
    const host = doc('host', [trans('inner'), trans('inner')]);
    const got = collectCells(host, () => inner);
    expect(got).toHaveLength(1);
  });

  it('stops at a cycle', () => {
    const a = doc('a', [cell('a1'), trans('b')]);
    const b = doc('b', [cell('b1'), trans('a')]);
    const byId: Record<string, Document> = { a, b };
    const got = collectCells(a, (t) => byId[t]);
    expect(got.map((g) => g.cell.value)).toEqual(['a1', 'b1']);
  });

  it('leaves cells in place when no lookup is wired', () => {
    const host = doc('host', [trans('inner'), cell('h')]);
    const got = collectCells(host);
    expect(got.map((g) => g.cell.value)).toEqual(['h']);
  });
});
