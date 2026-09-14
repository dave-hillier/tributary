import { mkdtempSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace, createDemoWorkspace, MergeConflictError, type CommitInfo } from '@tributary/workspace';
import { SqliteIndex } from '@tributary/index';
import { parseMarkdown, parseFrontmatter, updateFrontmatter, replaceCellSource } from '@tributary/markdown';
import { compileReactiveCellAsync, type CompiledReactiveCell, type CellLanguage, type ResolveOptions } from '@tributary/notebook';
import { runJob, weeklyReport, type RunJobOutcome } from '@tributary/jobs';
import type { Document, DocumentId, NewWorkItem, WorkItem } from '@tributary/api';
import { documentType, formatRef, parseRef, type Diagnostic } from '@tributary/ontology';

/**
 * Shell-side workspace service: owns the open workspace and its derived index,
 * exposed to the renderer over IPC. Git remains the durable truth (arch §5.2).
 */
/** The desktop app's own node_modules (host fallback for cell imports). */
const APP_NODE_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules');

/** ISO-8601 week for a date, e.g. '2026-W37'. */
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

export class WorkspaceService {
  private workspace: Workspace | null = null;
  private index: SqliteIndex | null = null;

  /**
   * Where cell imports resolve: relative specifiers against the workspace
   * root, bare specifiers against the workspace's own node_modules and then
   * the desktop app's (host) node_modules as a fallback.
   */
  private resolveOptions(): ResolveOptions {
    const root = this.workspace?.ref.rootPath;
    return {
      resolveDir: root ?? process.cwd(),
      nodePaths: root ? [join(root, 'node_modules'), APP_NODE_MODULES] : [APP_NODE_MODULES],
    };
  }

  /** Open a freshly-seeded demo workspace (ephemeral, for the slice). */
  async openDemo(): Promise<void> {
    // Release the previous handle before replacing it, or it leaks and can block
    // a pending worktree removal (finding 10).
    this.index?.close();
    const root = mkdtempSync(join(tmpdir(), 'tributary-demo-'));
    const workspace = await createDemoWorkspace(root);
    this.workspace = workspace;
    this.index = new SqliteIndex(join(root, '.tributary', 'index.db'));
    this.index.rebuild(workspace.documents);
  }

  async open(rootPath: string): Promise<void> {
    this.index?.close();
    const workspace = await Workspace.open(rootPath);
    this.workspace = workspace;
    this.index = new SqliteIndex(join(rootPath, '.tributary', 'index.db'));
    this.index.rebuild(workspace.documents);
  }

  getDocument(id: DocumentId): Document | null {
    return this.workspace?.getDocument(id) ?? null;
  }

  listDocuments(): Document[] {
    return this.workspace?.documents ?? [];
  }

  resolveLink(target: string): Document | null {
    return this.index?.resolve(target) ?? null;
  }

  diff(id: DocumentId): Promise<string> {
    return this.workspace?.diff(id) ?? Promise.resolve('');
  }

  backlinks(id: DocumentId): Document[] {
    const ids = this.index?.backlinks(id) ?? [];
    return ids
      .map((bid) => this.workspace?.getDocument(bid))
      .filter((d): d is Document => d !== undefined);
  }

  async saveDocument(
    doc: Document,
    message?: string,
    force = false
  ): Promise<{
    commit: string | null;
    changed: boolean;
    document?: Document;
    merged: boolean;
    /** True when a stale base produced an unresolved three-way merge. */
    conflict: boolean;
    /** The merge with conflict markers, for the interactive resolver. */
    conflicted?: string;
  }> {
    const workspace = this.workspace;
    const index = this.index;
    if (!workspace || !index) throw new Error('Workspace not open');
    try {
      const result = await workspace.save(doc, message, { force });
      // Per-document invalidation: the workspace already re-parsed the saved doc;
      // just rebuild the in-memory index from the (updated) documents array.
      if (result.changed) {
        index.rebuild(workspace.documents);
      }
      return { ...result, conflict: false };
    } catch (e) {
      // Surface the conflict as data so the renderer can offer a resolver
      // instead of showing an opaque save failure.
      if (e instanceof MergeConflictError) {
        return { commit: null, changed: false, merged: false, conflict: true, conflicted: e.conflicted };
      }
      throw e;
    }
  }

  async history(id: DocumentId): Promise<CommitInfo[]> {
    return this.workspace?.history(id) ?? [];
  }

