# Stage 4 — Offline Jobs + Generated Reports

**Source:** architecture §10 "Slice 4".
**Outcome:** Make the reporting workflow a first-class product capability.
**Status:** ✅ complete — `@tributary/jobs` runs revision-pinned jobs in an
isolated `git worktree`, generates provenance-tagged reports, commits them to a
`jobs/` branch, and the shell surfaces a diff + merge. Suite green.

## Goal

A job runner checks out a specific Git revision in an isolated worktree, reads
indexed documents, generates/updates a report document with full provenance,
creates a branch/commit, and surfaces a reviewable diff before merge.

## Work breakdown

### 4.1 Job runner (`@tributary/jobs`, `workspace`)
- Receive an explicit local source revision + job config (§5.5).
- Create an isolated checkout/worktree at that revision.
- Run in a worker/child process; read documents through the same parser/index
  APIs the application uses.

### 4.2 Report generation & provenance (`jobs`, `markdown`)
- Produce/update Markdown reports recording `sourceRevision`, `generatedBy`,
  `period`/`series` (§4.1 frontmatter, §8).
- Written to a local job branch (or direct per policy).

### 4.3 Review & merge (`app-desktop`, `api`)
- Emit local progress/completion events; surface a diff/review in the UI.
- Merge/fast-forward per workspace policy; push is separate (§5.5).

## Exit criteria

- [x] A manual/scheduled job generates a weekly report over repository
      documents in a real temp repo.
- [x] A reader can tell exactly which repository revision the report describes.
- [x] Old reports stay stable even when source docs later change (snapshot vs
      live distinction, §6.2).
- [x] Job runs revision-pinned, isolated and reviewable before merge.

**The reporting workflow — revision-pinned, durable, offline-capable.**