# Critical Review — Findings & Risks

- **Scope:** Stage 0 (Shell + format/runtime spike) and Stage 1 Slice 1.0 (the Git
  round-trip), as committed up to `0c933ef`.
- **Status:** open — these are the gaps that would most hurt a real product.

This is an honest assessment of the work so far. The skeleton and the
Git-as-truth discipline are sound (see "What holds up" below), but several core
promises are either unmet or only partially met. Findings are ranked by impact.

## Findings

### 1. Critical — Markdown round-trip is "canonical rewrite", not source-preserving

The architecture (§4.1) and Stage 0 exit criteria require round-trip "without
losing source formatting important to Git diffs." We did not meet that: we
*redefined* it as idempotence under a canonical form.

- `packages/core/markdown/src/serialize.ts` / `index.ts` serialize through
  `remark-stringify` defaults, which normalize away source formatting: setext
  headings → ATX, `~~~` fences → ``` ```, `_x_` → `*x*`, reference
  links → inline/autolink, indentation/tabs rewritten.
- The "round-trip" test only proves `parse → stringify → parse` is idempotent,
  and its golden fixture was already canonical, so the rewriting is invisible.
- Frontmatter is also lossy: `parseFrontmatter` → `yaml.parse` →
  `yaml.stringify` drops comments, anchors and multi-line string formatting.

**Disposition:** re-decide. Either (a) do the hard work — a micromark extension
plus position-preserving custom nodes so `stringify` reproduces the original
source — or (b) formally adopt "canonical form" and accept reformat-on-save in
writing (ADR-001 update). For a Git-native product, (a) is the safer default.

### 2. Critical — Stable IDs are path-derived, not assigned

§3.1 says renames preserve relationships because identity is ID-based. But
`deriveId` in `packages/core/workspace/src/index.ts` falls back to `path`
when frontmatter has no `id`, so a rename changes the id and silently orphans
every link to that document. Stage 1.2 ("assign stable IDs on first
create/import") is not done — we only *detect* duplicates.

**Disposition:** implement ID assignment: persist a generated id into
frontmatter on first create/import (so it survives renames), and treat the
path-derived id as a stopgap only. Decide whether `id` in frontmatter is
mandatory going forward.

### 3. High — No save-time concurrency safety

`Workspace.save()` does `writeFileSync` + `git add` + `git commit` with no
base-blob check and no three-way merge (both deferred). Two saves to the same
document clobber silently. This is a data-loss-shaped hole and the sharpest
gap between this and a real Git-backed editor.

**Disposition:** add base-blob optimistic concurrency (reject/merge on stale
base) and a minimal three-way merge before exposing multi-client or even
multi-window editing.

### 4. High — Electron path unverified; native binding ABI mismatch

The "desktop app" is proven only headlessly: `main`/`preload` are
type-checked and the renderer is bundled, but we never load the window or
exercise `contextBridge`/`ipcRenderer`/`ipcMain` at runtime. Separately,
`better-sqlite3` was compiled from source against **Node 22**, while
**Electron 33 bundles Node 20** — so the main process would fail to load the
native binding on a real launch without an `@electron/rebuild` pass.

**Disposition:** add a real Electron smoke test (or at least a documented
rebuild step), and decide the native-SQLite build/release story (rebuild per
Electron ABI, or move index execution to a Node worker).

### 5. Medium — Edit path is O(N) re-parse and commits no-op saves

`WorkspaceService.saveDocument()` re-opens the whole workspace (re-parses
every file) to refresh the index, and `save()` commits even when nothing
changed. Fine for the 5-file demo; not for a real repo.

**Disposition:** per-document invalidation and skip-the-commit when the file is
unchanged (or when the new content equals `HEAD`).

### 6. Medium — Inline parser is regex-based with known holes; positions dropped

`packages/core/markdown/src/inline.ts` rewrites `text` nodes with a regex.
Known holes: `[[a|b|c]]` (splits on the first `|`), `[[…]]` vs `![[…]]` vs
a real image `![a]`, links adjacent to line breaks, escaped brackets. Custom
nodes also drop `position`, which the round-trip test papers over by stripping
position before comparison.

**Disposition:** move to a micromark extension for the inline syntax and carry
position onto custom nodes; add adversarial-input tests.

### 7. Medium — SQLite index is a hybrid, not a clean projection

`packages/core/index/src/sqlite.ts` serves links/backlinks/search from SQLite
but `resolve()` maps back to the same in-memory `this.docs` array, so the
`documents` table is mostly redundant. Also `WAL` on `:memory:` is a no-op.

**Disposition:** decide what SQLite owns (links + FTS + work-item projection is
fine; document resolution can stay in-memory but should be explicit), and drop
the redundant table or use it for the projection.

### 8. Medium — Testing is mostly happy-path

The Observable adapter's hard cases (invalidation, async disposal) are only
tested for the custom evaluator, not through the adapter. No failure-path
coverage: duplicate-ID surfacing, non-repo open, clobbering/concurrent saves,
frontmatter comments, setext/`~~~` fidelity, adversarial wiki-link input.

**Disposition:** add failure-path and fidelity tests as the corresponding fixes
land.

### 9. Low — Process: orchestration cost and review-tooling limits

- The "model/thinking level per task" request could not be honored — the
  subagent tooling does not expose it; this should have been stated up front.
- Two of four Stage 0 subagents stalled (notebook on the untyped
  `@observablehq/runtime`; markdown after ~15 min of scratch files) and were
  taken over; a `render` agent also ran `pnpm install` against instruction.

**Disposition:** prefer direct implementation for tightly-coupled vertical
slices; use subagents only for clearly separable, low-coupling work.

### 10. Medium — Dialect drift: `replotBlock` already implemented, now superseded

ADR-004 collapses `replotBlock`/`cellBlock` into a single `cell` node, with
`tsx` as the native rich-output language. The current code
(`@tributary/api`, `markdown`, `render`, `components`, demo fixtures)
still ships `replotBlock` and `cellBlock`, and the Stage 0 notebook spike
uses `with`+Proxy dependency discovery rather than a compiled-JS-AST extractor.

**Disposition:** migrate the block nodes to one `cell` node, adopt esbuild for
cell compilation, and move dependency extraction onto the compiled AST (Stage 3).

## Decisions needed

1. **Round-trip fidelity:** source-preserving vs canonical (finding 1).
2. **ID strategy:** persist generated `id` into frontmatter on create/import
   (finding 2).
3. **Concurrency for v1:** base-blob + three-way merge now vs later (finding 3).
4. **Native SQLite in Electron:** `@electron/rebuild` vs worker process
   (finding 4).
5. ~~**Executable-cell marker**~~ — **resolved**: cell-by-default with a
   `source` opt-out and on-demand execution (ADR-004).
6. ~~**Cell trust posture**~~ — **resolved**: permissive `@tributary/api`
   capabilities behind a worker boundary; sandboxing deferred to Stage 7
   (ADR-004).

## What holds up

- Real `git` binary (not mocks) drives workspace tests — the most valuable
  thing in the codebase.
- `@tributary/api` as the single AST contract, with the `declare module
  'mdast'` augmentation, keeps parser/render/index clean and Electron-free
  (enforced by the boundary guard).
- `NotebookHost` as a swap boundary with a passing swap test is a sound
  ADR-002 outcome.
- The disposable-index invariant is genuinely tested (rebuild reproduces
  identical results) in both the in-memory and SQLite index.