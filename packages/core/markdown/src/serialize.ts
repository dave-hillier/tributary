interface FenceNode {
  lang?: string | null;
  meta?: string | null;
  value?: string;
}

function fence(node: FenceNode): string {
  const info = [node.lang, node.meta].filter(Boolean).join(' ');
  return '\u0060\u0060\u0060' + info + '\n' + (node.value ?? '') + '\n\u0060\u0060\u0060';
}

/** mdast-util-to-markdown handlers for the Tributary dialect nodes. */
export const dialectHandlers = {
  wikiLink(node: { target: string; alias?: string }) {
    return '[[' + node.target + (node.alias ? '|' + node.alias : '') + ']]';
  },
  transclusion(node: { target: string; heading?: string }) {
    return '![[' + node.target + (node.heading ? '#' + node.heading : '') + ']]';
  },
  cell(node: FenceNode) {
    return fence(node);
  },
};
