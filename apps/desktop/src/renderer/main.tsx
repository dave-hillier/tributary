import { StrictMode, Fragment, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentView, CellContext, TransclusionContext, EditContext } from '@tributary/components';
import type { CellResolver, CellResult, TransclusionResolver, EditResolver } from '@tributary/components';
import { findSection, nodeSource, replaceNodeSource } from '@tributary/markdown';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import type { Document, NewWorkItem, WorkItem, Cell } from '@tributary/api';
import { byUrgency, formatRef, STATUSES, type Diagnostic } from '@tributary/ontology';
import './styles.css';

interface HistoryEntry {
  hash: string;
  message: string;
  date: string;
}

interface SaveResult {
  commit: string | null;
  changed: boolean;
}

interface TributaryApi {
  getDocument: (id: string) => Promise<Document | null>;
  listDocuments: () => Promise<Document[]>;
  saveDocument: (doc: Document, message?: string) => Promise<SaveResult>;
  history: (id: string) => Promise<HistoryEntry[]>;
  resolveLink: (target: string) => Promise<Document | null>;
  backlinks: (id: string) => Promise<Document[]>;
  diff: (id: string) => Promise<string>;
  search: (query: string) => Promise<Document[]>;
  listWorkItems: () => Promise<WorkItem[]>;
  updateWorkItem: (id: string, patch: Record<string, unknown>) => Promise<Document>;
  createWorkItem: (input: NewWorkItem) => Promise<Document>;
  createProblem: (title: string) => Promise<Document>;
  diagnostics: () => Promise<Diagnostic[]>;
  renameDocument: (id: string, newPath: string) => Promise<Document>;
  addRemote: (url: string, name?: string) => Promise<void>;
  sync: () => Promise<string>;
  evaluateDocument: (docId: string, cells: { lang: string; source: string }[]) => Promise<CellResult[]>;
  updateCell: (docId: string, cellIndex: number, source: string) => Promise<CellResult[]>;
}

declare global {
  interface Window {
    tributary: TributaryApi;
  }
}

function collectCells(doc: Document): Cell[] {
  const out: Cell[] = [];
  const walk = (n: unknown): void => {
    const node = n as { type?: string; children?: unknown[] };
    if (node.type === 'cell') out.push(node as unknown as Cell);
    if (node.children) for (const c of node.children) walk(c);
  };
  walk(doc.root);
  return out;
}

function titleOf(doc: Document): string {
  return doc.frontmatter.title ?? doc.id;
}

function kindLabel(doc: Document): string {
  if (doc.frontmatter.kind === 'work-item') return doc.frontmatter.status ?? 'work-item';
  return doc.frontmatter.kind ?? 'note';
}

/**
 * Resolver backing `![[target]]` / `![[target#heading]]` transclusions.
 * Resolves by id, path (with/without `.md`) and frontmatter aliases; heading
 * embeds return a synthetic document whose root is exactly the section slice.
 *
 * Cycle + depth guards live in @tributary/components via the render chain, so
 * this stays a pure lookup.
 */
function makeTransclusionResolver(docs: Document[]): TransclusionResolver {
  const byId = new Map<string, Document>();
  const byPath = new Map<string, Document>();
  const byAlias = new Map<string, Document>();
  for (const d of docs) {
    byId.set(d.id, d);
    byPath.set(d.path, d);
    byPath.set(d.path.replace(/\.md$/, ''), d);
    const aliases = d.frontmatter.aliases;
    if (Array.isArray(aliases)) {
      for (const a of aliases) {
        if (typeof a === 'string') byAlias.set(a, d);
      }
    }
  }
  const resolveDoc = (target: string): Document | undefined =>
    byId.get(target) ?? byPath.get(target) ?? byPath.get(target + '.md') ?? byAlias.get(target);
  return {
    resolve(target, heading) {
      const doc = resolveDoc(target);
      if (!doc || heading === undefined) return doc;
      const section = findSection(doc, heading);
      if (!section) return undefined;
      return {
        id: doc.id,
        path: doc.path,
        frontmatter: doc.frontmatter,
        root: { type: 'root', children: section } as Document['root'],
        source: doc.source,
      };
    },
  };
}

