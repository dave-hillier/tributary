import { describe, it, expect } from 'vitest';
import type { Document } from '@tributary/api';
import {
  DEFAULT_SORT,
  documentHref,
  encodeDocPath,
  findDocumentByPath,
  parseRoute,
  serializeRoute,
  type RouteState,
} from '../src/renderer/url-state.js';

function route(overrides: Partial<RouteState> = {}): RouteState {
  return {
    view: 'document',
    docPath: null,
    pane: 'rendered',
    filters: {},
    fieldFilters: {},
    swimlane: '',
    sort: { ...DEFAULT_SORT },
    columns: [],
    ...overrides,
  };
}

describe('URL routes — document path', () => {
  it('ignores non-routes (empty hash, old #id anchors, unknown views)', () => {
    expect(parseRoute('')).toBeNull();
    expect(parseRoute('#')).toBeNull();
    expect(parseRoute('#notes/hello')).toBeNull();
    expect(parseRoute('#/nope')).toBeNull();
    expect(parseRoute('#/doc')).toBeNull(); // doc without a path
  });

  it('puts the document path in the route and reads it back', () => {
    const parsed = parseRoute('#/doc/notes/hello.md');
    expect(parsed?.view).toBe('document');
    expect(parsed?.docPath).toBe('notes/hello.md');
    expect(serializeRoute(parsed!)).toBe('#/doc/notes/hello.md');
  });

  it('percent-encodes reserved characters per segment but keeps separators', () => {
    expect(encodeDocPath('notes/my note.md')).toBe('notes/my%20note.md');
    expect(documentHref('notes/my note.md')).toBe('#/doc/notes/my%20note.md');
    expect(parseRoute('#/doc/notes/my%20note.md')?.docPath).toBe('notes/my note.md');
    // malformed encoding is not a route
    expect(parseRoute('#/doc/notes/%E0%A4%A')).toBeNull();
  });

  it('serialises a non-default pane', () => {
    const parsed = parseRoute('#/doc/notes/hello.md?pane=source');
    expect(parsed?.pane).toBe('source');
    expect(serializeRoute(parsed!)).toBe('#/doc/notes/hello.md?pane=source');
    expect(serializeRoute(route({ view: 'document', docPath: 'index.md' }))).toBe('#/doc/index.md');
  });

  it('resolves a URL path by path, .md-less path or id', () => {
    const docs = [
      { id: 'notes/hello', path: 'notes/hello.md' },
      { id: 'task-1', path: 'items/task-1.md' },
    ] as unknown as Document[];
    expect(findDocumentByPath(docs, 'notes/hello.md')?.id).toBe('notes/hello');
    expect(findDocumentByPath(docs, 'notes/hello')?.id).toBe('notes/hello');
    expect(findDocumentByPath(docs, 'task-1')?.id).toBe('task-1');
    expect(findDocumentByPath(docs, 'missing.md')).toBeUndefined();
  });
});

describe('URL routes — board/list/table filters', () => {
  it('round-trips every first-class filter and generic fields', () => {
    // Parameter order matches the serialiser, so this doubles as a round trip.
    const hash =
      '#/board?status=todo&assignee=user%3Aalice&label=bug&project=project-demo' +
      '&problem=problem-1&priority=1&field.severity=high&swimlane=project&col=todo&col=doing';
    const parsed = parseRoute(hash)!;
    expect(parsed.view).toBe('board');
    expect(parsed.filters).toEqual({
      status: 'todo',
      assignee: 'user:alice',
      priority: 1,
      label: 'bug',
      project: 'project-demo',
      problem: 'problem-1',
    });
    expect(parsed.fieldFilters).toEqual({ severity: 'high' });
    expect(parsed.swimlane).toBe('project');
    expect(parsed.columns).toEqual(['todo', 'doing']);
    expect(serializeRoute(parsed)).toBe(hash);
  });

  it('keeps priority 0 and drops a non-numeric priority', () => {
    expect(parseRoute('#/list?priority=0')?.filters.priority).toBe(0);
    expect(parseRoute('#/list?priority=high')?.filters.priority).toBeUndefined();
    expect(serializeRoute(route({ view: 'list', filters: { priority: 0 } }))).toBe('#/list?priority=0');
  });

  it('applies filters to the list and table views too', () => {
    expect(parseRoute('#/list?label=release')?.filters.label).toBe('release');
    expect(serializeRoute(route({ view: 'list', filters: { label: 'release' } }))).toBe('#/list?label=release');
  });

  it('encodes and omits the table sort', () => {
    expect(serializeRoute(route({ view: 'table' }))).toBe('#/table');
    expect(serializeRoute(route({ view: 'table', sort: { key: 'priority', dir: -1 } }))).toBe(
      '#/table?sort=priority%3Adesc'
    );
    expect(parseRoute('#/table?sort=priority:desc')?.sort).toEqual({ key: 'priority', dir: -1 });
    expect(parseRoute('#/table?sort=garbage')?.sort).toEqual(DEFAULT_SORT);
  });

  it('does not leak board filters into a document route', () => {
    expect(serializeRoute(route({ view: 'document', docPath: 'index.md', filters: { status: 'todo' } }))).toBe(
      '#/doc/index.md'
    );
  });
});
