# Frontmatter reference

The authoring reference for Tributary's YAML frontmatter: what each key means,
what values are canonical, and what happens to values that are not. The decision
behind this shape is [ADR-005](../adr/0005-work-item-ontology.md); the dialect it
sits inside is [ADR-001](../adr/0001-markdown-dialect.md). This page is the
*reference*, kept in step with `@tributary/ontology`.

Frontmatter is **schema-tolerant** (architecture §4.2). Unknown keys are
preserved untouched, unknown vocabulary is accepted, and deprecated spellings are
read. Nothing here rejects a document: problems surface as advisory diagnostics
in the app, never as a refusal to open, render or save.

## Every document

| Key | Type | Meaning |
|---|---|---|
| `id` | string | Stable identity, assigned on first create/import. Never derived from path or title; a rename does not change it. |
| `title` | string | Display name. Falls back to the `id` when absent. |
| `type` | `index` \| `wiki` \| `work-item` \| `project` \| `report` \| `note` | What the document is. Drives projection and rendering. |
| `aliases` | string list | Alternative names. Used for wiki-link resolution and rename resilience. |
| `tags` | string list | Document-wide navigation and search vocabulary. |
| `template` | string | Selects a presentation or report template. *(Declared; no consumer yet.)* |

## Work items

A work item is an ordinary Markdown document with `type: work-item`. There is no
separate work-item database — changing any field below is a document edit with
ordinary Git history.

| Key | Type | Meaning |
|---|---|---|
| `status` | string | Known values: `todo`, `doing`, `blocked`, `done`. Others are allowed and reported. Defaults to `todo`. |
| `assignees` | list of refs | Who is on it, e.g. `[user:dave, user:sam]`. |
| `priority` | `0`–`4` | `0` most urgent, `4` least. Sorts by urgency. |
| `project` | ref | The project document this belongs to. Resolved through the index. |
| `labels` | string list | Work-item labels. |
| `due` | ISO date | e.g. `2026-09-30`. |
| `parent` | ref | The parent work item. |
| `blocks` | list of refs | Items this one blocks. |

## Generated artifacts

Every generated document records where it came from (architecture §4.1, §5.5).

| Key | Type | Meaning |
|---|---|---|
| `sourceRevision` | string | The Git revision the output describes. |
| `generatedBy` | string | The job or agent that produced it. |
| `series` / `period` | string | Groups repeated reports. |

## References

A reference is written `entity:id` — `user:dave`, `project:01K…`, `doc:01K…`. A
bare value with no prefix is read in the position it appears, so
`assignees: [dave]` means the same as `assignees: [user:dave]`.

References to documents resolve in this order, the last two
case-insensitively:

1. `id`
2. path, with or without the `.md` extension
3. `aliases`
4. `title`

Because a reference resolves to an **id**, renaming or moving the target does not
break it. This is the single resolution rule in the system — the index and the UI
share one implementation.

## Deprecated spellings

These are read and normalised, and reported as an advisory note so documents can
be migrated when convenient. Newly created documents never use them.

| Deprecated | Canonical | Note |
|---|---|---|
| `kind: work-item` | `type: work-item` | `type` wins if a document carries both. |
| `assignee: bob` | `assignees: [user:bob]` | Folded into the list. |
| `priority: high` | `priority: 1` | `urgent`/`critical`→0, `high`→1, `medium`/`normal`→2, `low`→3, `none`→4. |

## Diagnostics

The workspace reports, and the board surfaces:

- a deprecated key (advisory)
- a legacy string priority that was read successfully (advisory)
- an unknown `type` or `status` (warning)
- an unreadable `priority` (warning)
- an unresolvable `project`, `parent` or `blocks` reference (warning)

An unknown *key* is never reported — additional metadata is expected to be
additive (architecture §4.2).

## Worked example

```markdown
---
id: 01K5Z8QeXAMPLE
title: Ship the demo
type: work-item
status: doing
assignees: [user:alice, user:carol]
priority: 1
project: project-demo
labels: [demo, release]
due: 2026-09-30
---

# Ship the demo

Notes, links to [[work/projects/demo|Demo Project]], and embedded documents all
behave as they do in any other document.
```

The demo workspace under [`docs/examples/slice-0/`](../examples/slice-0/) carries
a working version of this, plus one deliberately old-style item that exercises
every deprecated spelling above.
