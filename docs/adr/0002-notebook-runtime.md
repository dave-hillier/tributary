# ADR-002 — Notebook runtime

- **Status:** Accepted — the `NotebookHost` boundary stands; the runtime behind it was amended in 2026-09 (see below)
- **Date:** 2026-09-12
- **Source:** architecture §6 (Notebook and rendered-block execution), §10 Slice 0

## Amendment (2026-09-14): which runtime sits behind the boundary

The decision below chose the *initial* Stage 3 runtime and required the seam to
stay swappable. ADR-004 then changed the cell model to esbuild-compiled
`js`/`ts`/`jsx`/`tsx`, and explicitly preserved this boundary ("behind the
**unchanged** `WorkspaceCapabilities`/`NotebookHost` boundary"). The engine that
grew to satisfy the new model — `ReactiveHost` in `reactive.ts` — is therefore a
**third** implementation, not one of the two candidates evaluated here.

As of 2026-09-14 that engine implements `NotebookHost` itself, so the boundary now
genuinely guards the code that runs:

- The renderer holds its hosts as `NotebookHost<CompiledCellDef>` and no longer
  names the concrete class, so replacing the execution engine is a change at one
  construction site (this is what makes the Stage 7 worker/process boundary a
  drop-in rather than a restructuring).
- `test/notebook.test.ts` drives every implementation through one
  generically-typed function, so the swap is enforced by the compiler rather than
  by convention.
- The custom and Observable evaluators remain as the two evaluated candidates and
  as the seam's other live implementations — the comparison this ADR called for
  is still exercised.

One impedance mismatch is worth recording, because it bounds what "swappable"
means: the expression hosts name a cell by its definition and bind the value
under that name, whereas the compiled host publishes the names a cell *declares*.
The interface is shared; the cell model is not. See the comment on the compiled
branch of the swap test.

## Context

Tributary's computational documents stay Markdown-first: executable cells live in
typed fenced blocks, and only their *evaluation* is hosted behind a
`NotebookHost` boundary. The deciding constraint (arch §10 Slice 0) is that
**moving between runtime implementations must not change the persisted
document** — the runtime consumes cell sources from the AST and writes nothing
back into the file format.

We spiked two candidates against that constraint:

1. **Observable Runtime** (`@observablehq/runtime` + `@observablehq/stdlib`) —
   a mature reactive notebook runtime with explicit-input dependency tracking.
2. **A minimal custom dependency evaluator** — auto-discovers dependencies via a
   `with`+Proxy dry-run, topologically sorts, caches values, and invalidates
   transitively.

## Decision

**Use the minimal custom dependency evaluator** as the initial Stage 3 runtime,
kept behind `NotebookHost`; ship the Observable adapter alongside it so the
choice remains swappable.

Both candidates were wired to the same `NotebookHost` surface and evaluated an
identical dependency graph to identical values (swap test passes). The custom
evaluator wins for v1 on the criteria that matter here:

- **Coupling to the durable format:** none in either case, but the custom
  evaluator avoids a third-party runtime's notion of "cell" leaking into our
  `CellDef`/`CellBlock` model.
- **API stability:** a small, owned interface we can evolve without tracking an
  upstream project.
- **Dependency resolution + invalidation:** adequate for Stage 3's needs —
  auto-discovery, topological order, targeted (transitive) invalidation, and
  per-cell error surfacing are demonstrated by tests.
- **Async disposal:** explicit `dispose()` with generation-based cancellation.
- **Weight:** no additional runtime/stdlib bundle beyond the workspace.

## Consequences

Positive:

- No format coupling; swapping implementations is a test-backed, one-file change.
- Full control over invalidation, error surfacing, and disposal semantics.
- Smaller dependency footprint for the Electron shell.

Trade-offs:

- The custom evaluator does not (yet) implement Observable's richer reactive
  features (generators, `viewof`, notebook-kit UI). Those can be added later or
  the Observable adapter promoted if Stage 3 outgrows the minimal evaluator.
- Dependency discovery is a best-effort dry-run; a cell that throws early may
  under-report later dependencies. Acceptable for Stage 3, documented here.

## Evidence

`packages/runtime/notebook/test/notebook.test.ts` covers topological order,
targeted invalidation, per-cell error surfacing, and the custom-vs-Observable
swap test (all green).
