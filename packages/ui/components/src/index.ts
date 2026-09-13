/**
 * @tributary/components — concrete mdast -> React components.
 *
 * Provides the defaultRegistry (a concrete component for every mdast node type
 * plus the Tributary dialect nodes) and DocumentView, the document renderer
 * bound to that registry.
 *
 * React remains the sole DOM owner: these components are pure functions that
 * return React elements and never touch document/window. Typed blocks render
 * statically (no code is executed); HTML is passed through only when it
 * survives a conservative allow-list sanitizer, otherwise it is skipped.
 */

import { createElement, Fragment, useEffect, useState, createContext, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type {
  Document,
  Heading,
  Text,
  InlineCode,
  Code,
  Link,
  Image,
  List,
  Html,
  WikiLink,
  Transclusion,
  Cell,
} from '@tributary/api';
import type { CellResult } from '@tributary/notebook';
import { createDocumentRenderer } from '@tributary/render';
import type { ComponentRegistry, NodeComponent } from '@tributary/render';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce a (possibly unknown) literal value to a displayable string. */
function literalString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/** A text node rendered as plain text inside a Fragment. */
function text(value: string): ReactElement {
  return createElement(Fragment, null, value);
}

// ---------------------------------------------------------------------------
// HTML sanitisation (conservative allow-list; unsafe HTML is skipped)
// ---------------------------------------------------------------------------

const DANGEROUS_TAG =
  /<\s*(script|iframe|object|embed|form|input|select|textarea|button|style|link|meta|title|base|frame|frameset|applet|svg|math|audio|video|source|track|template|dialog|portal)\b/i;
const EVENT_HANDLER = /\son[a-z]+\s*=/i;

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div',
  'dl', 'dt', 'dd', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav',
  'ol', 'ul', 'li', 'p', 'pre', 'section', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'th', 'td', 'caption', 'col', 'colgroup',
]);

function leadingTagName(html: string): string | null {
  const match = /^\s*<([a-zA-Z][a-zA-Z0-9]*)/.exec(html);
  const tag = match?.[1];
  return tag ? tag.toLowerCase() : null;
}

function isBlockHtml(html: string): boolean {
  const tag = leadingTagName(html);
  return tag !== null && BLOCK_TAGS.has(tag);
}

/** Return the sanitised HTML, or null when it must be skipped as unsafe. */
function sanitizeHtml(raw: string): string | null {
  const html = raw.trim();
  if (html === '') return null;
  if (DANGEROUS_TAG.test(html)) return null;
  if (EVENT_HANDLER.test(html)) return null;
  if (/\b(javascript|vbscript)\s*:/i.test(html)) return null;
  if (/data\s*:\s*text\/html/i.test(html)) return null;
  return html;
}

// ---------------------------------------------------------------------------
// Concrete components
// ---------------------------------------------------------------------------

const rootComponent: NodeComponent = ({ children }) =>
  createElement('div', { className: 'tributary-document' }, children);

const paragraphComponent: NodeComponent = ({ children }) =>
  createElement('p', null, children);

const headingComponent: NodeComponent = ({ node, children }) =>
  createElement('h' + (node as Heading).depth, null, children);

const textComponent: NodeComponent = ({ node }) =>
  text((node as Text).value);

const strongComponent: NodeComponent = ({ children }) =>
  createElement('strong', null, children);

const emphasisComponent: NodeComponent = ({ children }) =>
  createElement('em', null, children);

const deleteComponent: NodeComponent = ({ children }) =>
  createElement('del', null, children);

const inlineCodeComponent: NodeComponent = ({ node }) =>
  createElement('code', null, (node as InlineCode).value);

const breakComponent: NodeComponent = () => createElement('br');

const thematicBreakComponent: NodeComponent = () => createElement('hr');

const codeComponent: NodeComponent = ({ node }) => {
  const code = node as Code;
  return createElement(
    'pre',
    null,
    createElement(
      'code',
      { className: code.lang ? `language-${code.lang}` : undefined },
      code.value,
    ),
  );
};

const linkComponent: NodeComponent = ({ node, children }) =>
  createElement('a', { href: (node as Link).url }, children);

const imageComponent: NodeComponent = ({ node }) => {
  const image = node as Image;
  return createElement('img', {
    src: image.url,
    alt: image.alt ?? '',
    title: image.title || undefined,
  });
};

const listComponent: NodeComponent = ({ node, children }) => {
  const list = node as List;
  if (list.ordered) {
    const props: { start?: number } = {};
    if (typeof list.start === 'number') props.start = list.start;
    return createElement('ol', props, children);
  }
  return createElement('ul', null, children);
};

const listItemComponent: NodeComponent = ({ children }) =>
  createElement('li', null, children);

const blockquoteComponent: NodeComponent = ({ children }) =>
  createElement('blockquote', null, children);

