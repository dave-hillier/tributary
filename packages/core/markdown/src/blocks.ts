const CELL_LANGS = new Set(['js', 'ts', 'jsx', 'tsx']);
const SOURCE_META_RE = /(?:^|\s)source(?:\s|$)/;

function walk(node: any): void {
  if (node.type === 'code') {
    const lang = node.lang ?? '';
    const meta = node.meta ?? '';
    if (CELL_LANGS.has(lang) && !SOURCE_META_RE.test(meta)) {
      const n = node as { type: string; meta: string | null };
      n.type = 'cell';
      n.meta = meta === '' ? null : meta;
    }
    return;
  }
  if (node.children) {
    for (const c of node.children) walk(c);
  }
}

/** remark plugin: rewrite js/ts/jsx/tsx fences into `cell` nodes (`source` opts out). */
export function typedFencesPlugin() {
  return (tree: any): void => {
    walk(tree);
  };
}
