# Critical Review — Findings & Risks

- **Scope:** originally Stages 0–1 (up to `0c933ef`); now tracked through the
  Stage 2/3 work and hardening committed up to `1fde0e0` (09-13).
- **Status:** Stages 0/1/2/3 committed and green (103 tests). Implemented:
  findings 1, 2, 3, 5, 6, 7, 10 and the HTML-sanitisation work. Remaining open:
  finding 8 (test breadth) and the native Electron *window* launch (finding 4 —
  ABI now verified under Electron's bundled Node 20; the window probe needs a
  desktop session, `pnpm --filter app-desktop smoke:window`).

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
of prose is out of scope for v1. See ADR-001 (round-trip fidelity). **Implemented:**
raw frontmatter preservation + `updateFrontmatter` (`bd0e7a7`); prose stays
canonical. The inline-parser holes (finding 6) remain.

### 2. Critical — Stable IDs are path-derived, not assigned

§3.1 says renames preserve relationships because identity is ID-based. But
`deriveId` in `packages/core/workspace/src/index.ts` falls back to `path`
when frontmatter has no `id`, so a rename changes the id and silently orphans
every link to that document. Stage 1.2 ("assign stable IDs on first
create/import") is not done — we only *detect* duplicates.

**Resolved:** assign a generated id on first create/import and persist it into
`frontmatter.id`; backfill id-less existing docs on first edit/save (not on open,
to avoid surprise writes); path-derived id is a read-only fallback. **Implemented:**
`createWorkItem` assigns + persists a UUID (`c3a3ca6`). Backfill of id-less docs on
first save still pending.

### 3. High — No save-time concurrency safety

`Workspace.save()` does `writeFileSync` + `git add` + `git commit` with no
base-blob check and no three-way merge (both deferred). Two saves to the same
document clobber silently. This is a data-loss-shaped hole and the sharpest
gap between this and a real Git-backed editor.

**Resolved:** base-blob optimistic concurrency **now** — track the base blob SHA
per open doc and refuse to clobber a stale base (surface the conflict). Line-based
three-way merge is the immediate follow-up; interactive merge UI later.
**Implemented:** stale-base guard (`69d8aaa`); three-way merge via `git merge-file`
on a stale base (`702416a`); interactive merge UI still later.

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
**Implemented:** `@electron/rebuild` is wired into `pnpm --filter app-desktop
smoke`, which rebuilds better-sqlite3 for the Electron ABI and verifies the
binding loads + runs under Electron's bundled Node 20
(`ELECTRON_RUN_AS_NODE`, no display needed) — green in CI-like sandboxes. The
full window + renderer + contextBridge probe (`smoke:window`, plus the `--smoke`
branch in `apps/desktop/src/main/main.ts`) requires a desktop session and could
not execute in this headless sandbox. Also fixed: package `main` pointed at a
stale empty `dist/index.js` stub instead of `dist/main/main.js`.
Remaining: run `smoke:window` once on a desktop to close the loop.

### 5. Medium — Edit path is O(N) re-parse and commits no-op saves

`WorkspaceService.saveDocument()` re-opens the whole workspace (re-parses
every file) to refresh the index, and `save()` commits even when nothing
changed. Fine for the 5-file demo; not for a real repo.

**Implemented:** per-doc re-parse + no-op commit skip (`69d8aaa`).

### 6. Medium — Inline parser is regex-based with known holes; positions dropped

`packages/core/markdown/src/inline.ts` rewrites `text` nodes with a regex.
Known holes: `[[a|b|c]]` (splits on the first `|`), `[[…]]` vs `![[…]]` vs
a real image `![a]`, links adjacent to line breaks, escaped brackets. Custom
nodes also drop `position`, which the round-trip test papers over by stripping
position before comparison.

**Disposition:** move to a micromark extension for the inline syntax and carry
position onto custom nodes; add adversarial-input tests.
**Implemented** (`d3ecb32`): a real micromark syntax + mdast-util-from-markdown
extension parses `[[…]]`/`![[…]]` inline with positions spanning the markers;
handles pipes (alias after first `|`), escapes, line-end unclosed links,
image-vs-transclusion disambiguation, and non-empty content. 17 adversarial
tests in `test/inline.test.ts`.

### 7. Medium — SQLite index is a hybrid, not a clean projection

`packages/core/index/src/sqlite.ts` serves links/backlinks/search from SQLite
but `resolve()` maps back to the same in-memory `this.docs` array, so the
`documents` table is mostly redundant. Also `WAL` on `:memory:` is a no-op.

**Disposition:** decide what SQLite owns (links + FTS + work-item projection is
fine; document resolution can stay in-memory but should be explicit), and drop
the redundant table or use it for the projection.
**Implemented** (`118af6d`): SQLite owns links/backlinks, FTS5 and the work-item
projection (`work_items` table); in-memory id/path maps own resolution; the
redundant `documents` table is gone; WAL is only requested for file-backed
indexes. Contract tests cover rename-stable identity and projection rebuilds.

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
`tsx` as the native rich-output language.

**Fixed:** the block nodes are collapsed to a single `cell` node across
`@tributary/api`, `markdown`, `render`, `components` and the demo
fixtures; `js`/`ts`/`jsx`/`tsx` fences are cells by default with a
`source` opt-out. **Implemented:** esbuild+acorn compiler and dependency
extraction on the compiled AST (`e99029d`, `71e1d02`), cells executing
end-to-end with per-cell editing and granular reactive invalidation
(`f5138b4`–`63271c6`). Execution is in-process for v1; the ADR-004
worker/process boundary is not yet enforced.

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