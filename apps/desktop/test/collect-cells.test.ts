import { describe, it, expect } from 'vitest';
import { collectOwnCells, reachableDocuments } from '../src/renderer/collect-cells.js';
import type { Document } from '@tributary/api';

function doc(id: string, children: unknown[]): Document {
  return { id, path: id + '.md', frontmatter: {}, root: { type: 'root', children } } as unknown as Document;
}
const cell = (value: string) => ({ type: 'cell', lang: 'js', value, children: [] });
const trans = (target: string) => ({ type: 'transclusion', target, children: [] });

describe('collectOwnCells', () => {
  it('returns only the document own cells, in order', () => {
    const d = doc('d', [cell('a'), trans('inner'), cell('b')]);
    expect(collectOwnCells(d).map((c) => c.value)).toEqual(['a', 'b']);
  });
});

describe('reachableDocuments', () => {
  it('returns the host and each transcluded document once', () => {
    const inner = doc('inner', [cell('x')]);
    const host = doc('host', [trans('inner'), trans('inner')]);
    const got = reachableDocuments(host, (t) => (t === 'inner' ? inner : undefined));
    expect(got.map((d) => d.id)).toEqual(['host', 'inner']);
  });

  it('follows a nested chain in order', () => {
    const c = doc('c', []);
    const b = doc('b', [trans('c')]);
    const a = doc('a', [trans('b')]);
    const byId: Record<string, Document> = { a, b, c };
    expect(reachableDocuments(a, (t) => byId[t]).map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('stops at a cycle', () => {
    const a = doc('a', [trans('b')]);
    const b = doc('b', [trans('a')]);
    const byId: Record<string, Document> = { a, b };
    expect(reachableDocuments(a, (t) => byId[t]).map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('returns only the host when a target does not resolve', () => {
    const host = doc('host', [trans('missing')]);
    expect(reachableDocuments(host, () => undefined).map((d) => d.id)).toEqual(['host']);
  });
});
