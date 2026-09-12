import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Document, DocumentId, WorkItem } from '@tributary/api';
import { collectTargets } from './index.js';

/** Concatenate plain text from a document AST (for FTS indexing). */
function extractText(doc: Document): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    const n = node as { type?: string; value?: unknown; children?: unknown[] };
    if (n.type === 'text' || n.type === 'inlineCode') {
      if (typeof n.value === 'string') parts.push(n.value);
    }
    if (n.children) for (const c of n.children) walk(c);
  };
  walk(doc.root);
  return parts.join(' ');
}

/** Wrap a raw query as an FTS5 phrase so user input is matched literally. */
function ftsQuery(raw: string): string {
  return '"' + raw.replace(/"/g, '""') + '"';
}

/**
 * The final-shape derived index: SQLite + FTS5 (arch §5.3). A disposable file
 * (or :memory: database) rebuilt from Git; deleting it must preserve behaviour.
 */
export class SqliteIndex {
  private db: InstanceType<typeof Database>;
  private docs: Document[] = [];

  constructor(path: string = ':memory:') {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        path TEXT UNIQUE,
        title TEXT,
        kind TEXT,
        status TEXT,
        assignee TEXT,
        priority TEXT,
        project TEXT
      );
      CREATE TABLE IF NOT EXISTS links (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(id UNINDEXED, title, body);
    `);
  }

  /** Drop and rebuild all derived state from the parsed documents. */
  rebuild(documents: Document[]): void {
    this.docs = documents;
    const byId = new Map(documents.map((d) => [d.id, d]));
    const byPath = new Map(documents.map((d) => [d.path, d]));
    const resolveId = (t: string): DocumentId | undefined =>
      byId.get(t)?.id ?? byPath.get(t)?.id ?? byPath.get(t + '.md')?.id;

    const insertDoc = this.db.prepare(
      'INSERT INTO documents (id, path, title, kind, status, assignee, priority, project) VALUES (?,?,?,?,?,?,?,?)'
    );
    const insertLink = this.db.prepare('INSERT OR IGNORE INTO links (from_id, to_id) VALUES (?,?)');
    const insertFts = this.db.prepare('INSERT INTO docs_fts (id, title, body) VALUES (?,?,?)');

    const tx = this.db.transaction(() => {
      this.db.exec('DELETE FROM documents');
      this.db.exec('DELETE FROM links');
      this.db.exec('DELETE FROM docs_fts');
      for (const d of documents) {
        const fm = d.frontmatter;
        insertDoc.run(
          d.id,
          d.path,
          fm.title ?? d.id,
          fm.kind ?? null,
          fm.status ?? null,
          fm.assignee ?? null,
          fm.priority ?? null,
          fm.project ?? null
        );
        insertFts.run(d.id, fm.title ?? '', extractText(d));
        for (const target of collectTargets(d)) {
          const toId = resolveId(target);
          if (toId) insertLink.run(d.id, toId);
        }
      }
    });
    tx();
  }

  resolve(target: string): Document | undefined {
    const row = this.db
      .prepare('SELECT id FROM documents WHERE id = ? OR path = ? OR path = ? LIMIT 1')
      .get(target, target, target + '.md') as { id?: string } | undefined;
    if (!row?.id) return undefined;
    return this.docs.find((d) => d.id === row.id);
  }

  links(id: DocumentId): DocumentId[] {
    return (this.db.prepare('SELECT to_id FROM links WHERE from_id = ?').all(id) as { to_id: string }[]).map((r) => r.to_id);
  }

  backlinks(id: DocumentId): DocumentId[] {
    return (this.db.prepare('SELECT from_id FROM links WHERE to_id = ?').all(id) as { from_id: string }[]).map((r) => r.from_id);
  }

  workItems(): WorkItem[] {
    const rows = this.db
      .prepare("SELECT id, path, title, status, assignee, priority, project FROM documents WHERE kind = 'work-item'")
      .all() as Array<{ id: string; path: string; title: string; status: string | null; assignee: string | null; priority: string | null; project: string | null }>;
    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      title: r.title,
      status: r.status ?? 'todo',
      assignee: r.assignee ?? undefined,
      priority: r.priority ?? undefined,
      project: r.project ?? undefined,
    }));
  }

  /** Full-text search over document titles + body, ranked. */
  search(rawQuery: string): Document[] {
    const rows = this.db
      .prepare('SELECT id FROM docs_fts WHERE docs_fts MATCH ? ORDER BY rank')
      .all(ftsQuery(rawQuery)) as { id: string }[];
    return rows.map((r) => this.docs.find((d) => d.id === r.id)).filter((d): d is Document => d !== undefined);
  }

  close(): void {
    this.db.close();
  }
}