/** Coarse relative time for the history list ("now", "2h", "yesterday"). */
function relativeTime(date: string): string {
  const ms = Date.now() - new Date(date).getTime();
  if (Number.isNaN(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h';
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return days + 'd';
  return new Date(date).toLocaleDateString();
}

type View = 'document' | 'board' | 'list' | 'table';
type Pane = 'rendered' | 'source' | 'diff';

// Board columns come from the ontology's vocabulary (ADR-005), not a local
// list; unknown statuses found in the corpus are appended so a document with a
// novel status is still visible.
const COLUMN_ORDER = [...STATUSES];

/** Priority label for display: the numeric scale is canonical (ADR-005 §5). */
const PRIORITY_LABELS = ['urgent', 'high', 'medium', 'low', 'none'];

function priorityLabel(p: number | undefined): string {
  return p === undefined ? '' : (PRIORITY_LABELS[p] ?? String(p));
}

/** Stringify an arbitrary frontmatter value for display in a table cell. */
function fmtField(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Case-insensitive, type-aware match for generic frontmatter field filtering. */
function fieldMatches(w: WorkItem, field: string, value: string): boolean {
  const want = value.trim().toLowerCase();
  if (want === '') return true;
  const raw = (w.frontmatter as Record<string, unknown>)[field];
  if (raw == null) return false;
  if (Array.isArray(raw)) return raw.some((x) => String(x).trim().toLowerCase() === want);
  return String(raw).trim().toLowerCase() === want;
}

/** Fields already surfaced as first-class board filters/columns. */
const FIELD_FILTER_EXCLUDE = new Set([
  'id', 'type', 'kind', 'title', 'status', 'assignees', 'assignee',
  'priority', 'labels', 'project', 'problem', 'due',
]);

/** A single work-item card, shared by the board, list and swimlane views. */
function WorkCard(props: {
  w: WorkItem;
  statuses: string[];
  resolveTitle: (key: string) => string;
  onOpen: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
}): ReactElement {
  const { w, statuses, resolveTitle, onOpen, onStatusChange } = props;
  const projectLabel = w.projectId ? resolveTitle(w.projectId) : (w.project ?? '—');
  const problemLabel = w.problemId ? resolveTitle(w.problemId) : (w.problem ?? '');
  return (
    <article data-card onClick={() => onOpen(w.id)}>
      <div data-card-head>
        <b>{w.title}</b>
        <span data-priority={w.priority ?? undefined}>{priorityLabel(w.priority)}</span>
      </div>
      <div data-card-path>
        {w.path} · {projectLabel}
        {problemLabel ? ' · ↳ ' + problemLabel : ''}
        {w.due ? ' · due ' + w.due : ''}
      </div>
      {w.labels.length > 0 ? (
        <ul data-labels>
          {w.labels.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      <div data-card-foot>
        <span>{w.assignees.length === 0 ? '—' : w.assignees.map((a) => a.id).join(', ')}</span>
        <select
          aria-label={'status of ' + w.title}
          value={w.status}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onStatusChange(w.id, e.target.value)}
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}

function App() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [current, setCurrent] = useState<Document | null>(null);
  const [source, setSource] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [savedMsg, setSavedMsg] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Document[]>([]);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newProblem, setNewProblem] = useState('');
  const [renamePath, setRenamePath] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [cellResults, setCellResults] = useState<Map<Cell, CellResult>>(new Map());
  const cellsRef = useRef<Cell[]>([]);
  const [backlinks, setBacklinks] = useState<Document[]>([]);
  const [diff, setDiff] = useState('');
  const [filters, setFilters] = useState<{
    status?: string;
    assignee?: string;
    priority?: number;
    label?: string;
    project?: string;
    problem?: string;
  }>({});
  // Generic filters over arbitrary frontmatter fields (one value per field).
  const [fieldFilters, setFieldFilters] = useState<Record<string, string>>({});
  const [tableSort, setTableSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'title', dir: 1 });
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [view, setView] = useState<View>('document');
  const [pane, setPane] = useState<Pane>('rendered');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  // Board presentation state: reorderable column order, optional swimlane field,
  // and transient drag/drop hover targets.
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [swimlaneField, setSwimlaneField] = useState('');
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSource = useRef('');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const load = async (id: string): Promise<void> => {
    const d = await window.tributary.getDocument(id);
    if (d) {
      if (id !== current?.id) setSavedMsg('');
      setCurrent(d);
      setSource(d.source ?? '');
      lastSavedSource.current = d.source ?? '';
      setHistory(await window.tributary.history(id).catch(() => []));
      setBacklinks(await window.tributary.backlinks(id).catch(() => []));
      setDiff(await window.tributary.diff(id).catch(() => ''));
      const cells = collectCells(d);
      cellsRef.current = cells;
      // Plain docs skip the evaluate IPC round-trip entirely (finding 14).
      const results =
        cells.length === 0
          ? []
          : await window.tributary
              .evaluateDocument(d.id, cells.map((c) => ({ lang: c.lang, source: c.value as string })))
              .catch(() => [] as CellResult[]);
      const map = new Map<Cell, CellResult>();
      cells.forEach((c, i) => {
        const res = results[i];
        if (res) map.set(c, res);
      });
      setCellResults(map);
    }
  };

  const loadWorkItems = async (): Promise<void> => {
    setWorkItems(await window.tributary.listWorkItems());
    // Ontology diagnostics are advisory (ADR-005 §9): shown, never blocking.
    setDiagnostics(await window.tributary.diagnostics().catch(() => []));
  };

  useEffect(() => {
    (async () => {
      const list = await window.tributary.listDocuments();
      setDocs(list);
      const home = list.find((d) => d.id === 'index') ?? list[0];
      if (home) await load(home.id);
      await loadWorkItems();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = async (): Promise<void> => {
    if (!current) return;
    try {
      const result = await window.tributary.saveDocument({ ...current, source }, 'edit from UI');
      lastSavedSource.current = source;
      setSavedMsg(result.changed ? 'Saved ' + (result.commit ?? '').slice(0, 7) : 'No changes');
      await load(current.id);
    } catch (e) {
      setSavedMsg('Save failed: ' + String(e));
    }
  };

  const autosave = async (): Promise<void> => {
    if (!current || source === lastSavedSource.current) return;
    try {
      const result = await window.tributary.saveDocument({ ...current, source }, 'autosave');
      lastSavedSource.current = source;
      setSavedMsg(result.changed ? 'Autosaved ' + (result.commit ?? '').slice(0, 7) : 'No changes');
    } catch (e) {
      setSavedMsg('Autosave failed: ' + String(e));
    }
  };

  const onSourceChange = (v: string): void => {
    setSource(v);
    setSavedMsg('Unsaved changes…');
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void autosave();
    }, 1000);
  };

  // ⌘S / Ctrl-S checkpoint.
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void onSave();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, source]);

  const onSearch = async (): Promise<void> => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setResults(await window.tributary.search(query.trim()));
  };

  const onDocClick = (e: MouseEvent<HTMLDivElement>): void => {
    const el = (e.target as HTMLElement).closest('a.wiki-link') as HTMLAnchorElement | null;
    if (!el) return;
    e.preventDefault();
    const target = el.getAttribute('href');
    if (target) {
      void window.tributary.resolveLink(target).then((d) => {
        if (d) void load(d.id);
      });
    }
  };

  const changeStatus = async (id: string, status: string): Promise<void> => {
    const updated = await window.tributary.updateWorkItem(id, { status });
    await loadWorkItems();
    if (current && current.id === id) {
      setCurrent(updated);
      setSource(updated.source ?? '');
    }
  };

  const createItem = async (): Promise<void> => {
    if (!newTitle.trim()) return;
    await window.tributary.createWorkItem({ title: newTitle.trim() });
    setNewTitle('');
    await loadWorkItems();
    setDocs(await window.tributary.listDocuments());
  };

  const createProblemItem = async (): Promise<void> => {
    if (!newProblem.trim()) return;
    await window.tributary.createProblem(newProblem.trim());
    setNewProblem('');
    await loadWorkItems();
    setDocs(await window.tributary.listDocuments());
  };

  const updateCell = async (cell: Cell, source: string): Promise<void> => {
    if (!current) return;
    const idx = cellsRef.current.indexOf(cell);
    if (idx < 0) return;
    const results = await window.tributary.updateCell(current.id, idx, source).catch(() => [] as CellResult[]);
    const map = new Map<Cell, CellResult>();
    cellsRef.current.forEach((c, i) => {
      const res = results[i];
      if (res) map.set(c, res);
    });
    setCellResults(map);
  };

  const onSync = async (): Promise<void> => {
    try {
      setSyncStatus(await window.tributary.sync());
    } catch (e) {
      setSyncStatus('Sync failed: ' + String(e));
    }
  };

  const onRename = async (): Promise<void> => {
    if (!current || !renamePath.trim()) return;
    await window.tributary.renameDocument(current.id, renamePath.trim());
    setRenamePath('');
    setRenameOpen(false);
    await load(current.id);
    await loadWorkItems();
    setDocs(await window.tributary.listDocuments());
  };

  const cellResolver: CellResolver = {
    resolve: (cell) => cellResults.get(cell),
    update: updateCell,
    indexOf: (cell) => cellsRef.current.indexOf(cell),
  };

  // In-place block editing: splice the edited Markdown back into the document
  // source byte-for-byte, commit, then refresh the open view. Editing a
  // transcluded document also refreshes the docs list so embeds re-resolve.
  const editResolver: EditResolver = {
    sourceOf: (doc, node) => nodeSource(doc, node),
    update: async (doc, node, newSource) => {
      const updated = replaceNodeSource(doc, node, newSource);
      if (!updated) {
        setSavedMsg('Edit failed: block has no source position');
        return;
      }
      try {
        const result = await window.tributary.saveDocument(updated, 'edit block');
        setSavedMsg(result.changed ? 'Saved ' + (result.commit ?? '').slice(0, 7) : 'No changes');
        setDocs(await window.tributary.listDocuments());
        if (current) await load(current.id);
      } catch (e) {
        setSavedMsg('Edit failed: ' + String(e));
      }
    },
  };

  // ── Derived values ─────────────────────────────────────────────────────

  // Column order: the user's drag-reordered list, otherwise the ontology's
  // vocabulary. Statuses discovered in the corpus that are not already known are
  // appended so a novel status is never hidden.
  const statuses = (() => {
    const base = columnOrder.length > 0 ? columnOrder : [...COLUMN_ORDER];
    const known = new Set(base);
    const extra = [...new Set(workItems.map((w) => w.status))].filter((s) => !known.has(s));
    return [...base, ...extra];
  })();
  const assignees = [...new Set(workItems.flatMap((w) => w.assignees.map(formatRef)))].sort();
  // Priorities sort numerically now, so the facet reads urgent → none rather
  // than the alphabetical order string priorities forced (ADR-005 §5).
  const priorities = [...new Set(workItems.map((w) => w.priority).filter((p): p is number => p != null))].sort(
    (a, b) => a - b
  );
  const labels = [...new Set(workItems.flatMap((w) => w.labels))].sort();
  // Group by the *resolved* project id where there is one, so a project rename
  // does not split the board (ADR-005 §4).
  const projectKey = (w: WorkItem): string | undefined => w.projectId ?? w.project;
  const projects = [...new Set(workItems.map(projectKey).filter((p): p is string => p != null))].sort();
  const problemKey = (w: WorkItem): string | undefined => w.problemId ?? w.problem;
  const problems = [...new Set(workItems.map(problemKey).filter((p): p is string => p != null))].sort();
  const refTitle = (key: string): string => docs.find((d) => d.id === key)?.frontmatter.title ?? key;
  const filteredItems = workItems
    .filter(
      (w) =>
        (!filters.status || w.status === filters.status) &&
        (!filters.assignee || w.assignees.some((a) => formatRef(a) === filters.assignee)) &&
        (filters.priority === undefined || w.priority === filters.priority) &&
        (!filters.label || w.labels.includes(filters.label)) &&
        (!filters.project || projectKey(w) === filters.project) &&
        (!filters.problem || problemKey(w) === filters.problem) &&
        Object.entries(fieldFilters).every(([field, value]) => fieldMatches(w, field, value))
    )
    .sort(byUrgency);

  // Arbitrary frontmatter fields available for generic filtering / table columns.
  const filterableFields = [
    ...new Set(
      workItems.flatMap((w) => Object.keys(w.frontmatter).filter((k) => !FIELD_FILTER_EXCLUDE.has(k)))
    ),
  ].sort();
  const addableFields = filterableFields.filter((f) => !(f in fieldFilters));

  // Optional swimlanes: horizontal bands grouped by any frontmatter field. Known
  // fields use their canonical projection (so a project rename survives); every
  // other field reads the raw frontmatter value.
  const swimlaneFields = [
    ...new Set(['project', 'problem', 'assignees', 'priority', 'labels', 'due', ...filterableFields]),
  ].sort();
  const swimlaneValue = (w: WorkItem, field: string): string => {
    switch (field) {
      case 'project':
        return w.projectId ? refTitle(w.projectId) : (w.project ?? '');
      case 'problem':
        return w.problemId ? refTitle(w.problemId) : (w.problem ?? '');
      case 'assignees':
      case 'assignee':
        return w.assignees.map((a) => a.id).join(', ');
      case 'priority':
        return priorityLabel(w.priority);
      case 'labels':
        return w.labels.join(', ');
      case 'due':
        return w.due ?? '';
      default:
        return fmtField((w.frontmatter as Record<string, unknown>)[field]);
    }
  };
  const swimlaneKeys = swimlaneField
    ? [...new Set(filteredItems.map((w) => swimlaneValue(w, swimlaneField) || '(none)'))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      )
    : [];

  const moveColumn = (from: string, to: string): void => {
    const idxFrom = statuses.indexOf(from);
    const idxTo = statuses.indexOf(to);
    if (idxFrom < 0 || idxTo < 0 || idxFrom === idxTo) return;
    const next = [...statuses];
    next.splice(idxFrom, 1);
    next.splice(idxTo, 0, from);
    setColumnOrder(next);
  };

  const renderColumn = (col: string, items: WorkItem[]): ReactElement => (
    <section
      key={col}
      data-col
      data-drop-target={overCol === col && dragCol !== col ? '' : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (overCol !== col) setOverCol(col);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const from = e.dataTransfer.getData('text/plain') || dragCol;
        if (from && from !== col) moveColumn(from, col);
        setDragCol(null);
        setOverCol(null);
      }}
    >
      <h3
        draggable
        onDragStart={(e) => {
          setDragCol(col);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', col);
        }}
        onDragEnd={() => {
          setDragCol(null);
          setOverCol(null);
        }}
      >
        <span>{col}</span>
        <small>{items.length}</small>
      </h3>
      <div data-column>
        {items.length === 0 ? (
          <div data-empty>no items</div>
        ) : (
          items.map((w) => (
            <WorkCard
              key={w.id}
              w={w}
              statuses={statuses}
              resolveTitle={refTitle}
              onOpen={(id) => void load(id)}
              onStatusChange={(id, s) => void changeStatus(id, s)}
            />
          ))
        )}
      </div>
    </section>
  );

  type TableColumn = { key: string; label: string; value: (w: WorkItem) => string };
  const tableColumns: TableColumn[] = [
    { key: 'title', label: 'title', value: (w) => w.title },
    { key: 'status', label: 'status', value: (w) => w.status },
    { key: 'assignees', label: 'assignees', value: (w) => w.assignees.map((a) => a.id).join(', ') },
    { key: 'priority', label: 'priority', value: (w) => priorityLabel(w.priority) },
    { key: 'labels', label: 'labels', value: (w) => w.labels.join(', ') },
    { key: 'project', label: 'project', value: (w) => (w.projectId ? refTitle(w.projectId) : (w.project ?? '')) },
    { key: 'problem', label: 'problem', value: (w) => (w.problemId ? refTitle(w.problemId) : (w.problem ?? '')) },
    { key: 'due', label: 'due', value: (w) => w.due ?? '' },
    ...filterableFields.map((f) => ({
      key: 'field:' + f,
      label: f,
      value: (w: WorkItem) => fmtField((w.frontmatter as Record<string, unknown>)[f]),
    })),
  ];
  const sortedItems = [...filteredItems].sort((a, b) => {
    const col = tableColumns.find((c) => c.key === tableSort.key);
    if (!col) return 0;
    return col.value(a).localeCompare(col.value(b), undefined, { numeric: true, sensitivity: 'base' }) * tableSort.dir;
  });
  const toggleSort = (key: string): void => {
    setTableSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  };

  const groups = (() => {
    const map = new Map<string, Document[]>();
    for (const d of docs) {
      const folder = d.path.includes('/') ? d.path.slice(0, d.path.lastIndexOf('/') + 1) : '';
      const list = map.get(folder);
      if (list) list.push(d);
      else map.set(folder, [d]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([folder, list]) => ({ folder, docs: list.sort((a, b) => a.path.localeCompare(b.path)) }));
  })();

  const headHash = history.length > 0 ? (history[history.length - 1]?.hash ?? '').slice(0, 7) : '';
  const historyNewestFirst = [...history].reverse();
  const saveState = savedMsg || (headHash ? 'autosaved ' + headHash : 'ready');
  const dirty = savedMsg.startsWith('Unsaved');
  const diffLines = diff.split('\n');
  const diffAdded = diffLines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
  const diffRemoved = diffLines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;

  const diagnosticsBar = diagnostics.length > 0 ? (
    <>
      <details data-diagnostics>
        <summary>
          {diagnostics.length} ontology {diagnostics.length === 1 ? 'note' : 'notes'}
        </summary>
        <ul>
          {diagnostics.map((d, i) => (
            <li key={d.documentId + d.key + String(i)} data-severity={d.severity}>
              <a
                href={'#' + d.documentId}
                onClick={(e) => {
                  e.preventDefault();
                  void load(d.documentId);
                }}
              >
                {d.path}
              </a>{' '}
              <code>{d.key}</code> — {d.message}
            </li>
          ))}
        </ul>
      </details>
      <span data-sep>|</span>
    </>
  ) : null;

  const filtersBar = (
    <div data-filters>
      <select
        aria-label="status filter"
        value={filters.status ?? ''}
        onChange={(e) => setFilters({ ...filters, status: e.target.value || undefined })}
      >
        <option value="">all statuses</option>
        {statuses.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        aria-label="assignee filter"
        value={filters.assignee ?? ''}
        onChange={(e) => setFilters({ ...filters, assignee: e.target.value || undefined })}
      >
        <option value="">all assignees</option>
        {assignees.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <select
        aria-label="priority filter"
        value={filters.priority ?? ''}
        onChange={(e) =>
          setFilters({
            ...filters,
            priority: e.target.value === '' ? undefined : Number(e.target.value),
          })
        }
      >
        <option value="">all priorities</option>
        {priorities.map((p) => (
          <option key={p} value={p}>
            {p} · {priorityLabel(p)}
          </option>
        ))}
      </select>
      <select
        aria-label="label filter"
        value={filters.label ?? ''}
        onChange={(e) => setFilters({ ...filters, label: e.target.value || undefined })}
      >
        <option value="">all labels</option>
        {labels.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <select
        aria-label="project filter"
        value={filters.project ?? ''}
        onChange={(e) => setFilters({ ...filters, project: e.target.value || undefined })}
      >
        <option value="">all projects</option>
        {projects.map((key) => (
          <option key={key} value={key}>
            {refTitle(key)}
          </option>
        ))}
      </select>
      <select
        aria-label="problem filter"
        value={filters.problem ?? ''}
        onChange={(e) => setFilters({ ...filters, problem: e.target.value || undefined })}
      >
        <option value="">all problems</option>
        {problems.map((key) => (
          <option key={key} value={key}>
            {refTitle(key)}
          </option>
        ))}
      </select>
      {Object.entries(fieldFilters).map(([field, value]) => (
        <span data-field-filter key={field}>
          <label>{field}</label>
          <input
            aria-label={'filter by ' + field}
            value={value}
            placeholder="value…"
            onChange={(e) => setFieldFilters({ ...fieldFilters, [field]: e.target.value })}
          />
          <button
            type="button"
            aria-label={'remove ' + field + ' filter'}
            onClick={() => {
              const next = { ...fieldFilters };
              delete next[field];
              setFieldFilters(next);
            }}
          >
            ×
          </button>
        </span>
      ))}
      {addableFields.length > 0 ? (
        <select
          aria-label="add field filter"
          value=""
          onChange={(e) => {
            if (e.target.value) setFieldFilters({ ...fieldFilters, [e.target.value]: '' });
          }}
        >
          <option value="">+ filter by field…</option>
          {addableFields.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );

  return (
    <>
      <header>
        <div data-brand>
          <span data-logo aria-hidden="true" />
          <b>tributary</b>
          <small>demo-workspace</small>
        </div>
        <nav aria-label="view">
          <button aria-current={view === 'document' || undefined} onClick={() => setView('document')}>
            document
          </button>
          <button aria-current={view === 'board' || undefined} onClick={() => setView('board')}>
            board
          </button>
          <button aria-current={view === 'list' || undefined} onClick={() => setView('list')}>
            list
          </button>
          <button aria-current={view === 'table' || undefined} onClick={() => setView('table')}>
            table
          </button>
        </nav>
        <div data-git>
          <span>main</span>
          <span data-sep>|</span>
          <span>{headHash || '—'}</span>
          <span data-sep>|</span>
          <span data-status={dirty ? 'unsaved' : 'synced'}>{dirty ? 'unsaved' : 'synced'}</span>
        </div>
        <button data-theme-toggle onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="toggle theme">
          ◐
        </button>
      </header>

      <div data-cols>
        <aside data-side="left">
          <div data-search>
            <input
              placeholder="search workspace…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value.trim()) setResults([]);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onSearch();
              }}
            />
          </div>

          {results.length > 0 ? (
            <>
              <div data-section-label>results · {results.length}</div>
              <div data-results>
                {results.map((d) => (
                  <a
                    key={d.id}
                    href={'#' + d.id}
                    onClick={(e) => {
                      e.preventDefault();
                      void load(d.id);
                    }}
                  >
                    <div>{titleOf(d)}</div>
                    <small>{d.path}</small>
                  </a>
                ))}
              </div>
            </>
          ) : null}

          <div data-section-label>workspace</div>
          <nav data-tree aria-label="workspace">
            {groups.map((g) => (
              <Fragment key={g.folder || 'root'}>
                {g.folder ? <div data-folder>{g.folder}</div> : null}
                {g.docs.map((d) => {
                  const label = kindLabel(d);
                  return (
                    <a
                      key={d.id}
                      href={'#' + d.id}
                      data-root={g.folder === '' || undefined}
                      aria-current={current?.id === d.id || undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        void load(d.id);
                      }}
                    >
                      <span>{titleOf(d)}</span>
                      <small data-status={label}>{label}</small>
                    </a>
                  );
                })}
              </Fragment>
            ))}
          </nav>

          <div data-new-item>
            <input
              placeholder="new work item…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createItem();
              }}
            />
            <button aria-label="create work item" onClick={() => void createItem()}>
              +
            </button>
          </div>
          <div data-new-item>
            <input
              placeholder="new problem…"
              value={newProblem}
              onChange={(e) => setNewProblem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createProblemItem();
              }}
            />
            <button aria-label="create problem" onClick={() => void createProblemItem()}>
              +
            </button>
          </div>
        </aside>

        <main data-view={view}>
          {!current ? (
            <div data-scroll>
              <p>Loading…</p>
            </div>
          ) : view === 'board' ? (
            <>
              <div data-board-toolbar>
                <span>work items · {workItems.length}</span>
                <span data-sep>|</span>
                <label data-swimlane>
                  swimlane
                  <select
                    aria-label="swimlane field"
                    value={swimlaneField}
                    onChange={(e) => setSwimlaneField(e.target.value)}
                  >
                    <option value="">none</option>
                    {swimlaneFields.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
                <span data-sep>|</span>
                {diagnosticsBar}
                {filtersBar}
              </div>
              <div data-board data-swimlanes={swimlaneField ? '' : undefined}>
                {swimlaneKeys.length === 0
                  ? statuses.map((col) => renderColumn(col, filteredItems.filter((w) => w.status === col)))
                  : swimlaneKeys.map((lane) => (
                      <section key={lane} data-swimlane>
                        <h2 data-lane-head>
                          <span>{lane}</span>
                          <small>
                            {filteredItems.filter((w) => (swimlaneValue(w, swimlaneField) || '(none)') === lane).length}
                          </small>
                        </h2>
                        <div data-lane-cols>
                          {statuses.map((col) =>
                            renderColumn(
                              col,
                              filteredItems.filter(
                                (w) => w.status === col && (swimlaneValue(w, swimlaneField) || '(none)') === lane
                              )
                            )
                          )}
                        </div>
                      </section>
                    ))}
              </div>
            </>
          ) : view === 'list' ? (
            <>
              <div data-board-toolbar>
                <span>work items · {workItems.length}</span>
                <span data-sep>|</span>
                {diagnosticsBar}
                {filtersBar}
              </div>
              <div data-list>
                {filteredItems.length === 0 ? (
                  <div data-empty>no items</div>
                ) : (
                  filteredItems.map((w) => (
                    <WorkCard
                      key={w.id}
                      w={w}
                      statuses={statuses}
                      resolveTitle={refTitle}
                      onOpen={(id) => void load(id)}
                      onStatusChange={(id, s) => void changeStatus(id, s)}
                    />
                  ))
                )}
              </div>
            </>
          ) : view === 'table' ? (
            <>
              <div data-board-toolbar>
                <span>work items · {workItems.length}</span>
                <span data-sep>|</span>
                {diagnosticsBar}
                {filtersBar}
              </div>
              <div data-table-wrap>
                <table data-table>
                  <thead>
                    <tr>
                      {tableColumns.map((c) => (
                        <th
                          key={c.key}
                          onClick={() => toggleSort(c.key)}
                          aria-sort={
                            tableSort.key === c.key
                              ? tableSort.dir === 1
                                ? 'ascending'
                                : 'descending'
                              : undefined
                          }
                        >
                          {c.label}
                          {tableSort.key === c.key ? (tableSort.dir === 1 ? ' ↑' : ' ↓') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.length === 0 ? (
                      <tr>
                        <td colSpan={tableColumns.length} data-empty>
                          no items
                        </td>
                      </tr>
                    ) : (
                      sortedItems.map((w) => (
                        <tr key={w.id} onClick={() => void load(w.id)}>
                          {tableColumns.map((c) => (
                            <td key={c.key}>{c.value(w)}</td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div data-toolbar>
                <div data-doc-title>
                  <b>{titleOf(current)}</b>
                  <small>{current.path}</small>
                </div>
                <div data-panes>
                  <button aria-current={pane === 'rendered' || undefined} onClick={() => setPane('rendered')}>
                    rendered
                  </button>
                  <button aria-current={pane === 'source' || undefined} onClick={() => setPane('source')}>
                    source
                  </button>
                  <button aria-current={pane === 'diff' || undefined} onClick={() => setPane('diff')}>
                    diff
                  </button>
                </div>
              </div>

              {pane === 'diff' ? (
                <>
                  <div data-diff-head>
                    <small>working tree vs {headHash || 'HEAD'}</small>
                    <span data-spacer />
                    <span data-status="ok">+{diffAdded}</span>
                    <span data-status="error">−{diffRemoved}</span>
                  </div>
                  <pre data-diff>{diff || 'no changes'}</pre>
                </>
              ) : (
                <>
                  <div data-scroll>
                    <div data-doc={current.id} onClick={onDocClick}>
                      <CellContext.Provider value={cellResolver}>
                        <TransclusionContext.Provider value={makeTransclusionResolver(docs)}>
                          <EditContext.Provider value={editResolver}>
                            <DocumentView document={current} />
                          </EditContext.Provider>
                        </TransclusionContext.Provider>
                      </CellContext.Provider>
                    </div>
                  </div>

                  {pane === 'source' ? (
                    <section data-editor>
                      <div data-editor-head>
                        <span>source · {current.path}</span>
                        <span data-editor-actions>
                          <span data-status={dirty ? 'unsaved' : undefined}>{saveState}</span>
                          <button onClick={() => void onSave()}>checkpoint ⌘S</button>
                        </span>
                      </div>
                      <div data-editor-body>
                        <CodeMirror
                          value={source}
                          onChange={(v) => onSourceChange(v)}
                          extensions={[markdown()]}
                          theme={theme === 'dark' ? 'dark' : 'light'}
                          height="172px"
                        />
                      </div>
                    </section>
                  ) : null}
                </>
              )}
            </>
          )}
        </main>

        <aside data-side="right">
          <section>
            <h4>linked from</h4>
            <div data-link-list>
              {backlinks.length === 0 ? (
                <small style={{ padding: '3px 12px' }}>none</small>
              ) : (
                backlinks.map((b) => (
                  <a
                    key={b.id}
                    href={'#' + b.id}
                    onClick={(e) => {
                      e.preventDefault();
                      void load(b.id);
                    }}
                  >
                    {titleOf(b)} <small>· {b.path}</small>
                  </a>
                ))
              )}
            </div>
          </section>

          <section>
            <h4>history</h4>
            <ol data-history>
              {historyNewestFirst.map((h) => (
                <li key={h.hash}>
                  <div data-history-row>
                    <span>{h.hash.slice(0, 7)}</span>
                    <small>{relativeTime(h.date)}</small>
                  </div>
                  <div>
                    <small>{h.message}</small>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h4>remote</h4>
            <div data-remote>
              <div data-kv>
                <small>origin</small>
                <span>—</span>
              </div>
              <div data-kv>
                <small>ahead / behind</small>
                <span>0 / 0</span>
              </div>
              <div data-actions>
                <button onClick={() => void onSync()}>sync</button>
                <button onClick={() => setRenameOpen(!renameOpen)}>rename…</button>
              </div>
              {renameOpen ? (
                <div data-actions>
                  <input
                    placeholder="items/foo.md"
                    value={renamePath}
                    onChange={(e) => setRenamePath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void onRename();
                    }}
                  />
                  <button onClick={() => void onRename()}>rename</button>
                </div>
              ) : null}
              <small>{syncStatus}</small>
            </div>
          </section>

          <section>
            <h4>frontmatter</h4>
            <dl data-frontmatter>
              <dt>id</dt>
              <dd>{current?.id}</dd>
              <dt>kind</dt>
              <dd>{current?.frontmatter.kind ?? '—'}</dd>
              <dt>cells</dt>
              <dd>{cellsRef.current.length}</dd>
            </dl>
          </section>
        </aside>
      </div>

      <footer>
        <span data-status={dirty ? 'unsaved' : undefined}>{saveState}</span>
        <span data-sep>|</span>
        <span>{cellsRef.current.length} cells evaluated</span>
        <span data-sep>|</span>
        <span>{current ? current.id + ' committed as ' + (headHash || '—') : '—'}</span>
        <span data-spacer />
        <span>local-first · git-backed</span>
      </footer>
    </>
  );
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
