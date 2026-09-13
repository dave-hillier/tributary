# ADR-005 — Work-item ontology: typed refs, vocabularies and relations

- **Status:** Accepted
- **Date:** 2026-09-13
- **Source:** architecture §3.1 (identity), §3.3 (work items are Markdown
  documents), §4.2 (frontmatter), §5.3 (derived index), §5.4 (validation)

## Context

The implemented model had flattened the architecture's typed frontmatter into
five nullable strings (finding 15): `kind` in place of `type`, one `assignee`
instead of an `assignees` list of typed refs, `project` as a free label rather
than a document reference, string `priority`, and no `labels`, `tags`, `aliases`
or `template` at all. `due` was declared and then dropped from the projection.
Pasting architecture §3.3's own example document into the app produced an
unclassified document.

Two structural gaps sat underneath: there was no vocabulary to validate against
(a status typo silently created a board column), and `links (from_id, to_id)`
carried no relation kind, so an item→project reference was indistinguishable
from a passing mention in prose.

The fix has to hold two things at once. Frontmatter must stay **schema-tolerant**
(§4.2: "additional metadata should be additive and schema-tolerant") — an unknown
key or an unknown status must never cost the user their document. But tolerance
needs a *known vocabulary to be tolerant of*, or every consumer is left guessing
at strings.

## Decision

**1. `type` is the discriminator.** It matches architecture §3.3 and ordinary
Markdown convention. `kind` is accepted on read as a deprecated alias and
reported as a diagnostic; writers emit `type`.

**2. Typed entity references.** A reference is `"<entity>:<id>"` — `user:dave`,
`project:01K…`, `doc:01K…`. A bare string is tolerated and interpreted in the
position it appears (an assignee without a prefix is a `user`). References to
documents resolve through the index by id, path, alias or title, so a rename
cannot break them (§3.1).

**3. `assignees` is a list.** `assignees: [user:dave, user:sam]` is canonical;
`assignee: dave` is accepted as a deprecated single-value alias and normalised
into the list. Nothing downstream sees a single-assignee model.

**4. `project` is a document reference, not a label.** It resolves to a project
document, and the resolved id is what the projection and the index carry.
Grouping therefore survives a project rename.

**5. `priority` is numeric and orderable** — `0` most urgent through `4` least,
per §3.3's `priority: 2`. The legacy strings `urgent`/`high`/`medium`/`low`/
`none` map onto that scale on read, so existing documents keep working and
sorting stops being alphabetical.

**6. `labels`, `tags`, `aliases`, `template`, `due` are first-class.** `labels`
are work-item labels and `tags` document-wide navigation, as the architecture
distinguishes them (§3.3 vs §4.2). All are declared in `DocumentFrontmatter`,
and `due` reaches the projection so it can be listed, filtered and sorted.

**7. Alias and title resolution belongs to the core resolver.** Resolution order
is id → path (with or without `.md`) → alias → title, case-insensitively for the
last two. It lives in `@tributary/ontology` and is used by *both* the SQLite
index and the shell, so core and UI can no longer disagree about what a name
means.

**8. Relations are typed.** `links` gains a `relation` column: `link` and
`transclusion` for prose references, `project`, `parent` and `blocks` for
frontmatter-derived edges. Backlinks can then distinguish "this item belongs to
that project" from "someone mentioned it in a sentence".

**9. Validation reports, never rejects.** A document with an unknown status, an
unresolvable project reference, a deprecated key or a non-numeric priority still
opens, still renders and still saves; the workspace surfaces diagnostics
alongside the duplicate-ID report (§5.4). Nothing about validation can cost a
user their text.

**10. The ontology gets its own package.** `@tributary/ontology` (pure, depends
only on `@tributary/api`) owns normalisation, vocabularies, reference parsing,
resolution and validation. It is the answer to the shape of finding 15: the
model was flat because nothing owned it.

## Reference

The authoring-facing reference for the resulting frontmatter — every key, the
vocabularies, the deprecated spellings and the diagnostics — is
[`docs/reference/frontmatter.md`](../reference/frontmatter.md).

## Consequences

- Existing documents keep working: `kind`, `assignee` and string priorities are
  all read, normalised and reported rather than refused. Writers emit the
  canonical form, so documents migrate as they are edited.
- `WorkItem` is a richer projection (`assignees`, `labels`, numeric `priority`,
  resolved `projectId`, `due`), so board columns, facets and ordering derive
  from a vocabulary instead of from whatever strings the corpus happens to hold.
- The `work_items` table and the `links` table change shape. Both are disposable
  derived state, so this is a rebuild, not a migration (§2, §5.3).
- Unknown statuses still appear on the board, now alongside a diagnostic. That
  is the deliberate trade: tolerant of new vocabulary, honest about typos.
- `@tributary/ontology` adds a package to the boundary map. It stays
  Electron-free like every other core package.

## Alternatives considered

- **A strict schema (reject invalid frontmatter).** Rejected: it contradicts
  §4.2 and would make a typo in a hand-edited file into data loss.
- **Keep flat strings, fix only the naming.** Rejected: it leaves priority
  unorderable, projects rename-fragile and relations untyped — the three things
  that actually bite.
- **Put normalisation in `@tributary/api`.** Rejected: `api` is the contract
  package and carries no logic. A separate pure package keeps that boundary and
  gives the ontology a visible owner.
