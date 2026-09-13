# ADR-001 — Markdown dialect (v0.1)

- **Status:** Accepted
- **Date:** 2026-09-12
- **Source:** architecture §4 (Canonical document format), §4.1 (Conservative Markdown dialect)
- **Superseded by:** ADR-004 for the executable-cell block model (item 4 below)

## Context

Tributary's durable document format is Markdown plus a small set of additive
extensions. We needed to fix the exact v0 dialect: what is parsed into a typed
AST, how it round-trips, and how unknown syntax degrades.

## Decision

**v0.1 dialect = CommonMark + GFM, plus additive extensions**, parsed by
`unified` + `remark-parse` + `remark-gfm` with two custom plugins, and
serialized by `remark-stringify` with custom handlers. The extensions are:

1. **YAML frontmatter** — a leading `--- ... ---` block, parsed with the
   `yaml` package into `DocumentFrontmatter` (open-ended, known keys typed).
2. **Wiki links** — `[[target]]` and `[[target|alias]]` → `wikiLink` node.
3. **Transclusion** — `![[target]]` and `![[target#heading]]` → `transclusion` node.
4. **Executable cells** — a fence whose language is `js`/`ts`/`jsx`/`tsx` is a
   single `cell` node carrying `lang`, **by default**; a `source` meta opts out
   to a source-only `code` node. This **supersedes** the earlier
   `replotBlock`/`cellBlock` split — see ADR-004. Non-cell languages and
   unlabelled fences stay source-only `code`.

The custom nodes are declared and registered into mdast's content maps in
`@tributary/api` (single source of truth), so parser and renderer share one
AST vocabulary.

## Round-trip fidelity

The guarantee is a **hybrid** (resolved from finding 1):

- **Cell bodies and frontmatter round-trip byte-for-byte.** Executable cell
  source is stored verbatim on the node and never reformatted; frontmatter is
  kept as its raw YAML text (not re-serialized), so comments, anchors, key order
  and formatting survive.
- **Prose is serialized canonically and stably** (ATX headings, ``` fenced code,
  consistent list/emphasis markers), so re-saves are diff-stable once normalized.
- **Full source-preservation of prose** (setext vs ATX, `~~~` vs ```, `_` vs `*`)
  is out of scope for v1; revisit if prose diffs prove painful.

The testable guarantee: parse → stringify → parse is idempotent, and cell bodies
+ raw frontmatter are byte-identical across a round-trip.

## Degradation

A renderer that does not know a node type renders it as a source code fence and
never throws; the parser never corrupts unknown syntax (unknown fence languages
remain `code` nodes and round-trip).

## Consequences

- The format stays readable in any plain Markdown tool (extensions are additive).
- No document-level MDX/JSX: Markdown is never compiled to JSX. TSX is
  allowed **inside executable cells**, where it is the cell's language (ADR-004).
- Wiki-link/transclusion targets are workspace-relative paths or document ids;
  resolution against the index is deferred to Stage 1/2.