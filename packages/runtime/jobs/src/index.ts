import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Workspace } from '@tributary/workspace';
import { SqliteIndex } from '@tributary/index';
import { parseMarkdown, updateFrontmatter } from '@tributary/markdown';
import type { Document, WorkItem } from '@tributary/api';

/**
 * The snapshot a job reads: repository documents and their work-item
 * projection, at a single pinned revision (arch §5.5).
 */
export interface JobContext {
  revision: string;
  documents: Document[];
  workItems: WorkItem[];
}

/** Report identity + provenance (arch §4.1/§4.2). */
export interface ReportConfig {
  /** Job/agent provenance, e.g. 'jobs/engineering-weekly'. */
  generatedBy: string;
  title: string;
  series?: string;
  period?: string;
  /** Repo-relative path (defaults to reports/<series>-<period>.md). */
  reportPath?: string;
  /** Branch for the proposal (defaults to jobs/<generatedBy>-<shortRev>). */
  branchName?: string;
}

export interface RunJobOptions {
  /** The workspace repository to run against. */
  rootPath: string;
  /** Revision to pin (defaults to HEAD). */
  sourceRevision?: string;
  config: ReportConfig;
  /** Produces the report body (Markdown without frontmatter). */
  generate: (ctx: JobContext) => string | Promise<string>;
  /** Where to materialise the isolated worktree (defaults to the system temp dir). */
  worktreeParentDir?: string;
}

export interface RunJobOutcome {
  sourceRevision: string;
  branch: string;
  commit: string;
  reportPath: string;
  reportSource: string;
  diff: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function defaultReportPath(config: ReportConfig): string {
  if (config.reportPath) return config.reportPath;
  const name = [config.series, config.period].filter(Boolean).join('-') || slug(config.title);
  return 'reports/' + slug(name) + '.md';
}

/** Wrap a report body in provenance frontmatter (arch §4.1, §6.2). */
export function buildReportSource(config: ReportConfig, revision: string, body: string): string {
  const fm: Record<string, unknown> = {
    title: config.title,
    type: 'report',
    template: 'report',
    generatedBy: config.generatedBy,
    sourceRevision: revision,
  };
  if (config.series) fm.series = config.series;
  if (config.period) fm.period = config.period;
  return updateFrontmatter(body, fm);
}

/** A free branch name: suffix a counter rather than failing when one exists. */
function uniqueBranch(workspace: Workspace, base: string): string {
  const taken = new Set(workspace.listBranches(base));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = base + '-' + n;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Run a revision-pinned job in an isolated worktree and commit its report to a
 * local branch (arch §5.5). The branch is left for review; merge is a separate
 * step the shell performs after surfacing the diff.
 */
export async function runJob(opts: RunJobOptions): Promise<RunJobOutcome> {
  const main = await Workspace.open(opts.rootPath);
  const sourceRevision = opts.sourceRevision ?? main.revision();
  const jobName = opts.config.generatedBy.replace(/^jobs\//, '');
  // The period is part of the branch identity, so a fresh week gets a fresh
  // branch; a rerun in the same period gets a numeric suffix instead of a
  // `branch already exists` failure.
  const baseBranch =
    opts.config.branchName ??
    'jobs/' +
      [slug(jobName), opts.config.period ? slug(opts.config.period) : '', sourceRevision.slice(0, 7)]
        .filter(Boolean)
        .join('-');
  const branch = uniqueBranch(main, baseBranch);
  const reportPath = defaultReportPath(opts.config);
  const worktreeDir = join(opts.worktreeParentDir ?? tmpdir(), 'tributary-job-' + randomUUID());

  let created = false;
  let index: SqliteIndex | null = null;
  try {
    const wt = await main.createWorktree(sourceRevision, worktreeDir, branch);
    created = true;
    index = new SqliteIndex(join(worktreeDir, '.tributary', 'index.db'));
    index.rebuild(wt.documents);

    const body = await opts.generate({
      revision: sourceRevision,
      documents: wt.documents,
      workItems: index.workItems(),
    });
    const reportSource = buildReportSource(opts.config, sourceRevision, body);
    const reportDoc = parseMarkdown(reportSource, { path: reportPath });
    await wt.save(reportDoc, 'generate ' + opts.config.generatedBy + ' report');

    const commit = wt.revision();
    const diff = main.diffBetween(sourceRevision, commit);
    return { sourceRevision, branch, commit, reportPath, reportSource, diff };
  } finally {
    // Close the handle on every path and only remove a worktree we created.
    index?.close();
    if (created) {
      try {
        main.removeWorktree(worktreeDir);
      } catch {
        // best-effort worktree cleanup; the branch + commit remain for review
      }
    }
  }
}

/** A concrete weekly-summary report body over the repository snapshot. */
export function weeklyReport(ctx: JobContext): string {
  const byStatus = new Map<string, WorkItem[]>();
  for (const w of ctx.workItems) {
    const list = byStatus.get(w.status) ?? [];
    list.push(w);
    byStatus.set(w.status, list);
  }
  const statusSummary = [...byStatus.entries()]
    .map(([status, items]) => status + ': ' + items.length)
    .join(' · ');
  const open = ctx.workItems.filter((w) => w.status !== 'done');

  const lines: string[] = [
    '# Weekly Report',
    '',
    '_Generated from revision \`' + ctx.revision.slice(0, 7) + '\`._',
    '',
    '## Summary',
    '',
    '- documents: ' + ctx.documents.length,
    '- work items: ' + ctx.workItems.length,
    '- by status: ' + statusSummary,
    '',
    '## Open items',
    '',
  ];
  if (open.length === 0) {
    lines.push('None.');
  } else {
    for (const w of open) {
      lines.push('- [[' + w.path + '|' + w.title + ']] (' + w.status + ')');
    }
  }
  lines.push('');
  return lines.join('\n');
}
