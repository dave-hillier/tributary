import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoWorkspace } from '@tributary/workspace';
import { WorkspaceService } from '../src/main/workspace-service.js';

describe('template selection (finding 15)', () => {
  it('seeds a new work item from a type:template document', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tributary-template-'));
    try {
      await createDemoWorkspace(root);
      const service = new WorkspaceService();
      await service.open(root);

      expect(service.listTemplates().map((t) => t.id)).toContain('template-work-item');

      const created = await service.createWorkItem({ title: 'Templated task', template: 'template-work-item' });
      expect(created.frontmatter.type).toBe('work-item');
      expect(created.frontmatter.template).toBe('template-work-item');
      expect(created.frontmatter.status).toBe('todo');
      expect(created.frontmatter.priority).toBe(2);
      expect(created.frontmatter.labels).toEqual(['triage']);
      expect(created.source).toContain('# Templated task');
      expect(created.source).toContain('Describe the work');

      const plain = await service.createWorkItem({ title: 'Plain task' });
      expect(plain.frontmatter.template).toBeUndefined();
      expect(plain.frontmatter.priority).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
