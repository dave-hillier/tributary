interface FenceNode {
  lang?: string | null;
  meta?: string | null;
  value?: string;
}

function fence(node: FenceNode): string {
  const info = [node.lang, node.meta].filter(Boolean).join(' ');
  return '\u0060\u0060\u0060' + info + '\n' + (node.value ?? '') + '\n\u0060\u0060\u0060';
}

interface CalloutNode {
  kind: string;
  children?: unknown[];
}

/** The subset of mdast-util-to-markdown's State the callout handler needs. */
interface MarkdownState {
  enter(type: string): () => void;
  createTracker(info: unknown): {
    move(value: string): string;
    shift(value: number): void;
    current(): unknown;
  };
  containerFlow(node: unknown, info: unknown): string;
  indentLines(
    value: string,
    map: (line: string, lineNumber: number, blank: boolean) => string,
  ): string;
}

/** Prefix a serialized line with the blockquote marker (blank lines get no space). */
function quoteLine(line: string, _lineNumber: number, blank: boolean): string {
  return '>' + (blank ? '' : ' ') + line;
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
  /** Serialize a callout back to a GitHub-style blockquote: `> [!KIND]` + children. */
  callout(node: CalloutNode, _: unknown, state: MarkdownState, info: unknown) {
    const exit = state.enter('callout');
    const tracker = state.createTracker(info);
    tracker.move('> ');
    tracker.shift(2);
    const body = state.containerFlow(node, tracker.current());
    exit();
    const marker = '> [!' + node.kind.toUpperCase() + ']';
    if (body === '') return marker;
    return marker + '\n' + state.indentLines(body, quoteLine);
  },
  /** Serialize a query block back to a `query` fence. */
  query(node: { value?: string }) {
    return fence({ lang: 'query', value: node.value });
  },
};
