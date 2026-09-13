import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoWorkspace, Workspace } from '@tributary/workspace';
import { parseMarkdown } from '@tributary/markdown';
import { runJob, weeklyReport } from '../src/index.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'tributary-jobs-'));
}

describe('jobs (Stage 4)', () => {
  it('generates a revision-pinned weekly report with provenance on a branch', async () => {
    const root = tempDir();
    try {
      await createDemoWorkspace(root);
      const ws = await Workspace.open(root);
      const rev = ws.revision();

      const outcome = await runJob({
        rootPath: root,
        config: {
          generatedBy: 'jobs/engineering-weekly',
          title: 'Weekly Engineering Report',
          series: 'engineering-weekly',
          period: '2026-W37',
        },
        generate: weeklyReport,
      });

      expect(outcome.sourceRevision).toBe(rev);
      expect(outcome.branch).toContain('engineering-weekly');
      expect(outcome.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(outcome.reportPath).toBe('reports/engineering-weekly-2026-w37.md');

      // Provenance is recorded in the generated frontmatter (arch §4.1).
      const report = parseMarkdown(outcome.reportSource, { path: outcome.reportPath });
      expect(report.frontmatter.type).toBe('report');
      expect(report.frontmatter.template).toBe('report');
      expect(report.frontmatter.generatedBy).toBe('jobs/engineering-weekly');
      expect(report.frontmatter.sourceRevision).toBe(rev);
      expect(report.frontmatter.series).toBe('engineering-weekly');
      expect(report.frontmatter.period).toBe('2026-W37');

      // The change set is reviewable and mentions the new report.
      expect(outcome.diff).toContain('reports/engineering-weekly-2026-w37.md');

      // Not in the main checkout until reviewed + merged.
      expect(ws.getDocument('reports/engineering-weekly-2026-w37')).toBeUndefined();
      await ws.merge(outcome.branch);
      ws.deleteBranch(outcome.branch);

      const after = await Workspace.open(root);
      const merged = after.getDocument('reports/engineering-weekly-2026-w37');
      expect(merged?.frontmatter.sourceRevision).toBe(rev);
      expect(merged?.source).toContain('## Open items');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a generated report is a snapshot: it pins its source revision', async () => {
    const root = tempDir();
    try {
      await createDemoWorkspace(root);
      const rev1 = (await Workspace.open(root)).revision();

      const first = await runJob({
        rootPath: root,
        config: { generatedBy: 'jobs/weekly', title: 'Weekly', period: '2026-W1' },
        generate: weeklyReport,
      });
      expect(first.sourceRevision).toBe(rev1);
      expect(first.reportSource).toContain(rev1);

      // Advance the repository: add another work item.
      const ws = await Workspace.open(root);
      const item = parseMarkdown(
        '---\ntitle: New item\ntype: work-item\nstatus: todo\n---\n\n# New item\n',
        { path: 'items/new.md' }
      );
      await ws.save(item, 'add item');
      const rev2 = ws.revision();

      const second = await runJob({
        rootPath: root,
        config: { generatedBy: 'jobs/weekly', title: 'Weekly', period: '2026-W2' },
        generate: weeklyReport,
      });
      expect(second.sourceRevision).toBe(rev2);
      expect(second.reportSource).toContain(rev2);

      // The two snapshots differ (the later one sees the added item), and the
      // earlier one still records rev1 — it does not track later edits.
      expect(second.reportSource).not.toBe(first.reportSource);
      expect(first.reportSource).not.toContain(rev2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
