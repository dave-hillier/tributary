import type { PhrasingContent } from '@tributary/api';
import { codes } from 'micromark-util-symbol';
import { markdownLineEnding, markdownLineEndingOrSpace } from 'micromark-util-character';

// ---------------------------------------------------------------------------
// Wiki links and transclusions, as real micromark syntax extensions.
//
// Replaces the old post-parse regex rewrite of `text` nodes (finding 6):
// - tokens carry positions, so wikiLink/transclusion nodes get correct
//   `position` spans (including the `[[ ]]` / `![[ ]]` markers).
// - edge cases the regex got wrong: `[[a|b|c]]` (alias is everything after
//   the FIRST `|`), `![[a#sec]]` vs `![a]` images, escaped brackets,
//   unclosed links at line endings, and adjacency to other inline content.
//
// Token discipline follows the ecosystem convention (cf. the official
// `micromark-extension-wiki-link`): every consumed character belongs to a
// token — `wikiLink`/`transclusion` container, `…Marker` for the brackets,
// `…Value` for the content — so subtokenize can assign children correctly.
// ---------------------------------------------------------------------------

/** micromark `State`: may return the next state or `undefined` to stop. */
type State = (code: number) => State | undefined;

interface TokenizerEffects {
  enter(type: string): void;
  exit(type: string): void;
  consume(code: number): void;
}

interface NodeSpec {
  container: string;
  marker: string;
  value: string;
  /** Number of characters in the opening marker (`[[` or `![[`). */
  openLength: number;
}

const WIKI_LINK: NodeSpec = {
  container: 'wikiLink',
  marker: 'wikiLinkMarker',
  value: 'wikiLinkValue',
  openLength: 2,
};

const TRANSCLUSION: NodeSpec = {
  container: 'transclusion',
  marker: 'transclusionMarker',
  value: 'transclusionValue',
  openLength: 3,
};

/** Build a tokenizer for one dialect node. */
function tokenize(spec: NodeSpec): (effects: TokenizerEffects, ok: State, nok: State) => State {
  return (effects: TokenizerEffects, ok: State, nok: State): State => {
    const proceed: State = (code) => ok(code);
    let cursor = 0;
    let data = false;

    return start;

    function start(code: number): State | undefined {
      // Entry code: `[` for wiki links, `!` for transclusions.
      const first = spec.openLength === 3 ? codes.exclamationMark : codes.leftSquareBracket;
      if (code !== first) return nok(code);
      effects.enter(spec.container);
      effects.enter(spec.marker);
      effects.consume(code);
      cursor = 1;
      return open;
    }

    function open(code: number): State | undefined {
      if (code !== codes.leftSquareBracket) return nok(code);
      effects.consume(code);
      cursor += 1;
      if (cursor === spec.openLength) {
        effects.exit(spec.marker);
        effects.enter(spec.value);
        return content;
      }
      return open;
    }

    function content(code: number): State | undefined {
      if (code === codes.eof || markdownLineEnding(code)) return nok(code);
      if (code === codes.backslash) {
        effects.consume(code);
        return escaped;
      }
      if (code === codes.rightSquareBracket) {
        // Require at least one non-whitespace character before closing.
        if (!data) return nok(code);
        effects.exit(spec.value);
        effects.enter(spec.marker);
        effects.consume(code);
        cursor = 1;
        return close;
      }
      if (!markdownLineEndingOrSpace(code)) data = true;
      effects.consume(code);
      return content;
    }

    function escaped(code: number): State | undefined {
      if (code === codes.eof || markdownLineEnding(code)) return nok(code);
      effects.consume(code);
      return content;
    }

    function close(code: number): State | undefined {
      if (code !== codes.rightSquareBracket) return nok(code);
      effects.consume(code);
      cursor += 1;
      if (cursor === 2) {
        effects.exit(spec.marker);
        effects.exit(spec.container);
        return proceed;
      }
      return close;
    }
  };
}

export function wikiLinkSyntax(): unknown {
  return {
    text: {
      [codes.leftSquareBracket]: {
        name: 'wikiLink',
        tokenize: tokenize(WIKI_LINK),
      },
      [codes.exclamationMark]: {
        name: 'transclusion',
        tokenize: tokenize(TRANSCLUSION),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// mdast-util-from-markdown extension: turn the tokens into mdast nodes with
// positions, buffering the raw value text via the `data` handlers (same
// technique the frontmatter extension uses).
// ---------------------------------------------------------------------------

interface CompileContext {
  enter(node: unknown, token: unknown): void;
  exit(token: unknown): void;
  buffer(): void;
  resume(): string;
  stack: Array<Record<string, unknown>>;
  config: {
    enter: Record<string, (this: CompileContext, token: unknown) => void>;
    exit: Record<string, (this: CompileContext, token: unknown) => void>;
  };
}

type FromMarkdownHandle = (this: CompileContext, token: unknown) => void;

function enterNode(nodeType: 'wikiLink' | 'transclusion'): FromMarkdownHandle {
  return function open(this: CompileContext, token: unknown): void {
    this.enter({ type: nodeType, target: '', children: [] as PhrasingContent[] }, token);
    this.buffer();
  };
}

function exitNode(nodeType: 'wikiLink' | 'transclusion'): FromMarkdownHandle {
  return function close(this: CompileContext, token: unknown): void {
    const raw = this.resume();
    const node = this.stack[this.stack.length - 1]!;
    if (nodeType === 'wikiLink') {
      const p = raw.indexOf('|');
      node.target = p >= 0 ? raw.slice(0, p) : raw;
      if (p >= 0) node.alias = raw.slice(p + 1);
    } else {
      const h = raw.indexOf('#');
      node.target = h >= 0 ? raw.slice(0, h) : raw;
      if (h >= 0) node.heading = raw.slice(h + 1);
    }
    this.exit(token);
  };
}

/** Compile the value text into the buffer (mirrors the frontmatter value handler). */
function value(this: CompileContext, token: unknown): void {
  this.config.enter.data!.call(this, token);
  this.config.exit.data!.call(this, token);
}

export function wikiLinkFromMarkdown(): {
  enter: Record<string, FromMarkdownHandle>;
  exit: Record<string, FromMarkdownHandle>;
} {
  return {
    enter: {
      wikiLink: enterNode('wikiLink'),
      transclusion: enterNode('transclusion'),
    },
    exit: {
      wikiLink: exitNode('wikiLink'),
      transclusion: exitNode('transclusion'),
      wikiLinkValue: value,
      transclusionValue: value,
    },
  };
}

// ---------------------------------------------------------------------------
// remark plugin: register both halves with the unified processor (same data
// mechanism remark-gfm uses).
// ---------------------------------------------------------------------------

interface ExtensionData {
  micromarkExtensions?: Array<unknown>;
  fromMarkdownExtensions?: Array<unknown>;
}

interface ProcessorLike {
  data(): ExtensionData;
}

/** remark plugin: parse `[[wiki links]]` and `![[transclusions]]` inline. */
export function inlineLinksPlugin(): undefined {
  // @ts-expect-error: unified invokes plugins with `this` bound to the processor.
  const self = this as ProcessorLike;
  const data = self.data();
  const micromarkExtensions = data.micromarkExtensions ?? (data.micromarkExtensions = []);
  const fromMarkdownExtensions = data.fromMarkdownExtensions ?? (data.fromMarkdownExtensions = []);
  micromarkExtensions.push(wikiLinkSyntax());
  fromMarkdownExtensions.push(wikiLinkFromMarkdown());
  return undefined;
}