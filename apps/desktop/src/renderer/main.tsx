import { StrictMode, useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentView } from '@tributary/components';
import type { Document, WorkItem } from '@tributary/api';

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
  search: (query: string) => Promise<Document[]>;
  listWorkItems: () => Promise<WorkItem[]>;
  updateWorkItem: (id: string, patch: Record<string, unknown>) => Promise<Document>;
  createWorkItem: (input: NewWorkItemInput) => Promise<Document>;
  renameDocument: (id: string, newPath: string) => Promise<Document>;
}

declare global {
  interface Window {
    tributary: TributaryApi;
  }
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

  const load = async (id: string): Promise<void> => {
    const d = await window.tributary.getDocument(id);
    if (d) {
      setCurrent(d);
      setSource(d.source ?? '');
      setHistory(await window.tributary.history(id));
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
    const result = await window.tributary.saveDocument({ ...current, source }, 'edit from UI');
    setSavedMsg(result.changed ? 'Saved ' + (result.commit ?? '').slice(0, 7) : 'No changes');
    await load(current.id);
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

  const onRename = async (): Promise<void> => {
    if (!current || !renamePath.trim()) return;
    await window.tributary.renameDocument(current.id, renamePath.trim());
    setRenamePath('');
    await load(current.id);
    await loadWorkItems();
    setDocs(await window.tributary.listDocuments());
  };

  const statuses = [...new Set(workItems.map((w) => w.status))].sort();

  return (
    <div>
      <h2>Work items</h2>
      <div style={{ display: 'flex', gap: '1rem' }}>
        {statuses.map((status) => (
          <div key={status} style={{ flex: 1, border: '1px solid #ccc', padding: '0.5rem' }}>
            <h3>{status}</h3>
            {workItems
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
            <DocumentView document={current} />
          </div>
          <hr />
          <textarea value={source} onChange={(e) => setSource(e.target.value)} rows={10} style={{ width: '100%' }} />
          <button onClick={() => void onSave()}>Save (checkpoint)</button>
          {savedMsg ? <p>{savedMsg}</p> : null}
          <div>
            <input value={renamePath} onChange={(e) => setRenamePath(e.target.value)} placeholder="Rename to path (e.g. items/foo.md)" />
            <button onClick={() => void onRename()}>Rename</button>
          </div>
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