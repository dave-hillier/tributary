import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoWorkspace, Workspace } from '@tributary/workspace';
import { WorkspaceService } from '../src/main/workspace-service.js';

describe('interactive merge conflict (finding 3)', () => {
  it('returns the conflicted text, then force-saves the resolution', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tributary-merge-'));
    try {
      await createDemoWorkspace(root);
      const service = new WorkspaceService();
      await service.open(root);

      // An external commit changes the same line the local edit will change.
      const ext = (await Workspace.open(root)).getDocument('notes/hello')!;
      ext.source = ext.source!.replace('# Hello', '# Hello (theirs)');
      const writer = await Workspace.open(root);
      await writer.save(ext, 'external edit');

      const ours = service.getDocument('notes/hello')!;
      ours.source = ours.source!.replace('# Hello', '# Hello (ours)');
      const conflict = await service.saveDocument(ours, 'our edit');
      expect(conflict.conflict).toBe(true);
      expect(conflict.conflicted).toContain('<<<<<<<');
      expect(conflict.conflicted).toContain('# Hello (theirs)');

      const resolved = conflict
        .conflicted!.replace(/^<<<<<<<.*$/gm, '')
        .replace(/^=======$/gm, '')
        .replace(/^>>>>>>>.*$/gm, '')
        .replace('# Hello (ours)', '# Hello (resolved)');
      const resolvedDoc = service.getDocument('notes/hello')!;
      resolvedDoc.source = resolved;
      const ok = await service.saveDocument(resolvedDoc, 'resolve conflict', true);
      expect(ok.conflict).toBe(false);
      expect(ok.changed).toBe(true);
      expect(service.getDocument('notes/hello')!.source).toContain('# Hello (resolved)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
