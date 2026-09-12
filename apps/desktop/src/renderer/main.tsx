import { StrictMode, useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentView } from '@tributary/components';
import type { Document } from '@tributary/api';

interface HistoryEntry {
  hash: string;
  message: string;
  date: string;
}

interface TributaryApi {
  getDocument: (id: string) => Promise<Document | null>;
  listDocuments: () => Promise<Document[]>;
  saveDocument: (doc: Document, message?: string) => Promise<{ commit: string }>;
  history: (id: string) => Promise<HistoryEntry[]>;
  resolveLink: (target: string) => Promise<Document | null>;
  search: (query: string) => Promise<Document[]>;
}

declare global {
  interface Window {
    tributary: TributaryApi;
  }
}

function App(): JSX.Element {
  const [docs, setDocs] = useState<Document[]>([]);
  const [current, setCurrent] = useState<Document | null>(null);
  const [source, setSource] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [savedMsg, setSavedMsg] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Document[]>([]);

  const load = async (id: string): Promise<void> => {
    const d = await window.tributary.getDocument(id);
    if (d) {
      setCurrent(d);
      setSource(d.source ?? '');
      setHistory(await window.tributary.history(id));
    }
  };

  useEffect(() => {
    (async () => {
      const list = await window.tributary.listDocuments();
      setDocs(list);
      const home = list.find((d) => d.id === 'index') ?? list[0];
      if (home) await load(home.id);
    })();
  }, []);

  const onSave = async (): Promise<void> => {
    if (!current) return;
    const { commit } = await window.tributary.saveDocument({ ...current, source }, 'edit from UI');
    setSavedMsg('Saved ' + commit.slice(0, 7));
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

  return (
    <div>
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
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            rows={10}
            style={{ width: '100%' }}
          />
          <button onClick={() => void onSave()}>Save (checkpoint)</button>
          {savedMsg ? <p>{savedMsg}</p> : null}
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