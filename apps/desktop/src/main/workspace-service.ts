import { mkdtempSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, createDemoWorkspace, type CommitInfo } from '@tributary/workspace';
import { SqliteIndex } from '@tributary/index';
import { parseMarkdown, updateFrontmatter } from '@tributary/markdown';
import { compileDocument, serializeCellOutput, type CellResult } from '@tributary/notebook';
import { createElement, Fragment } from 'react';
import type { Document, DocumentId, WorkItem } from '@tributary/api';

/**
 * Shell-side workspace service: owns the open workspace and its derived index,
 * exposed to the renderer over IPC. Git remains the durable truth (arch §5.2).
 */
export class WorkspaceService {
  private workspace: Workspace | null = null;
  private index: SqliteIndex | null = null;
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

  async evaluateDocument(cells: { lang: string; source: string }[]): Promise<CellResult[]> {
    if (cells.length === 0) return [];
    const run = compileDocument(
      cells.map((c) => ({ lang: c.lang as 'js' | 'ts' | 'jsx' | 'tsx', source: c.source }))
    );
    const values = await run({ React: { createElement, Fragment }, api: this.capabilities });
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

  async createWorkItem(input: { title: string; status?: string; assignee?: string; priority?: string; project?: string }): Promise<Document> {
    const workspace = this.workspace;
    const index = this.index;
    if (!workspace || !index) throw new Error('Workspace not open');
    const id = randomUUID();
    const path = 'items/' + id + '.md';
    const fm: Record<string, unknown> = { id, kind: 'work-item', title: input.title, status: input.status ?? 'todo' };
    if (input.assignee) fm.assignee = input.assignee;
    if (input.priority) fm.priority = input.priority;
    if (input.project) fm.project = input.project;
    const source = updateFrontmatter('# ' + input.title + '\n', fm);
    const doc = parseMarkdown(source, { path });
    await workspace.save(doc, 'create work item ' + input.title);
    index.rebuild(workspace.documents);
    return workspace.getDocument(id) ?? doc;
  }
}