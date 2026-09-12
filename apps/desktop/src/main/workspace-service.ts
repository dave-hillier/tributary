import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdown } from '@tributary/markdown';
import type { Document, WorkspaceCapabilities } from '@tributary/api';

const here = dirname(fileURLToPath(import.meta.url));
// src/main/ and dist/main/ are both three levels below apps/desktop.
const REPO_ROOT = join(here, '../../../../');

/** demo fixture docs: id -> workspace-relative path under docs/examples/slice-0 */
const DOCS: Record<string, string> = {
  index: 'index.md',
  hello: 'notes/hello.md',
  'task-1': 'items/task-1.md',
};

/**
 * Stage 0 stub workspace service: reads the demo fixture and parses it with the
 * real parser, returning a typed Document. Replaced by the Git-backed service in
 * Stage 1.
 */
export class StubWorkspaceService implements WorkspaceCapabilities {
  async readDocument(id: string): Promise<Document> {
    const rel = DOCS[id] ?? (id.endsWith('.md') ? id : id + '.md');
    const abs = join(REPO_ROOT, 'docs/examples/slice-0', rel);
    const source = await readFile(abs, 'utf8');
    return parseMarkdown(source, { path: rel });
  }

  async listDocuments(): Promise<Document[]> {
    const out: Document[] = [];
    for (const id of Object.keys(DOCS)) out.push(await this.readDocument(id));
    return out;
  }
}
