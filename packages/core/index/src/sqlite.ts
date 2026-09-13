import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Document, DocumentId, EntityRef, RelationKind, WorkItem } from '@tributary/api';
import {
  formatRef,
  frontmatterRelations,
  isWorkItem,
  parseRef,
  projectWorkItem,
  resolveDocument,
} from '@tributary/ontology';
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
 * - The in-memory `this.docs` list owns document *resolution*, because the
 *   application always holds parsed documents; a `documents` table duplicating
 *   them added storage without a consumer. `resolve()` therefore delegates to
 *   the shared ontology resolver (ADR-005 §7) and never hits SQLite.
 */
export class SqliteIndex {
  private db: InstanceType<typeof Database>;
  private docs: Document[] = [];
  private byId = new Map<DocumentId, Document>();

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
      -- Typed edges (ADR-005 §8): 'link'/'transclusion' are prose references,
      -- 'project'/'parent'/'blocks' are frontmatter relations.
      CREATE TABLE IF NOT EXISTS links (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        relation TEXT NOT NULL DEFAULT 'link',
        PRIMARY KEY (from_id, to_id, relation)
      );
      CREATE TABLE IF NOT EXISTS work_items (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'todo',
        priority INTEGER,
        project TEXT,
        project_id TEXT,
        due TEXT
      );
      -- Multi-valued work-item fields, normalised out of the item row.
      CREATE TABLE IF NOT EXISTS work_item_assignees (
        id TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        PRIMARY KEY (id, entity, entity_id)
      );
      CREATE TABLE IF NOT EXISTS work_item_labels (
        id TEXT NOT NULL,
        label TEXT NOT NULL,
        PRIMARY KEY (id, label)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(id UNINDEXED, title, body);
    `);
  }

  /** Drop and rebuild all derived state from the parsed documents. */
  rebuild(documents: Document[]): void {
    this.docs = documents;
    this.byId = new Map(documents.map((d) => [d.id, d] as const));
    const resolveId = (t: string): DocumentId | undefined => resolveDocument(documents, t)?.id;

    const insertWorkItem = this.db.prepare(
      'INSERT OR REPLACE INTO work_items (id, status, priority, project, project_id, due) VALUES (?,?,?,?,?,?)'
    );
    const insertAssignee = this.db.prepare(
      'INSERT OR IGNORE INTO work_item_assignees (id, entity, entity_id) VALUES (?,?,?)'
    );
    const insertLabel = this.db.prepare('INSERT OR IGNORE INTO work_item_labels (id, label) VALUES (?,?)');
    const insertLink = this.db.prepare(
      'INSERT OR IGNORE INTO links (from_id, to_id, relation) VALUES (?,?,?)'
    );
    const insertFts = this.db.prepare('INSERT INTO docs_fts (id, title, body) VALUES (?,?,?)');

    const tx = this.db.transaction(() => {
      this.db.exec('DELETE FROM links');
      this.db.exec('DELETE FROM work_items');
      this.db.exec('DELETE FROM work_item_assignees');
      this.db.exec('DELETE FROM work_item_labels');
      this.db.exec('DELETE FROM docs_fts');
      for (const d of documents) {
        const fm = d.frontmatter;
        if (isWorkItem(fm)) {
          const item = projectWorkItem(d, documents);
          insertWorkItem.run(
            item.id,
            item.status,
            item.priority ?? null,
            item.project ?? null,
            item.projectId ?? null,
            item.due ?? null
          );
          for (const a of item.assignees) insertAssignee.run(item.id, a.entity, a.id);
          for (const l of item.labels) insertLabel.run(item.id, l);
        }
        insertFts.run(d.id, fm.title ?? '', extractText(d));
        for (const target of collectTargets(d)) {
          const toId = resolveId(target);
          if (toId) insertLink.run(d.id, toId, 'link');
        }
        for (const rel of frontmatterRelations(d)) {
          const toId = resolveId(rel.target);
          if (toId) insertLink.run(d.id, toId, rel.kind);
        }
      }
    });
    tx();
  }

  /**
   * Resolve a target by id, path, alias or title — the shared ontology rule
   * (ADR-005 §7), so this agrees with the shell's resolution.
   */
  resolve(target: string): Document | undefined {
    return resolveDocument(this.docs, target);
  }

  /** Outgoing edges, optionally narrowed to one relation kind (ADR-005 §8). */
  links(id: DocumentId, relation?: RelationKind): DocumentId[] {
    const sql = relation
      ? 'SELECT to_id FROM links WHERE from_id = ? AND relation = ?'
      : 'SELECT to_id FROM links WHERE from_id = ?';
    const args = relation ? [id, relation] : [id];
    return (this.db.prepare(sql).all(...args) as { to_id: string }[]).map((r) => r.to_id);
  }

  /** Incoming edges, optionally narrowed to one relation kind. */
  backlinks(id: DocumentId, relation?: RelationKind): DocumentId[] {
    const sql = relation
      ? 'SELECT from_id FROM links WHERE to_id = ? AND relation = ?'
      : 'SELECT from_id FROM links WHERE to_id = ?';
    const args = relation ? [id, relation] : [id];
    return (this.db.prepare(sql).all(...args) as { from_id: string }[]).map((r) => r.from_id);
  }

  /** The work items belonging to a project document, by resolved id. */
  itemsInProject(projectId: DocumentId): WorkItem[] {
    const rows = this.db
      .prepare('SELECT id FROM work_items WHERE project_id = ? ORDER BY id')
      .all(projectId) as { id: string }[];
    const ids = new Set(rows.map((r) => r.id));
    return this.workItems().filter((w) => ids.has(w.id));
  }

  /** Typed work-item projection, served from the SQLite tables (ADR-005). */
  workItems(): WorkItem[] {
    const rows = this.db
      .prepare('SELECT id, status, priority, project, project_id, due FROM work_items ORDER BY id')
      .all() as Array<{
      id: string;
      status: string;
      priority: number | null;
      project: string | null;
      project_id: string | null;
      due: string | null;
    }>;
    const assigneeRows = this.db
      .prepare('SELECT id, entity, entity_id FROM work_item_assignees ORDER BY entity, entity_id')
      .all() as Array<{ id: string; entity: string; entity_id: string }>;
    const labelRows = this.db
      .prepare('SELECT id, label FROM work_item_labels ORDER BY label')
      .all() as Array<{ id: string; label: string }>;

    const assigneesById = new Map<string, EntityRef[]>();
    for (const r of assigneeRows) {
      const ref = parseRef(r.entity + ':' + r.entity_id, r.entity);
      const list = assigneesById.get(r.id) ?? [];
      list.push({ ...ref, raw: formatRef(ref) });
      assigneesById.set(r.id, list);
    }
    const labelsById = new Map<string, string[]>();
    for (const r of labelRows) {
      const list = labelsById.get(r.id) ?? [];
      list.push(r.label);
      labelsById.set(r.id, list);
    }

    return rows.map((r) => {
      const doc = this.byId.get(r.id);
      return {
        id: r.id,
        path: doc?.path ?? r.id,
        title: doc?.frontmatter.title ?? r.id,
        status: r.status,
        assignees: assigneesById.get(r.id) ?? [],
        labels: labelsById.get(r.id) ?? [],
        priority: r.priority ?? undefined,
        project: r.project ?? undefined,
        projectId: r.project_id ?? undefined,
        due: r.due ?? undefined,
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