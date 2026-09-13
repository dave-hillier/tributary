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
 *
 * Ownership split (finding 7):
 * - SQLite owns the *queries*: links/backlinks relations, FTS5 full-text
 *   search, and the typed work-item projection (`work_items`).
 * - The in-memory `this.docs` list (with id/path maps) owns document
 *   *resolution*, because the application always holds parsed documents; a
 *   `documents` table duplicating them added storage without a consumer.
 *   `resolve()` therefore serves from the maps and never hits SQLite.
 */
export class SqliteIndex {
  private db: InstanceType<typeof Database>;
  private docs: Document[] = [];
  private byId = new Map<DocumentId, Document>();
  private byPath = new Map<string, Document>();

  constructor(path: string = ':memory:') {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new Database(path);
    // WAL is a no-op on :memory:, so only request it for file-backed indexes.
    if (path !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS links (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id)
      );
      CREATE TABLE IF NOT EXISTS work_items (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'todo',
        assignee TEXT,
        priority TEXT,
        project TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(id UNINDEXED, title, body);
    `);
  }

  /** Drop and rebuild all derived state from the parsed documents. */
  rebuild(documents: Document[]): void {
    this.docs = documents;
    this.byId = new Map(documents.map((d) => [d.id, d] as const));
    this.byPath = new Map(documents.map((d) => [d.path, d] as const));
    const byId = this.byId;
    const byPath = this.byPath;
    const resolveId = (t: string): DocumentId | undefined =>
      byId.get(t)?.id ?? byPath.get(t)?.id ?? byPath.get(t + '.md')?.id;

    const insertWorkItem = this.db.prepare(
      'INSERT OR REPLACE INTO work_items (id, status, assignee, priority, project) VALUES (?,?,?,?,?)'
    );
    const insertLink = this.db.prepare('INSERT OR IGNORE INTO links (from_id, to_id) VALUES (?,?)');
    const insertFts = this.db.prepare('INSERT INTO docs_fts (id, title, body) VALUES (?,?,?)');

    const tx = this.db.transaction(() => {
      this.db.exec('DELETE FROM links');
      this.db.exec('DELETE FROM work_items');
      this.db.exec('DELETE FROM docs_fts');
      for (const d of documents) {
        const fm = d.frontmatter;
        if (fm.kind === 'work-item') {
          insertWorkItem.run(
            d.id,
            fm.status ?? 'todo',
            fm.assignee ?? null,
            fm.priority ?? null,
            fm.project ?? null
          );
        }
        insertFts.run(d.id, fm.title ?? '', extractText(d));
        for (const target of collectTargets(d)) {
          const toId = resolveId(target);
          if (toId) insertLink.run(d.id, toId);
        }
      }
    });
    tx();
  }

  /** Resolve a wiki-link/transclusion target by id or path (in-memory maps). */
  resolve(target: string): Document | undefined {
    return this.byId.get(target) ?? this.byPath.get(target) ?? this.byPath.get(target + '.md');
  }

  links(id: DocumentId): DocumentId[] {
    return (this.db.prepare('SELECT to_id FROM links WHERE from_id = ?').all(id) as { to_id: string }[]).map((r) => r.to_id);
  }

  backlinks(id: DocumentId): DocumentId[] {
    return (this.db.prepare('SELECT from_id FROM links WHERE to_id = ?').all(id) as { from_id: string }[]).map((r) => r.from_id);
  }

  /** Typed work-item projection, served from the SQLite `work_items` table. */
  workItems(): WorkItem[] {
    const rows = this.db
      .prepare('SELECT id, status, assignee, priority, project FROM work_items ORDER BY id')
      .all() as Array<{ id: string; status: string; assignee: string | null; priority: string | null; project: string | null }>;
    return rows.map((r) => {
      const path = this.byId.get(r.id)?.path ?? r.id;
      return {
        id: r.id,
        path,
        title: this.byId.get(r.id)?.frontmatter.title ?? r.id,
        status: r.status,
        assignee: r.assignee ?? undefined,
        priority: r.priority ?? undefined,
        project: r.project ?? undefined,
      };
    });
  }

  /** Full-text search over document titles + body, ranked. */
  search(rawQuery: string): Document[] {
    const rows = this.db
      .prepare('SELECT id FROM docs_fts WHERE docs_fts MATCH ? ORDER BY rank')
      .all(ftsQuery(rawQuery)) as { id: string }[];
    return rows
      .map((r) => this.byId.get(r.id))
      .filter((d): d is Document => d !== undefined);
  }

  close(): void {
    this.db.close();
  }
}