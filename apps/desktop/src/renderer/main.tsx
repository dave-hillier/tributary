import { StrictMode, Fragment, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentView, CellContext, TransclusionContext } from '@tributary/components';
import type { CellResolver, CellResult, TransclusionResolver } from '@tributary/components';
import { findSection } from '@tributary/markdown';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import type { Document, WorkItem, Cell } from '@tributary/api';
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

type View = 'document' | 'board';
type Pane = 'rendered' | 'source' | 'diff';

const COLUMN_ORDER = ['todo', 'doing', 'done'];

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
  const [renameOpen, setRenameOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [cellResults, setCellResults] = useState<Map<Cell, CellResult>>(new Map());
  const cellsRef = useRef<Cell[]>([]);
  const [backlinks, setBacklinks] = useState<Document[]>([]);
  const [diff, setDiff] = useState('');
  const [filters, setFilters] = useState<{ status?: string; assignee?: string; priority?: string; project?: string }>({});
  const [view, setView] = useState<View>('document');
  const [pane, setPane] = useState<Pane>('rendered');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
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
      const results = await window.tributary
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

  // ── Derived values ─────────────────────────────────────────────────────

  const statuses = [...new Set([...COLUMN_ORDER, ...workItems.map((w) => w.status)])];
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
                    onChange={(e) => setFilters({ ...filters, priority: e.target.value || undefined })}
                  >
                    <option value="">all priorities</option>
                    {priorities.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="project filter"
                    value={filters.project ?? ''}
                    onChange={(e) => setFilters({ ...filters, project: e.target.value || undefined })}
                  >
                    <option value="">all projects</option>
                    {projects.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div data-board>
                {statuses.map((col) => {
                  const items = filteredItems.filter((w) => w.status === col);
                  return (
                    <section key={col}>
                      <h3>
                        <span>{col}</span>
                        <small>{items.length}</small>
                      </h3>
                      <div data-column>
                        {items.length === 0 ? (
                          <div data-empty>no items</div>
                        ) : (
                          items.map((w) => (
                            <article key={w.id} onClick={() => void load(w.id)}>
                              <div data-card-head>
                                <b>{w.title}</b>
                                <span data-priority={w.priority ?? undefined}>{w.priority ?? ''}</span>
                              </div>
                              <div data-card-path>
                                {w.path} · {w.project ?? '—'}
                              </div>
                              <div data-card-foot>
                                <span>{w.assignee ?? '—'}</span>
                                <select
                                  aria-label={'status of ' + w.title}
                                  value={w.status}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => void changeStatus(w.id, e.target.value)}
                                >
                                  {statuses.map((s) => (
                                    <option key={s} value={s}>
                                      {s}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </article>
                          ))
                        )}
                      </div>
                    </section>
                  );
                })}
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
                          <DocumentView document={current} />
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
