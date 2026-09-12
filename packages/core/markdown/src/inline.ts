import type { PhrasingContent, Text, WikiLink, Transclusion } from '@tributary/api';

const LINK_RE = /(!?)\[\[([^\]\r\n]+?)\]\]/g;

/** Split a text value into text/wikiLink/transclusion nodes. */
export function splitInlineLinks(value: string): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(value))) {
    if (m.index > last) {
      out.push({ type: 'text', value: value.slice(last, m.index) } as Text);
    }
    const inner = m[2]!;
    if (m[1] === '!') {
      const h = inner.indexOf('#');
      out.push({
        type: 'transclusion',
        target: h >= 0 ? inner.slice(0, h) : inner,
        heading: h >= 0 ? inner.slice(h + 1) : undefined,
        children: [],
      } as Transclusion);
    } else {
      const p = inner.indexOf('|');
      out.push({
        type: 'wikiLink',
        target: p >= 0 ? inner.slice(0, p) : inner,
        alias: p >= 0 ? inner.slice(p + 1) : undefined,
        children: [],
      } as WikiLink);
    }
    last = m.index + m[0].length;
  }
  if (last < value.length) {
    out.push({ type: 'text', value: value.slice(last) } as Text);
  }
  return out;
}

function walk(parent: any): void {
  if (!parent.children) return;
  const next: unknown[] = [];
  for (const child of parent.children) {
    const c = child as { type: string; value?: string; children?: unknown[] };
    if (c.type === 'text' && typeof c.value === 'string') {
      next.push(...splitInlineLinks(c.value));
    } else {
      walk(c);
      next.push(c);
    }
  }
  parent.children = next;
}

/** remark plugin: rewrite [[wiki links]] and ![[transclusions]] in text nodes. */
export function inlineLinksPlugin() {
  return (tree: any): void => {
    walk(tree);
  };
}