# Critical Review — Findings & Risks

- **Scope:** Stage 0 (Shell + format/runtime spike) and Stage 1 Slice 1.0 (the Git
  round-trip), as committed up to `0c933ef`.
- **Status:** decisions resolved (see "Decisions"); findings remain open pending implementation.

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

**Resolved:** hybrid — preserve **cell bodies and frontmatter raw text**
byte-for-byte, serialize **prose canonically** (stable). Full source-preservation
of prose is out of scope for v1. See ADR-001 (round-trip fidelity). Implementation
pending: keep frontmatter as raw YAML (not re-serialized); cells already verbatim.

### 2. Critical — Stable IDs are path-derived, not assigned

§3.1 says renames preserve relationships because identity is ID-based. But
`deriveId` in `packages/core/workspace/src/index.ts` falls back to `path`
when frontmatter has no `id`, so a rename changes the id and silently orphans
every link to that document. Stage 1.2 ("assign stable IDs on first
create/import") is not done — we only *detect* duplicates.

**Resolved:** assign a generated id on first create/import and persist it into
`frontmatter.id`; backfill id-less existing docs on first edit/save (not on open,
to avoid surprise writes); path-derived id is a read-only fallback. Implementation
pending (Stage 1.2).

### 3. High — No save-time concurrency safety

`Workspace.save()` does `writeFileSync` + `git add` + `git commit` with no
base-blob check and no three-way merge (both deferred). Two saves to the same
document clobber silently. This is a data-loss-shaped hole and the sharpest
gap between this and a real Git-backed editor.

**Resolved:** base-blob optimistic concurrency **now** — track the base blob SHA
per open doc and refuse to clobber a stale base (surface the conflict). Line-based
three-way merge is the immediate follow-up; interactive merge UI later.
Implementation pending (Stage 1.5).

### 4. High — Electron path unverified; native binding ABI mismatch

The "desktop app" is proven only headlessly: `main`/`preload` are
type-checked and the renderer is bundled, but we never load the window or
exercise `contextBridge`/`ipcRenderer`/`ipcMain` at runtime. Separately,
`better-sqlite3` was compiled from source against **Node 22**, while
**Electron 33 bundles Node 20** — so the main process would fail to load the
native binding on a real launch without an `@electron/rebuild` pass.

**Resolved:** keep better-sqlite3 in the main process (synchronous local index),
add `@electron/rebuild` for the Electron ABI, and add a real Electron smoke test
that loads the window + binding. Tests stay on Node 22 (already built).
Implementation pending.

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

## Decisions

1. ~~**Round-trip fidelity**~~ — **resolved**: hybrid (verbatim cells +
   frontmatter; canonical stable prose). ADR-001.
2. ~~**ID strategy**~~ — **resolved**: assign + persist id on create/import;
   backfill on first save. Stage 1.2.
3. ~~**Concurrency for v1**~~ — **resolved**: base-blob optimistic concurrency
   now; three-way merge as follow-up. Stage 1.5.
4. ~~**Native SQLite in Electron**~~ — **resolved**: `@electron/rebuild` +
   Electron smoke test; keep better-sqlite3 in main.
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