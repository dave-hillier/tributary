/**
 * @tributary/ontology — the work-item ontology (ADR-005).
 *
 * Owns the gap between raw YAML frontmatter and the canonical typed model:
 * reference parsing, vocabularies, normalisation, name resolution and
 * validation. Pure and Electron-free; depends only on `@tributary/api`.
 *
 * The guiding rule is architecture §4.2: frontmatter is **schema-tolerant**.
 * Nothing here rejects a document. Unknown vocabulary and deprecated spellings
 * are read, normalised and *reported* — never refused — so a hand-edited file
 * can never cost a user their text.
 */

import type {
  Document,
  DocumentId,
  DocumentFrontmatter,
  EntityRef,
  WorkItem,
} from '@tributary/api';

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/** Known work-item statuses. Other values are allowed, and reported. */
export const STATUSES = ['todo', 'doing', 'blocked', 'done'] as const;

/** Known document types (arch §3.2's continuum). */
export const TYPES = ['index', 'wiki', 'work-item', 'project', 'problem', 'report', 'note'] as const;

/** Priority scale: 0 most urgent … 4 least (arch §3.3 `priority: 2`). */
export const PRIORITY_MIN = 0;
export const PRIORITY_MAX = 4;

/** Legacy string priorities, mapped onto the numeric scale on read. */
const PRIORITY_NAMES: Record<string, number> = {
  urgent: 0,
  critical: 0,
  high: 1,
  medium: 2,
  normal: 2,
  low: 3,
  none: 4,
};

const DEFAULT_STATUS = 'todo';

// ---------------------------------------------------------------------------
// Entity references
// ---------------------------------------------------------------------------

/**
 * Parse `"<entity>:<id>"` into a typed reference. A bare string with no prefix
 * takes `fallbackEntity`, so `assignee: dave` still means a user.
 *
 * A value containing `://` is left whole (it is a URL, not a reference).
 */
export function parseRef(raw: string, fallbackEntity = 'doc'): EntityRef {
  const value = raw.trim();
  const colon = value.indexOf(':');
  if (colon > 0 && !value.startsWith('http') && !value.includes('://')) {
    const entity = value.slice(0, colon).trim();
    const id = value.slice(colon + 1).trim();
    if (entity !== '' && id !== '') return { entity, id, raw: value };
  }
  return { entity: fallbackEntity, id: value, raw: value };
}

/** Render a reference back to its canonical `entity:id` string. */
export function formatRef(ref: EntityRef): string {
  return ref.entity + ':' + ref.id;
}

/** Coerce a YAML scalar-or-list into a string list, tolerating either shape. */
function toList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((v) => v != null).map((v) => String(v).trim()).filter((v) => v !== '');
  const s = String(value).trim();
  return s === '' ? [] : [s];
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** The document's type, reading the deprecated `kind` alias (ADR-005 §1). */
export function documentType(fm: DocumentFrontmatter): string | undefined {
  const t = fm.type ?? fm.kind;
  return typeof t === 'string' ? t : undefined;
}

export function isWorkItem(fm: DocumentFrontmatter): boolean {
  return documentType(fm) === 'work-item';
}

/** Assignees as typed `user:` refs, folding in the deprecated singular key. */
export function assignees(fm: DocumentFrontmatter): EntityRef[] {
  const raw = fm.assignees != null ? toList(fm.assignees) : toList(fm.assignee);
  return raw.map((r) => parseRef(r, 'user'));
}

/**
 * Priority on the numeric scale, mapping legacy names. Out-of-range numbers are
 * clamped; unrecognised strings yield `undefined` (and a diagnostic).
 */
export function priority(fm: DocumentFrontmatter): number | undefined {
  const p = fm.priority;
  if (p == null || p === '') return undefined;
  if (typeof p === 'number') {
    if (!Number.isFinite(p)) return undefined;
    return Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, Math.round(p)));
  }
  const name = String(p).trim().toLowerCase();
  const mapped = PRIORITY_NAMES[name];
  if (mapped !== undefined) return mapped;
  const numeric = Number(name);
  if (Number.isFinite(numeric)) return Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, Math.round(numeric)));
  return undefined;
}

export function labels(fm: DocumentFrontmatter): string[] {
  return toList(fm.labels);
}

export function tags(fm: DocumentFrontmatter): string[] {
  return toList(fm.tags);
}

export function aliases(fm: DocumentFrontmatter): string[] {
  return toList(fm.aliases);
}

export function status(fm: DocumentFrontmatter): string {
  const s = fm.status;
  const value = s == null ? '' : String(s).trim();
  return value === '' ? DEFAULT_STATUS : value;
}

// ---------------------------------------------------------------------------
// Name resolution (ADR-005 §7)
// ---------------------------------------------------------------------------

/**
 * Resolve a reference to a document: id → path (with or without `.md`) →
 * alias → title. The last two are case-insensitive. This is the single
 * resolution rule, shared by the index and the shell, so core and UI cannot
 * disagree about what a name means.
 *
 * A typed reference resolves on its `id` part, so `project:01K…` and `01K…`
 * find the same document.
 */
