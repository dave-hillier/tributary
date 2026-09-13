import { StrictMode, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentView, CellContext } from '@tributary/components';
import type { CellResolver, CellResult } from '@tributary/components';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import type { Document, WorkItem, Cell } from '@tributary/api';

interface HistoryEntry {
  hash: string;
  message: string;
  date: string;
}

interface SaveResult {
  commit: string | null;
  changed: boolean;
}

interface NewWorkItemInput {
  title: string;
  status?: string;
  assignee?: string;
  priority?: string;
  project?: string;
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
  createWorkItem: (input: NewWorkItemInput) => Promise<Document>;
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
  const [renamePath, setRenamePath] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [cellResults, setCellResults] = useState<Map<Cell, CellResult>>(new Map());
  const cellsRef = useRef<Cell[]>([]);
  const [backlinks, setBacklinks] = useState<Document[]>([]);
  const [diff, setDiff] = useState('');
  const [filters, setFilters] = useState<{ status?: string; assignee?: string; priority?: string; project?: string }>({});
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSource = useRef('');

  const load = async (id: string): Promise<void> => {
    const d = await window.tributary.getDocument(id);
    if (d) {
      setCurrent(d);
      setSource(d.source ?? '');
      lastSavedSource.current = d.source ?? '';
      setHistory(await window.tributary.history(id).catch(() => []));
      setBacklinks(await window.tributary.backlinks(id).catch(() => []));
      setDiff(await window.tributary.diff(id).catch(() => ''));
      const cells = collectCells(d);
      cellsRef.current = cells;
      const results = await window.tributary.evaluateDocument(d.id, cells.map((c) => ({ lang: c.lang, source: c.value as string }))).catch(() => [] as CellResult[]);
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
  };

  useEffect(() => {
    (async () => {
      const list = await window.tributary.listDocuments();
      setDocs(list);
      const home = list.find((d) => d.id === 'index') ?? list[0];
      if (home) await load(home.id);
      await loadWorkItems();
    })();
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
    await load(current.id);
    await loadWorkItems();
    setDocs(await window.tributary.listDocuments());
  };

  const statuses = [...new Set(workItems.map((w) => w.status))].sort();
  const assignees = [...new Set(workItems.map((w) => w.assignee).filter((x): x is string => x != null))].sort();
  const priorities = [...new Set(workItems.map((w) => w.priority).filter((x): x is string => x != null))].sort();
  const projects = [...new Set(workItems.map((w) => w.project).filter((x): x is string => x != null))].sort();
  const filteredItems = workItems.filter(
    (w) =>
      (!filters.status || w.status === filters.status) &&
      (!filters.assignee || w.assignee === filters.assignee) &&
      (!filters.priority || w.priority === filters.priority) &&
      (!filters.project || w.project === filters.project)
  );

  return (
    <div>
      <h2>Work items</h2>
      <div style={{ margin: '0.5rem 0' }}>
        <select aria-label="status filter" value={filters.status ?? ''} onChange={(e) => setFilters({ ...filters, status: e.target.value || undefined })}>
          <option value="">all statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>{' '}
        <select aria-label="assignee filter" value={filters.assignee ?? ''} onChange={(e) => setFilters({ ...filters, assignee: e.target.value || undefined })}>
          <option value="">all assignees</option>
          {assignees.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>{' '}
        <select aria-label="priority filter" value={filters.priority ?? ''} onChange={(e) => setFilters({ ...filters, priority: e.target.value || undefined })}>
          <option value="">all priorities</option>
          {priorities.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>{' '}
        <select aria-label="project filter" value={filters.project ?? ''} onChange={(e) => setFilters({ ...filters, project: e.target.value || undefined })}>
          <option value="">all projects</option>
          {projects.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: '1rem' }}>
        {statuses.map((status) => (
          <div key={status} style={{ flex: 1, border: '1px solid #ccc', padding: '0.5rem' }}>
            <h3>{status}</h3>
            {filteredItems
              .filter((w) => w.status === status)
              .map((w) => (
                <div key={w.id} style={{ marginBottom: '0.5rem' }}>
                  <button onClick={() => void load(w.id)}>{w.title}</button>
                  <div>assignee: {w.assignee ?? '—'} · priority: {w.priority ?? '—'}</div>
                  <select value={w.status} onChange={(e) => void changeStatus(w.id, e.target.value)}>
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
          </div>
        ))}
      </div>
      <div style={{ marginTop: '0.5rem' }}>
        <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New work item title" />
        <button onClick={() => void createItem()}>New work item</button>
      </div>

      <hr />

      <div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onSearch();
          }}
          placeholder="Search workspace…"
        />
        <button onClick={() => void onSearch()}>Search</button>
        {results.length > 0 ? (
          <ul>
            {results.map((d) => (
              <li key={d.id}>
                <button onClick={() => void load(d.id)}>{d.frontmatter.title ?? d.id}</button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div style={{ margin: '0.5rem 0' }}>
        <button onClick={() => void onSync()}>Sync</button>
        {syncStatus ? <span> {syncStatus}</span> : null}
      </div>
      <nav>
        {docs.map((d) => (
          <button key={d.id} onClick={() => void load(d.id)}>
            {d.frontmatter.title ?? d.id}
          </button>
        ))}
      </nav>
      {current ? (
        <main>
          <h1>{current.frontmatter.title ?? current.id}</h1>
          <div onClick={onDocClick}>
            <CellContext.Provider value={{ resolve: (cell) => cellResults.get(cell), update: updateCell }}>
              <DocumentView document={current} />
            </CellContext.Provider>
          </div>
          <hr />
          <CodeMirror value={source} onChange={(v) => onSourceChange(v)} extensions={[markdown()]} height="240px" />
          <button onClick={() => void onSave()}>Save (checkpoint)</button>
          {savedMsg ? <p>{savedMsg}</p> : null}
          <div>
            <input value={renamePath} onChange={(e) => setRenamePath(e.target.value)} placeholder="Rename to path (e.g. items/foo.md)" />
            <button onClick={() => void onRename()}>Rename</button>
          </div>
          <h3>Linked from</h3>
          <ul>
            {backlinks.map((b) => (
              <li key={b.id}>
                <button onClick={() => void load(b.id)}>{b.frontmatter.title ?? b.id}</button>
              </li>
            ))}
          </ul>
          <h3>Diff (last change)</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{diff}</pre>
          <h3>History</h3>
          <ul>
            {history.map((h) => (
              <li key={h.hash}>
                {h.hash.slice(0, 7)} {h.message}
              </li>
            ))}
          </ul>
        </main>
      ) : (
        <p>Loading…</p>
      )}
    </div>
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