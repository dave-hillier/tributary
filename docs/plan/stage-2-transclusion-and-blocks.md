# Stage 2 — Transclusion + Rich Document Blocks

**Source:** architecture §10 "Slice 2".
**Outcome:** Make documents composable without turning the format into MDX.

## Goal

Support `![[]]` document/heading/section transclusion, add a small block
registry with safe declarative blocks, handle cycles, and let `index.md` mix
links with embedded documents.

## Work breakdown

### 2.1 Transclusion semantics (`@tributary/markdown`, `render`)
- Resolve `![[]]` against the document index (same resolution as wiki links).
- Support whole-document and heading/section transclusion.
- Transcluded content follows document renames/moves (ID-based).

### 2.2 Block registry (`@tributary/render`, `components`)
- A deliberately small registry of safe declarative blocks (§4.1): callout,
  table, query block.
- Blocks stay in the container/chrome ownership of React (§6.1).

### 2.3 Recursion & diagnostics (`@tributary/markdown`)
- Detect transclusion cycles; enforce depth limits (§8).
- Render cycles fail **visibly and safely** — render an inline diagnostic
  rather than hanging.

### 2.4 Home page composition (`components`)
- `index.md` can be mostly links but embed a selected report/document.

## Exit criteria

- [ ] A home page is mostly links but embeds a selected report/doc.
- [ ] Transcluded content follows document renames/moves.
- [ ] Circular transclusion fails visibly and safely (no hang, inline
      diagnostic, recursion + depth guarded — §8).
- [ ] Unknown blocks degrade to code fences; nothing corrupts.

**Composable documents; still fully Markdown-first.**