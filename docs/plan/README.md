# Stage Planning — Tributary

This folder is the operational build plan for Tributary, a Git-native Markdown
notebook workspace (local-first React/Electron desktop application over one Git
repository per workspace).

The plan is derived from the architecture proposal at the repository root:
[`git_native_markdown_notebook_architecture_v0_3.md`](../../git_native_markdown_notebook_architecture_v0_3.md).
Where the two disagree for the purpose of execution, these documents are
authoritative for *how we build*; the architecture document remains
authoritative for *why it is shaped this way*.

## Layout

```
docs/plan/
├── README.md                  <- this index + sequencing summary
├── package-boundaries.md      <- monorepo layout: packages, deps, build rules
├── findings.md                <- critical review: gaps, risks, decisions needed
├── stage-0-shell-and-format-spike.md
├── stage-1-git-backed-workspace.md
├── stage-2-transclusion-and-blocks.md
├── stage-3-replot-and-notebook-cells.md
├── stage-4-offline-jobs-and-reports.md
├── stage-5-realtime-workspace.md
├── stage-6-crdt-coediting-optional.md
└── stage-7-agent-review-and-hardening.md
```

[`package-boundaries.md`](./package-boundaries.md) is the map between the
architecture's package boundaries (§5) and concrete workspace packages. Read it
before touching any code — every stage assumes this layout.

[`findings.md`](./findings.md) is the living critical-review log: known gaps,
risks and open decisions against the work committed so far. Check it before
claiming a stage is done, and update it when a finding is resolved.

Reference documentation — the authoring-facing description of what the format
means, as opposed to why it was chosen — lives in
[`docs/reference/`](../reference/). Start with
[`frontmatter.md`](../reference/frontmatter.md).

## Sequencing summary

Stages map one-to-one to the architecture's vertical slices (§10). Each stage
is end-to-end: it exercises the durable `.md` format, Git integration, local
index and the React surface together, rather than building disconnected
horizontal subsystems.

| Stage | Title                                           | Vertical outcome                                                                            |
|-------|-------------------------------------------------|---------------------------------------------------------------------------------------------|
| 0     | Shell + format/runtime spike                    | Local desktop boundary proven; a sample repo renders; runtime spike decision recorded.       |
| 1     | Git-backed workspace: wiki + work items         | First usable offline product: edit/autosave/checkpoint Markdown docs & work items, index.    |
| 2     | Transclusion + rich blocks                      | Documents become composable; index.md = links + embedded docs.                               |
| 3     | Notebook-like reactive cells                    | Computational documents while staying Markdown-first.                                       |
| 4     | Offline jobs + generated reports                | Reporting as a first-class feature; revision-pinned, reviewable.                             |
| 5     | Realtime workspace experience                   | Optional collaboration without a second durable model.                                      |
| 6     | Character-level co-editing (only if required)   | Deferred; gated on §12 need.                                                                |
| 7     | Agent/review workflow + hardening               | Git-native review, security boundaries, scale/index health.                                  |

## Build rules (applied at every stage)

1. **Core packages do not depend on Electron.** Parser, index, workspace/Git,
   notebook and jobs packages are ordinary TypeScript packages. Only the shell
   and renderer touch the desktop boundary.
2. **`.md` is canonical.** No notebook container format. Executable fences,
   frontmatter and link syntax are additive Markdown extensions.
3. **Derived state is disposable.** SQLite index, caches and realtime state
   rebuild from Git. Deleting and rebuilding the index must preserve behaviour.
4. **React owns the DOM.** Rendering integrations return values/specifications;
   they never compete for DOM ownership.
5. **Every generated artifact records `sourceRevision` + `generatedBy`.**
6. **Semantic checkpoints, not keystroke commits.** Autosave batches into
   timer/idle + semantic-boundary commits.
7. **Test against real temporary Git repositories**, not mocks at every boundary.

## Definition of done per stage

Each stage document lists explicit exit criteria. A stage is "done" when:

- All exit criteria in its document pass against a real repository fixture.
- The persisted document format is unchanged from the architecture's dialect.
- Core packages remain shell-independent (no Electron import in non-shell code).

**Demo fixtures:** each stage's acceptance fixture lives under
`docs/examples/<stage>/` and is an incremental slice of the single canonical
demo workspace the architecture defines (arch §14.4) — it grows with the
product rather than being written once up front.

## Decision records

The architecture's immediate next steps (arch §14, step 3) call for
ADR-001 (Markdown dialect), ADR-002 (notebook runtime), ADR-003
(local-first sync/checkpoint) and ADR-004 (TSX-native executable cell model).
ADRs live in `docs/adr/`. ADR-002 is an exit deliverable of Stage 0; the others
are written as their decisions are settled.

## Status

Verified against the green suite as of `26e0f9c` (09-13):

- **Stages 0, 1, 2 and 3 are complete** — cells compile (in the main process),
  run, invalidate and persist, `import` bare/relative/default/namespace
  modules, and evaluate in the renderer with full React so an imported component
  (e.g. Replot) renders end-to-end (finding 11).
- **Stage 4 (offline jobs + generated reports) is deferred by decision** —
  `@tributary/jobs` remains an empty stub; revisit before starting it.
- The work-item **ontology is settled and implemented** (ADR-005, finding 15):
  typed `entity:id` refs, `assignees` as a list, `project` as a resolved document
  reference, numeric priority, first-class labels/tags/aliases/due, typed
  relations in the index, and validation that reports rather than rejects. It
  lives in `@tributary/ontology`.
- Findings 6 (inline parser), 7 (SQLite ownership), 8 (test breadth), 11 (cell
  module resolution + renderer-side evaluation), 12 (capability-import shim) and
  14 (no notebook cost for plain docs) are resolved; the HTML render path is
  hardened (arch §8). The Electron ABI is verified under Electron's bundled Node
  (finding 4); only the window probe (`smoke:window`) needs a desktop session.

Remaining gaps are tracked in [`findings.md`](./findings.md).