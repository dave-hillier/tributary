import type { Document } from '@tributary/api';

/**
 * Addressable renderer state.
 *
 * Navigation lives in the URL so an open document, a board/list filter set or a
 * table sort can be copied, bookmarked and restored across reloads and
 * back/forward. The *hash* carries the route rather than the path because the
 * renderer is loaded from disk via \`file://\` in Electron, where the path cannot
 * change without a server (a deep-linked pathname would 404 on reload).
 *
 * Grammar (every parameter optional; omitted means "default"):
 *
 *   #/doc/<path>?pane=source
 *   #/board?status=todo&field.severity=high&swimlane=project&col=todo&col=doing
 *   #/list?assignee=user:alice
 *   #/table?sort=title:desc&label=bug
 *
 * The document path is a real path segment — \`#/doc/notes/hello.md\` — split on
 * \`/\` and percent-encoded per segment, so it stays readable while remaining a
 * valid URL for paths containing spaces or other reserved characters.
 */

export type View = 'document' | 'board' | 'list' | 'table';
export type Pane = 'rendered' | 'source' | 'diff';

/** First-class board/list filters (ADR-005 vocabulary). */
export interface BoardFilters {
  status?: string;
  assignee?: string;
  priority?: number;
  label?: string;
  project?: string;
  problem?: string;
}

export interface SortState {
  key: string;
  dir: 1 | -1;
}

/** The complete route a URL can express; absent parameters fall back to these. */
export interface RouteState {
  view: View;
  docPath: string | null;
  pane: Pane;
  filters: BoardFilters;
  fieldFilters: Record<string, string>;
  swimlane: string;
  sort: SortState;
  columns: string[];
}

export const DEFAULT_SORT: SortState = { key: 'title', dir: 1 };

const FILTER_KEYS = ['status', 'assignee', 'label', 'project', 'problem'] as const;
const FIELD_PREFIX = 'field.';

const VIEW_TO_SEGMENT: Record<View, string> = {
  document: 'doc',
  board: 'board',
  list: 'list',
  table: 'table',
};

const SEGMENT_TO_VIEW: Record<string, View> = {
  doc: 'document',
  document: 'document',
  board: 'board',
  list: 'list',
  table: 'table',
};

/** Percent-encode a document path per segment, leaving the separators readable. */
export function encodeDocPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** A shareable href for a document path (used for real anchor links). */
export function documentHref(path: string): string {
  return '#/doc/' + encodeDocPath(path);
}

/** Resolve a URL path back to a document: exact path, \`.md\`-less path, or id. */
export function findDocumentByPath(docs: Document[], path: string): Document | undefined {
  return docs.find((d) => d.path === path || d.path === path + '.md' || d.id === path);
}

function parsePane(value: string | null): Pane {
  return value === 'source' || value === 'diff' ? value : 'rendered';
}

function parseSort(value: string | null): SortState {
  if (!value) return { ...DEFAULT_SORT };
  const at = value.lastIndexOf(':');
  if (at <= 0) return { ...DEFAULT_SORT };
  return { key: value.slice(0, at), dir: value.slice(at + 1) === 'desc' ? -1 : 1 };
}

/**
 * Parse a \`location.hash\`. Returns \`null\` when it is not a recognisable
 * route (empty hash, an old \`#id\` anchor, or an unknown view).
 */
export function parseRoute(hash: string): RouteState | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith('/')) return null;
  const queryAt = raw.indexOf('?');
  const pathPart = queryAt >= 0 ? raw.slice(0, queryAt) : raw;
  const queryPart = queryAt >= 0 ? raw.slice(queryAt + 1) : '';
  const segments = pathPart.split('/').filter((s) => s !== '');
  const head = segments[0];
  if (!head) return null;
  const view = SEGMENT_TO_VIEW[head];
  if (!view) return null;

  let docPath: string | null = null;
  if (view === 'document') {
    if (segments.length < 2) return null;
    try {
      docPath = segments.slice(1).map(decodeURIComponent).join('/');
    } catch {
      return null; // malformed percent-encoding
    }
  }

  const params = new URLSearchParams(queryPart);
  const filters: BoardFilters = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  const priority = params.get('priority');
  if (priority !== null && priority !== '' && Number.isFinite(Number(priority))) {
    filters.priority = Number(priority);
  }

  const fieldFilters: Record<string, string> = {};
  for (const [key, value] of params) {
    if (key.startsWith(FIELD_PREFIX)) {
      const name = key.slice(FIELD_PREFIX.length);
      if (name) fieldFilters[name] = value;
    }
  }

  return {
    view,
    docPath,
    pane: parsePane(params.get('pane')),
    filters,
    fieldFilters,
    swimlane: params.get('swimlane') ?? '',
    sort: parseSort(params.get('sort')),
    columns: params.getAll('col').filter((c) => c !== ''),
  };
}

/** Serialise route state to a minimal hash (defaults omitted). */
export function serializeRoute(state: RouteState): string {
  const segments = [VIEW_TO_SEGMENT[state.view]];
  if (state.view === 'document' && state.docPath) segments.push(encodeDocPath(state.docPath));

  const params = new URLSearchParams();
  if (state.view === 'document') {
    if (state.pane !== 'rendered') params.set('pane', state.pane);
  } else {
    for (const key of FILTER_KEYS) {
      const value = state.filters[key];
      if (value) params.set(key, value);
    }
    if (state.filters.priority !== undefined) params.set('priority', String(state.filters.priority));
    for (const [name, value] of Object.entries(state.fieldFilters)) {
      if (value !== '') params.set(FIELD_PREFIX + name, value);
    }
    if (state.view === 'board') {
      if (state.swimlane) params.set('swimlane', state.swimlane);
      for (const column of state.columns) if (column) params.append('col', column);
    }
    if (state.view === 'table' && (state.sort.key !== DEFAULT_SORT.key || state.sort.dir !== DEFAULT_SORT.dir)) {
      params.set('sort', state.sort.key + ':' + (state.sort.dir === -1 ? 'desc' : 'asc'));
    }
  }

  const query = params.toString();
  return '#/' + segments.join('/') + (query ? '?' + query : '');
}