  search(query: string): Document[] {
    return this.index?.search(query) ?? [];
  }

  listWorkItems(): WorkItem[] {
    return this.index?.workItems() ?? [];
  }

  /** Ontology diagnostics — advisory, surfaced in the UI (ADR-005 §9). */
  diagnostics(): Diagnostic[] {
    return this.workspace?.diagnostics() ?? [];
  }

  /** Work items belonging to a project document, by resolved id (ADR-005 §4). */
  itemsInProject(projectId: DocumentId): WorkItem[] {
    return this.index?.itemsInProject(projectId) ?? [];
  }

  async updateWorkItem(id: DocumentId, patch: Record<string, unknown>): Promise<Document> {
    const workspace = this.workspace;
    if (!workspace) throw new Error('Workspace not open');
    const doc = workspace.getDocument(id);
    if (!doc || !doc.source) throw new Error('Document not found: ' + id);
    const newSource = updateFrontmatter(doc.source, patch);
    const updated = parseMarkdown(newSource, { path: doc.path });
    const message = id + ': ' + Object.entries(patch).map(([k, v]) => k + ' → ' + String(v)).join(', ');
    await this.saveDocument(updated, message);
    return workspace.getDocument(id) ?? updated;
  }

  /**
   * Compile a document's cells to self-contained JS + graph metadata (esbuild
   * runs here in the main process). The renderer evaluates them — React
   * components cannot cross the IPC boundary, so evaluation lives where React
   * renders (finding 11).
   */
  async compileDocument(cells: { lang: string; source: string }[]): Promise<CompiledReactiveCell[]> {
    // Resolve each cell's imports on esbuild's async API, concurrently, so the
    // main process event loop is never blocked by a synchronous bundle
    // (finding 18).
    return Promise.all(
      cells.map((c) => compileReactiveCellAsync(c.source, c.lang as CellLanguage, this.resolveOptions()))
    );
  }

  /**
   * Persist a cell edit and recompile just that cell (finding 11). Routes
   * through saveDocument so the derived index is rebuilt, and returns the
   * reparsed document so the renderer never keeps a pre-edit source.
   */
  async updateCell(
    docId: string,
    cellIndex: number,
    source: string,
    lang: string
  ): Promise<{ compiled: CompiledReactiveCell; document: Document }> {
    const workspace = this.workspace;
    if (!workspace) throw new Error('Workspace not open');
    const doc = workspace.getDocument(docId);
    if (!doc || !doc.source) throw new Error('Document not found: ' + docId);
    const newFullSource = replaceCellSource(doc.source, cellIndex, source);
    const updatedDoc = parseMarkdown(newFullSource, { path: doc.path });
    const result = await this.saveDocument(updatedDoc, 'edit cell');
    if (result.conflict) throw new Error('Merge conflict while saving the cell edit');
    return {
      compiled: await compileReactiveCellAsync(source, lang as CellLanguage, this.resolveOptions()),
      document: result.document ?? workspace.getDocument(docId) ?? updatedDoc,
    };
  }

  async addRemote(url: string, name = 'origin'): Promise<void> {
    const workspace = this.workspace;
    if (!workspace) throw new Error('Workspace not open');
    await workspace.addRemote(name, url);
  }

  async sync(): Promise<string> {
    const workspace = this.workspace;
    if (!workspace) throw new Error('Workspace not open');
    await workspace.fetch('origin');
    await workspace.push('origin');
    return 'synced';
  }

