import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, createDemoWorkspace, type CommitInfo } from '@tributary/workspace';
import { buildIndex, type WorkspaceIndex } from '@tributary/index';
import type { Document, DocumentId } from '@tributary/api';

/**
 * Shell-side workspace service: owns the open workspace and its derived index,
 * exposed to the renderer over IPC. Git remains the durable truth (arch §5.2).
 */
export class WorkspaceService {
  private workspace: Workspace | null = null;
  private index: WorkspaceIndex | null = null;

  /** Open a freshly-seeded demo workspace (ephemeral, for the slice). */
  async openDemo(): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), 'tributary-demo-'));
    const workspace = await createDemoWorkspace(root);
    this.workspace = workspace;
    this.index = buildIndex(workspace.documents);
  }

  async open(rootPath: string): Promise<void> {
    const workspace = await Workspace.open(rootPath);
    this.workspace = workspace;
    this.index = buildIndex(workspace.documents);
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
    if (!this.workspace) throw new Error('Workspace not open');
    const result = await this.workspace.save(doc, message);
    // Rebuild derived state from Git after the checkpoint.
    this.workspace = await Workspace.open(this.workspace.ref.rootPath);
    this.index = buildIndex(this.workspace.documents);
    return result;
  }

  async history(id: DocumentId): Promise<CommitInfo[]> {
    return this.workspace?.history(id) ?? [];
  }
}