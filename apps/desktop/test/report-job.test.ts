import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoWorkspace, Workspace } from '@tributary/workspace';
import { WorkspaceService } from '../src/main/workspace-service.js';

describe('report job (Stage 4)', () => {
  it('generates a weekly report, reviews it and merges it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tributary-report-'));
    try {
      await createDemoWorkspace(root);
      const service = new WorkspaceService();
      await service.open(root);
      const rev = (await Workspace.open(root)).revision();

      const outcome = await service.runWeeklyReport();
      expect(outcome.sourceRevision).toBe(rev);
      expect(outcome.reportPath).toMatch(/^reports\/engineering-weekly-\d{4}-[wW]\d{2}\.md$/);
      expect(outcome.diff).toContain(outcome.reportPath);
      expect(outcome.branch).toContain('engineering-weekly');

      // Reviewable before merge: the branch exists, the report is not yet in
      // the main checkout.
      expect(service.listJobBranches()).toContain(outcome.branch);
      const reportId = outcome.reportPath.replace(/\.md$/, '');
      expect(service.getDocument(reportId)).toBeNull();

      // Accept: merge, delete the branch, refresh the index.
      await service.mergeJobBranch(outcome.branch);
      expect(service.listJobBranches()).not.toContain(outcome.branch);

      const report = service.getDocument(reportId);
      expect(report?.frontmatter.type).toBe('report');
      expect(report?.frontmatter.template).toBe('report');
      expect(report?.frontmatter.generatedBy).toBe('jobs/engineering-weekly');
      expect(report?.frontmatter.sourceRevision).toBe(rev);
      expect(report?.frontmatter.series).toBe('engineering-weekly');
      expect(report?.frontmatter.period).toMatch(/^\d{4}-W\d{2}$/);
      expect(report?.source).toContain('## Open items');

      // The merged report is indexed (full-text search finds it).
      expect(service.search('Weekly').map((d) => d.id)).toContain(reportId);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
