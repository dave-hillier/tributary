import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import type { Document, DocumentFrontmatter, Root } from '@tributary/api';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import { inlineLinksPlugin } from './inline.js';
import { typedFencesPlugin } from './blocks.js';
import { dialectHandlers } from './serialize.js';

export type { WikiLink, Transclusion, Cell } from '@tributary/api';

export interface ParseOptions {
  /** Workspace-relative path, used to derive a stable id when frontmatter lacks one. */
  path?: string;
}

export interface StringifyOptions {}

const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(inlineLinksPlugin)
  .use(typedFencesPlugin);

const stringifier = unified().use(remarkStringify, {
  // Handlers are well-formed per mdast-util-to-markdown; the broad cast avoids
  // fighting the node-type map augmentation across the remark types boundary.
  handlers: dialectHandlers as never,
});

/** Parse Markdown source into a typed Document (frontmatter + mdast AST). */
export function parseMarkdown(source: string, options: ParseOptions = {}): Document {
  const { frontmatter, body } = parseFrontmatter(source);
  const root = parser.runSync(parser.parse(body)) as Root;
  const path = options.path ?? '';
  const id = frontmatter.id ?? (path ? path.replace(/\.md$/, '') : 'doc');
  return { id, path, frontmatter, root, source };
}

/** Serialize a Document back to Markdown (frontmatter + AST), canonical form. */
export function stringifyMarkdown(doc: Document, _options: StringifyOptions = {}): string {
  const body = stringifier.stringify(doc.root);
  // Prefer the raw frontmatter text (verbatim, comments/formatting preserved);
  // fall back to re-serializing the parsed object when no source is available.
  let fm: string | null = doc.source ? parseFrontmatter(doc.source).raw : null;
  if (fm === null && Object.keys(doc.frontmatter).length > 0) {
    fm = stringifyFrontmatter(doc.frontmatter).trimEnd();
  }
  if (fm === null) return body;
  return '---\n' + fm + '\n---\n\n' + body;
}

export { parseFrontmatter, updateFrontmatter } from './frontmatter.js';

export { headingText, findSection } from './section.js';

/**
 * Replace the source of one executable cell (by index, in document order) in
 * the raw Markdown source, preserving everything else byte-for-byte. Uses the
 * cell node's source position to locate its fenced block.
 */
export function replaceCellSource(source: string, cellIndex: number, newCellSource: string): string {
  const { body } = parseFrontmatter(source);
  const frontmatterLength = source.length - body.length;
  const root = parser.runSync(parser.parse(body)) as Root;

  const cells: Array<{ position?: { start: { offset?: number }; end: { offset?: number } }; lang: string }> = [];
  const walk = (node: any): void => {
    if (node.type === 'cell') cells.push({ position: node.position, lang: node.lang });
    if (node.children) for (const c of node.children) walk(c);
  };
  walk(root);

  const cell = cells[cellIndex];
  if (!cell || !cell.position || cell.position.start.offset === undefined || cell.position.end.offset === undefined) {
    return source;
  }
  const start = frontmatterLength + cell.position.start.offset;
  const end = frontmatterLength + cell.position.end.offset;
  const fence = '\u0060\u0060\u0060' + cell.lang + '\n' + newCellSource.replace(/\n+$/, '') + '\n\u0060\u0060\u0060';
  return source.slice(0, start) + fence + source.slice(end);
}