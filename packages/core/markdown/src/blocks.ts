const CELL_LANGS = new Set(['js', 'ts', 'jsx', 'tsx']);
const SOURCE_META_RE = /(?:^|\s)source(?:\s|$)/;

/** GitHub-style callout kinds; the marker is case-insensitive. */
const CALLOUT_KINDS = new Set(['note', 'tip', 'important', 'warning', 'caution']);
const CALLOUT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;

/** The callout kind when the first paragraph's first text starts with `[!TYPE]`, else null. */
function calloutKind(node: any): string | null {
  const paragraph = node.children?.[0];
  if (!paragraph || paragraph.type !== 'paragraph') return null;
  const first = paragraph.children?.[0];
  if (!first || first.type !== 'text' || typeof first.value !== 'string') return null;
  const match = CALLOUT_RE.exec(first.value);
  const kind = match?.[1]?.toLowerCase();
  return kind && CALLOUT_KINDS.has(kind) ? kind : null;
}

/** Remove the `[!TYPE]` marker from the callout's first paragraph, dropping it when emptied. */
function stripCalloutMarker(node: any): void {
  const paragraph = node.children[0];
  const first = paragraph.children[0];
  const match = CALLOUT_RE.exec(first.value) as RegExpExecArray;
  // Drop the marker and the line break that separated it from the body.
  const rest = first.value.slice(match[0].length).replace(/^\n/, '');
  if (rest === '') {
    paragraph.children.shift();
    if (paragraph.children.length === 0) node.children.shift();
  } else {
    first.value = rest;
  }
}

function walk(node: any): void {
  if (node.type === 'code') {
    const lang = node.lang ?? '';
    const meta = node.meta ?? '';
    if (lang === 'query') {
      // Declarative query block (shell-resolved): not a cell, not a code node.
      const n = node as { type: string; lang?: unknown; meta?: unknown };
      n.type = 'query';
      delete n.lang;
      delete n.meta;
    } else if (CELL_LANGS.has(lang) && !SOURCE_META_RE.test(meta)) {
      const n = node as { type: string; meta: string | null };
      n.type = 'cell';
      n.meta = meta === '' ? null : meta;
    }
    return;
  }
  if (node.type === 'blockquote') {
    const kind = calloutKind(node);
    if (kind) {
      node.type = 'callout';
      node.kind = kind;
      stripCalloutMarker(node);
    }
  }
  if (node.children) {
    for (const c of node.children) walk(c);
  }
}

/** remark plugin: rewrite js/ts/jsx/tsx fences into `cell` nodes (`source` opts out),
 * query fences into `query` nodes, and `[!TYPE]` blockquotes into `callout` nodes. */
export function typedFencesPlugin() {
  return (tree: any): void => {
    walk(tree);
  };
}
