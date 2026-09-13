# Stage 0 — Shell + Format / Runtime Spike

**Source:** architecture §10 "Slice 0" and §14 "Immediate next steps".
**Outcome:** Prove the local desktop boundary and the core content/runtime bets
with one repository and no multi-user infrastructure.
**Status:** ✅ complete — exit criteria pass and the suite is green at `575549b`
(09-13). One runtime caveat remains: native Electron window launch is only proven
headlessly; an `@electron/rebuild` + smoke pass is pending (see [`findings.md`](./findings.md)).

## Goal

Stand up the monorepo scaffold, define the v0 Markdown dialect and parse it to
a typed AST that round-trips, render ordinary Markdown + one static Replot
block in React under Electron, and run the NotebookHost runtime spike. Resolve
the runtime choice with ADR-002.

## Work breakdown

### 0.1 Scaffold & package skeleton
- Confirm all packages from `package-boundaries.md` exist with placeholder
  `exports` + import-by-index.
- Root scripts (`build`, `test`, `dev`) resolve across the workspace.
- CI-style check: a non-shell package build fails if it imports `electron`.

### 0.2 v0 Markdown dialect (`@tributary/markdown`)
- Support: CommonMark/GFM prose, YAML frontmatter, `[[wiki links]]`,
  `![[]]` transclusion, typed fenced blocks.
- Parse to a typed AST with **round-trip fidelity** (source formatting that
  matters to Git diffs is preserved).
- Unknown/typed-block degradation: a renderer that does not know a block shows
  its source as a fenced code block; nothing corrupts (arch §4.1 portability).

### 0.3 React rendering + one static Replot block (`@tributary/render`, `components`)
- AST → React component registry.
- Ordinary Markdown + wiki links render; one declarative `replot` block renders
  from a value/spec (React remains sole DOM owner — §6.1).

### 0.4 Electron shell & typed boundary (`app-desktop`)
- Electron renders the React surface; domain packages imported, not forked.
- Renderer talks to a local workspace service through the typed `api` boundary
  (stub service returning a fixture document for this stage).

### 0.5 NotebookHost spike (`@tributary/notebook`)
- Evaluate Observable Runtime / Notebook Kit vs a minimal custom dependency
  evaluator for: coupling to the durable format, API stability,
  dependency-resolution and invalidation adequacy.
- Judge against the requirement that "moving implementation between candidates
  does not change the persisted document" (§10 Slice 0 exit criteria).

### 0.6 Decision records
- **ADR-002** — selected notebook runtime (exit deliverable of this stage).

## Demo fixture

A sample repository under `docs/examples/slice-0/`:
`index.md`, one wiki doc, one work item, one `replot` block, one `js cell`
fence rendered as source-only until Stage 3. This is the Stage 0 slice of
the canonical demo workspace (arch §14.4); later stages extend the same
fixture tree.

## Exit criteria

- [x] A sample repo renders end-to-end in the Electron shell.
- [x] Unknown blocks degrade to code fences without corrupting the document.
- [x] Parser round-trip preserves Git-diff-relevant formatting (golden tests).
- [x] `@tributary/markdown` builds/tests with no Electron dependency.
- [x] ADR-002 recorded; swapping the runtime does not change the persisted doc.

**Starts the build chain used by every later stage.**

## Known gaps

See [`findings.md`](./findings.md). Round-trip was settled as a documented
hybrid — verbatim cells/frontmatter + canonical prose (finding 1, ADR-001).
The Electron ABI now verified: `pnpm --filter app-desktop smoke` rebuilds
better-sqlite3 for the Electron ABI and proves it loads under Electron's
bundled Node 20 (green). The remaining item is the native window launch
(`smoke:window`), which needs a desktop session (finding 4).