  async renameDocument(id: DocumentId, newPath: string): Promise<Document> {
    const workspace = this.workspace;
    const index = this.index;
    if (!workspace || !index) throw new Error('Workspace not open');
    // Containment: a rename target must stay inside the workspace root.
    const root = workspace.ref.rootPath;
    const rel = relative(root, resolve(root, newPath));
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Rename target escapes the workspace: ' + newPath);
    }
    await workspace.rename(id, newPath);
    index.rebuild(workspace.documents);
    return workspace.getDocument(id)!;
  }

  /** Documents that act as creation templates (frontmatter `type: template`). */
  listTemplates(): Document[] {
    return (this.workspace?.documents ?? []).filter((d) => documentType(d.frontmatter) === 'template');
  }

  private findTemplate(ref: string): Document | undefined {
    return this.listTemplates().find(
      (d) =>
        d.id === ref ||
        d.path === ref ||
        d.path.replace(/\.md$/, '') === ref ||
        d.frontmatter.title === ref
    );
  }

  /**
   * Create a work item in the canonical ontology (ADR-005): `type`, an
   * `assignees` list of typed refs and a numeric priority. Deprecated spellings
   * are never written, so new documents need no migration. A selected
   * `template` document seeds frontmatter defaults and the body (with
   * `{{title}}` substituted).
   */
  async createWorkItem(input: NewWorkItem): Promise<Document> {
    const workspace = this.workspace;
    const index = this.index;
    if (!workspace || !index) throw new Error('Workspace not open');
    const template = input.template ? this.findTemplate(input.template) : undefined;
    const tpl = template?.frontmatter ?? {};
    const id = randomUUID();
    const path = 'items/' + id + '.md';
    const status = input.status ?? (typeof tpl.status === 'string' ? tpl.status : undefined) ?? 'todo';
    const fm: Record<string, unknown> = { id, type: 'work-item', title: input.title, status };
    const tplAssignees = Array.isArray(tpl.assignees) ? tpl.assignees.map((a) => String(a)) : [];
    const assignees = (input.assignees ?? tplAssignees).filter((a) => a.trim() !== '');
    if (assignees.length > 0) fm.assignees = assignees.map((a) => formatRef(parseRef(a, 'user')));
    const priority = input.priority ?? (typeof tpl.priority === 'number' ? tpl.priority : undefined);
    if (priority !== undefined) fm.priority = priority;
    if (input.project) fm.project = input.project;
    if (input.problem) fm.problem = input.problem;
    const labels = input.labels && input.labels.length > 0 ? input.labels : Array.isArray(tpl.labels) ? tpl.labels.map((l) => String(l)) : [];
    if (labels.length > 0) fm.labels = labels;
    if (input.due) fm.due = input.due;
    if (template) fm.template = template.id;
    let body = '# ' + input.title + '\n';
    if (template?.source) {
      const tplBody = parseFrontmatter(template.source).body.replace(/^\n+/, '');
      body = tplBody.includes('{{title}}') ? tplBody.replace(/\{\{title\}\}/g, input.title) : '# ' + input.title + '\n\n' + tplBody;
    }
    const source = updateFrontmatter(body, fm);
    const doc = parseMarkdown(source, { path });
    await workspace.save(doc, 'create work item ' + input.title);
    index.rebuild(workspace.documents);
    return workspace.getDocument(id) ?? doc;
  }

  /**
   * Create a problem document (`type: problem`) that work items reference by
   * id, path, alias or title (ADR-005). Problems are ordinary Markdown, so they
   * participate in Git history and index exactly like any other document.
   */
  async createProblem(title: string): Promise<Document> {
    const workspace = this.workspace;
    const index = this.index;
    if (!workspace || !index) throw new Error('Workspace not open');
    const id = randomUUID();
    const path = 'problems/' + id + '.md';
    const fm: Record<string, unknown> = { id, type: 'problem', title: title.trim() };
    const source = updateFrontmatter('# ' + title.trim() + '\n', fm);
    const doc = parseMarkdown(source, { path });
    await workspace.save(doc, 'create problem ' + title.trim());
    index.rebuild(workspace.documents);
    return workspace.getDocument(id) ?? doc;
  }

  /** Run a revision-pinned weekly report job and return its reviewable outcome. */
  async runWeeklyReport(): Promise<RunJobOutcome> {
    const workspace = this.workspace;
    if (!workspace) throw new Error('Workspace not open');
    return runJob({
      rootPath: workspace.ref.rootPath,
      config: {
        generatedBy: 'jobs/engineering-weekly',
        title: 'Weekly Engineering Report',
        series: 'engineering-weekly',
        period: isoWeek(new Date()),
      },
      generate: weeklyReport,
    });
  }

  /** Local job branches awaiting review. */
  listJobBranches(): string[] {
    return this.workspace?.listBranches('jobs/') ?? [];
  }

  /** Accept a job branch: merge it, delete it, and refresh derived state. */
  async mergeJobBranch(branch: string): Promise<void> {
    const workspace = this.workspace;
    const index = this.index;
    if (!workspace || !index) throw new Error('Workspace not open');
    await workspace.merge(branch);
    workspace.deleteBranch(branch);
    const reopened = await Workspace.open(workspace.ref.rootPath);
    this.workspace = reopened;
    index.rebuild(reopened.documents);
  }
}