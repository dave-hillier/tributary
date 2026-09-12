# Stage 1 — Git-Backed Workspace: Wiki + Work Items

**Source:** architecture §10 "Slice 1".
**Outcome:** The first genuinely usable offline product: open a local Git
repository, browse/edit/autosave/checkpoint Markdown knowledge and Markdown-
backed work items, and rebuild all derived state locally.

## Goal

Wire the real Git adapter + SQLite index into the workspace service, render
`index.md` as the workspace home, project typed work-item frontmatter into
list/board views, and close the edit → autosave → checkpoint → history loop.

## Work breakdown

### 1.1 Open a repository (`@tributary/workspace`)
- Open or clone a local workspace/repository from the app (one workspace ↔ one
  repo, §5.2 / §12).
- Build the SQLite document index from the Git checkout (§5.3).

### 1.2 IDs & identity (`@tributary/workspace`, `markdown`)
- Assign/check stable IDs on first create/import; detect duplicate IDs
  (validation §5.2).
- Rename/move preserves relationships because identity is ID-based (§3.1).

### 1.3 Home & navigation (`@tributary/render`, `components`)
- Render `index.md` as the workspace home.
- Support `[[links]]`, aliases, backlinks and full-text search from the index.

### 1.4 Work-item projection (`@tributary/index`, `components`)
- Project typed work-item frontmatter into list/board views with status,
  assignee, priority and project filters (§3.3).
- Create/assign/status/move operations edit Markdown frontmatter and trigger a
  prompt **semantic checkpoint** (§7.3).

### 1.5 Edit workflow (`app-desktop`, `api`, `workspace`)
- Markdown-first editor (CodeMirror 6 per §11).
- Batched autosave with timer/idle + navigation/close checkpoints (§7.1).
- Base-blob optimistic concurrency + three-way merge (§7.2).
- Show local Git history/diff for a document; expose fetch/push only when a
  remote exists.

### 1.6 Index rebuildability
- Deleting the derived index and rebuilding it must reproduce equivalent
  graph/search results (§2 core principle, §13).

## Exit criteria

- [ ] Open a repo, navigate docs + work items, edit either, see autosaved
      checkpoint history, and assign/move work items — all from the Git-backed
      model, no separate work-item database.
- [ ] A rename/move preserves relationships (ID-based, golden + integration
      fixture).
- [ ] Deleting and rebuilding the derived index preserves behaviour.
- [ ] Integrated against **real temporary Git repositories**, not mocks.
- [ ] All non-shell packages build/test with no Electron dependency.

**The first offline-desktop milestone; everything after builds on a real repo + index.**

## Known gaps

See [`findings.md`](./findings.md). In particular: identity is path-derived so
renames break links (finding 2), save has no base-blob/three-way-merge
concurrency safety (finding 3), and the edit path re-parses the whole workspace
and commits no-op saves (finding 5).