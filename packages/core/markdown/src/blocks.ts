const CELL_META_RE = /(?:^|\s)cell=(\S+)/;

function walk(node: any): void {
  if (node.type === 'code') {
    if (node.lang === 'replot') {
      (node as { type: string }).type = 'replotBlock';
    } else if (node.meta && CELL_META_RE.test(node.meta)) {
      const cellName = CELL_META_RE.exec(node.meta)![1];
      const n = node as { type: string; cellName?: string };
      n.type = 'cellBlock';
      n.cellName = cellName;
    }
    return;
  }
  if (node.children) {
    for (const c of node.children) walk(c as typeof node);
  }
}

/** remark plugin: rewrite typed fenced blocks (replot, js cell=name). */
export function typedFencesPlugin() {
  return (tree: any): void => {
    walk(tree);
  };
}