export function resolveDocument(documents: Document[], target: string): Document | undefined {
  const raw = target.trim();
  if (raw === '') return undefined;
  const candidates = [raw, parseRef(raw).id];

  for (const c of candidates) {
    const byId = documents.find((d) => d.id === c);
    if (byId) return byId;
  }
  for (const c of candidates) {
    const byPath = documents.find((d) => d.path === c || d.path === c + '.md');
    if (byPath) return byPath;
  }
  const lowered = candidates.map((c) => c.toLowerCase());
  for (const d of documents) {
    if (aliases(d.frontmatter).some((a) => lowered.includes(a.toLowerCase()))) return d;
  }
  for (const d of documents) {
    const title = d.frontmatter.title;
    if (typeof title === 'string' && lowered.includes(title.toLowerCase())) return d;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Project a work-item document into the canonical `WorkItem`. `documents` is
 * used to resolve the project reference to an id so grouping survives a rename
 * (ADR-005 §4); pass an empty list when no index is available.
 */
export function projectWorkItem(doc: Document, documents: Document[] = []): WorkItem {
  const fm = doc.frontmatter;
  const project = typeof fm.project === 'string' && fm.project.trim() !== '' ? fm.project.trim() : undefined;
  const resolved = project ? resolveDocument(documents, project) : undefined;
  const problem = typeof fm.problem === 'string' && fm.problem.trim() !== '' ? fm.problem.trim() : undefined;
  const resolvedProblem = problem ? resolveDocument(documents, problem) : undefined;
  return {
    id: doc.id,
    path: doc.path,
    title: typeof fm.title === 'string' && fm.title !== '' ? fm.title : doc.id,
    status: status(fm),
    assignees: assignees(fm),
    labels: labels(fm),
    priority: priority(fm),
    project,
    projectId: resolved?.id,
    problem,
    problemId: resolvedProblem?.id,
    frontmatter: fm,
    due: typeof fm.due === 'string' && fm.due !== '' ? fm.due : undefined,
  };
}

/** Project every work-item document in a corpus. */
export function projectWorkItems(documents: Document[]): WorkItem[] {
  return documents.filter((d) => isWorkItem(d.frontmatter)).map((d) => projectWorkItem(d, documents));
}

/**
 * Order work items by urgency: priority ascending (0 first), items with no
 * priority last, then by title. Replaces the alphabetical ordering that string
 * priorities forced.
 */
export function byUrgency(a: WorkItem, b: WorkItem): number {
  const pa = a.priority ?? Number.POSITIVE_INFINITY;
  const pb = b.priority ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  return a.title.localeCompare(b.title);
}

// ---------------------------------------------------------------------------
// Typed relations (ADR-005 §8)
// ---------------------------------------------------------------------------

export interface Relation {
  from: DocumentId;
  /** The reference as written, before resolution. */
  target: string;
  kind: 'project' | 'problem' | 'parent' | 'blocks';
}

/**
 * The frontmatter-derived edges of a document: its project, parent and the
 * items it blocks. Prose references (`link`, `transclusion`) come from the AST
 * and are collected by the index, not here.
 */
export function frontmatterRelations(doc: Document): Relation[] {
  const fm = doc.frontmatter;
  const out: Relation[] = [];
  if (typeof fm.project === 'string' && fm.project.trim() !== '') {
    out.push({ from: doc.id, target: fm.project.trim(), kind: 'project' });
  }
  if (typeof fm.problem === 'string' && fm.problem.trim() !== '') {
    out.push({ from: doc.id, target: fm.problem.trim(), kind: 'problem' });
  }
  if (typeof fm.parent === 'string' && fm.parent.trim() !== '') {
    out.push({ from: doc.id, target: fm.parent.trim(), kind: 'parent' });
  }
  for (const b of toList(fm.blocks)) {
    out.push({ from: doc.id, target: b, kind: 'blocks' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation (ADR-005 §9) — reports, never rejects
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = 'warning' | 'info';

export interface Diagnostic {
  documentId: DocumentId;
  path: string;
  /** The frontmatter key the diagnostic concerns. */
  key: string;
  severity: DiagnosticSeverity;
  message: string;
}

/**
 * Check one document against the ontology. Every finding is advisory: the
 * document still opens, renders and saves. `documents` enables referential
 * checks (an unresolvable project or parent reference).
 */
export function validateDocument(doc: Document, documents: Document[] = []): Diagnostic[] {
  const fm = doc.frontmatter;
  const out: Diagnostic[] = [];
  const at = (key: string, severity: DiagnosticSeverity, message: string): void => {
    out.push({ documentId: doc.id, path: doc.path, key, severity, message });
  };

  if (fm.kind !== undefined && fm.type === undefined) {
    at('kind', 'info', '`kind` is deprecated; write `type` instead (ADR-005).');
  }
  if (fm.assignee !== undefined && fm.assignees === undefined) {
    at('assignee', 'info', '`assignee` is deprecated; write `assignees` as a list (ADR-005).');
  }

  const type = documentType(fm);
  if (type !== undefined && !(TYPES as readonly string[]).includes(type)) {
    at('type', 'warning', 'Unknown document type "' + type + '"; known types are ' + TYPES.join(', ') + '.');
  }

  if (!isWorkItem(fm)) return out;

  const s = status(fm);
  if (!(STATUSES as readonly string[]).includes(s)) {
    at('status', 'warning', 'Unknown status "' + s + '"; known statuses are ' + STATUSES.join(', ') + '.');
  }
  if (fm.priority !== undefined && fm.priority !== '' && priority(fm) === undefined) {
    at('priority', 'warning', 'Unreadable priority "' + String(fm.priority) + '"; use ' + PRIORITY_MIN + '-' + PRIORITY_MAX + ' (0 most urgent).');
  }
  if (typeof fm.priority === 'string' && priority(fm) !== undefined) {
    at('priority', 'info', 'Priority "' + fm.priority + '" read as ' + priority(fm) + '; numeric priorities are canonical (ADR-005).');
  }

  for (const rel of frontmatterRelations(doc)) {
    if (documents.length > 0 && !resolveDocument(documents, rel.target)) {
      at(rel.kind, 'warning', 'Unresolvable ' + rel.kind + ' reference "' + rel.target + '".');
    }
  }
  return out;
}

/** Check a whole corpus. */
export function validateDocuments(documents: Document[]): Diagnostic[] {
  return documents.flatMap((d) => validateDocument(d, documents));
}
