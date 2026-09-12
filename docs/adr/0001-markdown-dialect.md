# ADR-001 — Markdown dialect (v0.1)

- **Status:** Accepted
- **Date:** 2026-09-12
- **Source:** architecture §4 (Canonical document format), §4.1 (Conservative Markdown dialect)

## Context

Tributary's durable document format is Markdown plus a small set of additive
extensions. We needed to fix the exact v0 dialect: what is parsed into a typed
AST, how it round-trips, and how unknown syntax degrades.

## Decision

**v0.1 dialect = CommonMark + GFM, plus four additive extensions**, parsed by
`unified` + `remark-parse` + `remark-gfm` with two custom plugins, and
serialized by `remark-stringify` with four custom handlers. The extensions are:

1. **YAML frontmatter** — a leading `--- ... ---` block, parsed with the
   `yaml` package into `DocumentFrontmatter` (open-ended, known keys typed).
2. **Wiki links** — `[[target]]` and `[[target|alias]]` → `wikiLink` node.
3. **Transclusion** — `![[target]]` and `![[target#heading]]` → `transclusion` node.
4. **Typed fenced blocks** — ```replot``` → `replotBlock`; a fence with
   `cell=name` meta (e.g. ```js cell=answer```) → `cellBlock`. Every
   other fence — including a plain ```js``` without `cell=` — stays an
   ordinary source-only `code` node. Execution is never inferred from language.

The custom nodes are declared and registered into mdast's content maps in
`@tributary/api` (single source of truth), so parser and renderer share one
AST vocabulary.

## Round-trip fidelity

The guarantee is **parse → stringify → parse yields an AST deep-equal to the
first parse** (modulo source position fields, which the serializer does not
emit). Serialization is **canonical**: it uses ATX headings, ``` fenced code,
and preserves frontmatter key order via `yaml` round-trip. This keeps re-saves
diff-stable. Golden tests pin the canonical output.

## Degradation

A renderer that does not know a node type renders it as a source code fence and
never throws; the parser never corrupts unknown syntax (unknown fence languages
remain `code` nodes and round-trip).

## Consequences

- The format stays readable in any plain Markdown tool (extensions are additive).
- No MDX/JSX: Markdown remains data, not a component model.
- Wiki-link/transclusion targets are workspace-relative paths or document ids;
  resolution against the index is deferred to Stage 1/2.
