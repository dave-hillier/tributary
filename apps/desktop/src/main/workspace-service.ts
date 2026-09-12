import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, createDemoWorkspace, type CommitInfo } from '@tributary/workspace';
import { SqliteIndex } from '@tributary/index';
import type { Document, DocumentId } from '@tributary/api';

/**
 * Shell-side workspace service: owns the open workspace and its derived index,
 * exposed to the renderer over IPC. Git remains the durable truth (arch §5.2).
 */
export class WorkspaceService {
  private workspace: Workspace | null = null;
  private index: SqliteIndex | null = null;

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

  async saveDocument(doc: Document, message?: string): Promise<{ commit: string }> {
    const workspace = this.workspace;
    const index = this.index;
    if (!workspace || !index) throw new Error('Workspace not open');
    const result = await workspace.save(doc, message);
    // Rebuild derived state from Git after the checkpoint.
    const refreshed = await Workspace.open(workspace.ref.rootPath);
    this.workspace = refreshed;
    index.rebuild(refreshed.documents);
    return result;
  }

  async history(id: DocumentId): Promise<CommitInfo[]> {
    return this.workspace?.history(id) ?? [];
  }

  search(query: string): Document[] {
    return this.index?.search(query) ?? [];
  }
}