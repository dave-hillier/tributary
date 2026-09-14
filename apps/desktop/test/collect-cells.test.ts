import { describe, it, expect } from 'vitest';
import {
  cellName,
  cellsRenumbered,
  collectOwnCells,
  reachableDocuments,
} from '../src/renderer/collect-cells.js';
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

describe('cellName', () => {
  it('namespaces the cell index by owning document', () => {
    expect(cellName('index', 0)).toBe('index#0');
    expect(cellName('notes/hello', 2)).toBe('notes/hello#2');
    // Two documents can each have a cell 0 without colliding.
    expect(cellName('index', 0)).not.toBe(cellName('notes/hello', 0));
  });
});

describe('cellsRenumbered', () => {
  it('is false when the fence layout is unchanged', () => {
    const before = [cell('a'), cell('b')];
    const after = [cell('a edited'), cell('b')];
    expect(cellsRenumbered(before, after)).toBe(false);
  });

  it('is true when a fence was added or removed, shifting the indices', () => {
    // The case that matters: an edit made through a name minted against the old
    // layout would otherwise rewrite whichever fence now sits at that index.
    expect(cellsRenumbered([cell('a'), cell('b')], [cell('a'), cell('b'), cell('c')])).toBe(true);
    expect(cellsRenumbered([cell('a'), cell('b')], [cell('b')])).toBe(true);
  });
});
