import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import type { Document, DocumentFrontmatter, Root } from '@tributary/api';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import { inlineLinksPlugin } from './inline.js';
import { typedFencesPlugin } from './blocks.js';
import { dialectHandlers } from './serialize.js';

export type { WikiLink, Transclusion, ReplotBlock, CellBlock } from '@tributary/api';

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
  const keys = Object.keys(doc.frontmatter);
  if (keys.length === 0) return body;
  const yaml = stringifyFrontmatter(doc.frontmatter);
  return '---\n' + yaml + '---\n\n' + body;
}

export { parseFrontmatter } from './frontmatter.js';