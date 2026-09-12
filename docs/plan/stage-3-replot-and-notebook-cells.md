# Stage 3 — Replot + Notebook-Like Reactive Cells

**Source:** architecture §10 "Slice 3".
**Outcome:** Add computational documents while retaining Markdown-first
authoring.

## Goal

Introduce explicit executable fence syntax and optional stable cell IDs,
compile cells into a dependency graph with inline error surfacing, expose a
narrow workspace capability API to cells, and render cell values through React
with Replot consuming value/spec data without owning the DOM.

## Work breakdown

### 3.1 Executable cell syntax (`@tributary/markdown`)
- Explicit executable fences (`js cell=name`, `query`, etc.) vs source-only
  code fences (§4.3); execution is never inferred from the language.
- Optional stable local cell IDs (only where outputs/dependencies need block
  identity — §3.1).

### 3.2 Dependency graph & invalidation (`@tributary/notebook`)
- Compile cells into a dependency graph; recompute only dependants on change.
- Surface execution errors inline.
- Document-level disposal; dispose stale async work (§13).

### 3.3 Capability API (`@tributary/api`, `notebook`)
- Narrow, explicit capability API to cells: read current document, query index,
  fetch workspace services (§8, §6.1). Arbitrary network/filesystem access
  denied unless explicitly granted.

### 3.4 Rendering & Replot (`@tributary/render`, `components`)
- Render cell values through React.
- Replot consumes `value/spec` data without owning the DOM (§6.1).

## Exit criteria

- [ ] A Markdown document defines data in one cell and renders a dependent
      Replot block later in the page.
- [ ] Editing an upstream cell recomputes only dependants (dependency tests,
      stale async disposed).
- [ ] Plain wiki docs incur **no notebook runtime cost**.
- [ ] Execution stays behind the `NotebookHost`/capability boundary.

**Computational documents, still `.md`.**