const htmlComponent: NodeComponent = ({ node }) => {
  const safe = sanitizeHtml((node as Html).value);
  if (safe === null) return null;
  if (isBlockHtml(safe)) {
    return createElement('div', { dangerouslySetInnerHTML: { __html: safe } });
  }
  return createElement('span', { dangerouslySetInnerHTML: { __html: safe } });
};

const tableComponent: NodeComponent = ({ children }) =>
  createElement('table', null, children);

const tableRowComponent: NodeComponent = ({ children }) =>
  createElement('tr', null, children);

const tableCellComponent: NodeComponent = ({ children }) =>
  createElement('td', null, children);

// Frontmatter (YAML) is carried on Document.frontmatter and not re-rendered in
// the body; reference definitions are invisible metadata.
const yamlComponent: NodeComponent = () => null;
const definitionComponent: NodeComponent = () => null;

// Reference links cannot be resolved to a URL without the definition map, so
// we render the visible label text (links) or skip (images).
const linkReferenceComponent: NodeComponent = ({ children }) =>
  createElement(Fragment, null, children);

const imageReferenceComponent: NodeComponent = () => null;

// --- Tributary dialect nodes -------------------------------------------------

const wikiLinkComponent: NodeComponent = ({ node }) => {
  const link = node as WikiLink;
  return createElement(
    'a',
    { href: link.target, className: 'wiki-link' },
    link.alias ?? link.target,
  );
};

const transclusionComponent: NodeComponent = ({ node }) => {
  const t = node as Transclusion;
  const label = t.heading ? `${t.target}#${t.heading}` : t.target;
  return createElement(
    'div',
    { 'data-transclusion': t.target, className: 'transclusion-placeholder' },
    label,
  );
};

export interface CellEvaluator {
  evaluate: (lang: string, source: string) => Promise<CellResult>;
}

export const CellContext = createContext<CellEvaluator | null>(null);

function deserializeNode(v: unknown): ReactNode {
  if (Array.isArray(v)) return v.map(deserializeNode);
  if (v && typeof v === 'object' && 'kind' in v) {
    const r = v as CellResult;
    if (r.kind === 'element') return deserializeElement(r.type, r.props);
    if (r.kind === 'value') return r.text;
    if (r.kind === 'error') return r.message;
    return null;
  }
  return v as ReactNode;
}

function deserializeElement(type: string, props: Record<string, unknown>): ReactElement {
  const p: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) p[k] = deserializeNode(v);
  return createElement(type, p);
}

function CellView({ cell }: { cell: Cell }): ReactElement {
  const evaluator = useContext(CellContext);
  const [result, setResult] = useState<CellResult | null>(null);

  useEffect(() => {
    if (!evaluator) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await evaluator.evaluate(cell.lang, cell.value as string);
        if (!cancelled) setResult(r);
      } catch (e) {
        if (!cancelled) setResult({ kind: 'error', message: String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [evaluator, cell.lang, cell.value]);

  if (!evaluator) {
    const source = cell.value as string;
    return createElement(
      'pre',
      { className: 'cell' },
      createElement('code', { className: 'language-' + cell.lang }, source),
    );
  }
  if (result === null) return createElement('pre', { className: 'cell-loading' }, '…');
  switch (result.kind) {
    case 'element':
      return deserializeElement(result.type, result.props);
    case 'value':
      return createElement('pre', { className: 'cell-output' }, result.text);
    case 'error':
      return createElement('pre', { className: 'cell-error' }, result.message);
    case 'undefined':
      return createElement(Fragment, null);
  }
}

const cellComponent: NodeComponent = ({ node }) => {
  return createElement(CellView, { cell: node as Cell });
};

// ---------------------------------------------------------------------------
// Public registry + document view
// ---------------------------------------------------------------------------

/** Concrete component for every mdast node type plus the dialect nodes. */
export const defaultRegistry: ComponentRegistry = {
  root: rootComponent,
  paragraph: paragraphComponent,
  heading: headingComponent,
  text: textComponent,
  strong: strongComponent,
  emphasis: emphasisComponent,
  delete: deleteComponent,
  inlineCode: inlineCodeComponent,
  break: breakComponent,
  thematicBreak: thematicBreakComponent,
  code: codeComponent,
  link: linkComponent,
  image: imageComponent,
  list: listComponent,
  listItem: listItemComponent,
  blockquote: blockquoteComponent,
  html: htmlComponent,
  table: tableComponent,
  tableRow: tableRowComponent,
  tableCell: tableCellComponent,
  yaml: yamlComponent,
  definition: definitionComponent,
  linkReference: linkReferenceComponent,
  imageReference: imageReferenceComponent,
  wikiLink: wikiLinkComponent,
  transclusion: transclusionComponent,
  cell: cellComponent,
};

/**
 * Render a document with the default registry.
 * Equivalent to createDocumentRenderer(defaultRegistry)(document).
 */
export function DocumentView(props: { document: Document }): ReactElement {
  return createDocumentRenderer(defaultRegistry)(props.document);
}

export type { CellResult } from '@tributary/notebook';
