import { mkdtempSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace, createDemoWorkspace, type CommitInfo } from '@tributary/workspace';
import { SqliteIndex } from '@tributary/index';
import { parseMarkdown, updateFrontmatter, replaceCellSource } from '@tributary/markdown';
import { ReactiveHost, serializeCellOutput, type CellResult, type ResolveOptions } from '@tributary/notebook';
import { createElement, Fragment } from 'react';
import type { Document, DocumentId, NewWorkItem, WorkItem } from '@tributary/api';
import { formatRef, parseRef, type Diagnostic } from '@tributary/ontology';

/**
 * Shell-side workspace service: owns the open workspace and its derived index,
 * exposed to the renderer over IPC. Git remains the durable truth (arch §5.2).
 */
/** The desktop app's own node_modules (host fallback for cell imports). */
const APP_NODE_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules');

function collectCells(doc: Document): { lang: string; source: string }[] {
  const out: { lang: string; source: string }[] = [];
  const walk = (n: any): void => {
    if (n.type === 'cell') out.push({ lang: n.lang, source: n.value as string });
    if (n.children) for (const c of n.children) walk(c);
  };
  walk(doc.root);
  return out;
}

export class WorkspaceService {
  private workspace: Workspace | null = null;
  private index: SqliteIndex | null = null;
  private hosts = new Map<string, ReactiveHost>();
  private cellContext() {
    return { React: { createElement, Fragment }, api: this.capabilities, components: {} };
  }

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
  private capabilities = {
    workItems: () => this.listWorkItems(),
    listDocuments: () => this.listDocuments(),
    query: (q: string) => this.search(q),
  };

  /** Open a freshly-seeded demo workspace (ephemeral, for the slice). */
  async openDemo(): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), 'tributary-demo-'));
    const workspace = await createDemoWorkspace(root);
    this.workspace = workspace;
    this.index = new SqliteIndex(join(root, '.tributary', 'index.db'));
    this.index.rebuild(workspace.documents);
  }

  async open(rootPath: string): Promise<void> {
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

  async saveDocument(doc: Document, message?: string): Promise<{ commit: string | null; changed: boolean }> {
    const workspace = this.workspace;
    const index = this.index;
    if (!workspace || !index) throw new Error('Workspace not open');
    const result = await workspace.save(doc, message);
    // Per-document invalidation: the workspace already re-parsed the saved doc;
    // just rebuild the in-memory index from the (updated) documents array.
    if (result.changed) {
      index.rebuild(workspace.documents);
    }
    return result;
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

  async evaluateDocument(docId: string, cells: { lang: string; source: string }[]): Promise<CellResult[]> {
    const host = new ReactiveHost(
      cells.map((c) => ({ lang: c.lang as 'js' | 'ts' | 'jsx' | 'tsx', source: c.source })),
      this.resolveOptions()
    );
    this.hosts.set(docId, host);
    const values = await host.evaluate(this.cellContext());
    return values.map(serializeCellOutput);
  }

  async updateCell(docId: string, cellIndex: number, source: string): Promise<CellResult[]> {
    const workspace = this.workspace;
    if (!workspace) return [];
    const doc = workspace.getDocument(docId);
    if (!doc || !doc.source) return [];
    // Persist the cell edit into the .md and commit, then recompute dependants.
    const newFullSource = replaceCellSource(doc.source, cellIndex, source);
    const updatedDoc = parseMarkdown(newFullSource, { path: doc.path });
    await workspace.save(updatedDoc, 'edit cell');
    let host = this.hosts.get(docId);
    if (!host) {
      host = new ReactiveHost(
        collectCells(updatedDoc).map((c) => ({ lang: c.lang as 'js' | 'ts' | 'jsx' | 'tsx', source: c.source })),
        this.resolveOptions()
      );
      this.hosts.set(docId, host);
      const values = await host.evaluate(this.cellContext());
      return values.map(serializeCellOutput);
    }
    const values = await host.update(cellIndex, source, this.cellContext());
    return values.map(serializeCellOutput);
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
    await workspace.rename(id, newPath);
    index.rebuild(workspace.documents);
    return workspace.getDocument(id)!;
  }

  /**
   * Create a work item in the canonical ontology (ADR-005): `type`, an
   * `assignees` list of typed refs and a numeric priority. Deprecated spellings
   * are never written, so new documents need no migration.
   */
  async createWorkItem(input: NewWorkItem): Promise<Document> {
    const workspace = this.workspace;
    const index = this.index;
    if (!workspace || !index) throw new Error('Workspace not open');
    const id = randomUUID();
    const path = 'items/' + id + '.md';
    const fm: Record<string, unknown> = {
      id,
      type: 'work-item',
      title: input.title,
      status: input.status ?? 'todo',
    };
    const assignees = (input.assignees ?? []).filter((a) => a.trim() !== '');
    if (assignees.length > 0) fm.assignees = assignees.map((a) => formatRef(parseRef(a, 'user')));
    if (input.priority !== undefined) fm.priority = input.priority;
    if (input.project) fm.project = input.project;
    if (input.problem) fm.problem = input.problem;
    if (input.labels && input.labels.length > 0) fm.labels = input.labels;
    if (input.due) fm.due = input.due;
    const source = updateFrontmatter('# ' + input.title + '\n', fm);
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
}