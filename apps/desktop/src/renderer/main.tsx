import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentView } from '@tributary/components';
import type { Document } from '@tributary/api';

declare global {
  interface Window {
    tributary: {
      getDocument: (id: string) => Promise<Document>;
      listDocuments: () => Promise<Document[]>;
    };
  }
}

function App() {
  const [doc, setDoc] = useState<Document | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    window.tributary
      .getDocument('index')
      .then(setDoc)
      .catch((e: unknown) => setErr(String(e)));
  }, []);

  if (err) return <pre>{err}</pre>;
  if (!doc) return <p>Loading…</p>;
  return <DocumentView document={doc} />;
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}