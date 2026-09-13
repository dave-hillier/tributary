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

import { createElement, Fragment, createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactElement, ReactNode } from 'react';
import type {
  Document,
  Node,
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
import { createDocumentRenderer } from '@tributary/render';
import type { ComponentRegistry, NodeComponent, RenderContext } from '@tributary/render';
import { InlineEditor } from './prosemirror/InlineEditor.js';
import { supportsInlineEditing } from './prosemirror/convert.js';

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
// HTML sanitisation (conservative; unsafe HTML is skipped, never rendered)
// ---------------------------------------------------------------------------

const DANGEROUS_TAG =
  /<\s*(script|iframe|object|embed|form|input|select|textarea|button|style|link|meta|title|base|frame|frameset|applet|svg|math|audio|video|source|track|template|dialog|portal)\b/i;
const EVENT_HANDLER = /\son[a-z]+\s*=/i;
const UNSAFE_SCHEME = /\b(javascript|vbscript)\s*:/i;
const DATA_TEXT_HTML = /data\s*:\s*text\/html/i;

/** Attributes allowed to survive in document HTML (everything else is stripped). */
const SAFE_ATTRS = new Set([
  'class', 'id', 'lang', 'dir', 'title', 'alt',
  'width', 'height', 'colspan', 'rowspan', 'abbr', 'scope', 'headers', 'summary',
  'cite', 'datetime', 'rel', 'download',
]);
/** Attribute names whose value is a URL subject to scheme checking. */
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'cite']);

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div',
  'dl', 'dt', 'dd', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav',
  'ol', 'ul', 'li', 'p', 'pre', 'section', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'th', 'td', 'caption', 'col', 'colgroup',
]);

/** Decode character references in a COPY used only for checks (raw HTML from
 * markdown is passed through verbatim, so `&#106;avascript:` would otherwise
 * bypass a literal-substring check — the browser decodes it to `javascript:`). */
function decodeEntitiesForCheck(input: string): string {
  let out = '';
  let i = 0;
  const re = /&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi;
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    nbsp: ' ', period: '.', colon: ':', semi: ';', tab: '\t',
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    out += input.slice(i, m.index);
    let decoded: string | undefined = named[m[1]!.toLowerCase()];
    if (decoded === undefined) {
      const body = m[1]!;
      const code = body.startsWith('#x')
        ? parseInt(body.slice(2), 16)
        : body.startsWith('#') ? parseInt(body.slice(1), 10) : Number.NaN;
      if (Number.isFinite(code) && code > 32 && code < 0xd800) {
        decoded = String.fromCodePoint(code);
      }
    }
    out += decoded ?? m[0];
    i = m.index + m[0].length;
  }
  return out + input.slice(i);
}

function leadingTagName(html: string): string | null {
  const match = /^\s*<([a-zA-Z][a-zA-Z0-9]*)/.exec(html);
  const tag = match?.[1];
  return tag ? tag.toLowerCase() : null;
}

function isBlockHtml(html: string): boolean {
  const tag = leadingTagName(html);
  return tag !== null && BLOCK_TAGS.has(tag);
}

/** Only http(s), mailto, tel and relative/fragment URLs are allowed. */
function isSafeUrl(value: string): boolean {
  const v = value.trim();
  if (v === '') return true;
  if (v.startsWith('#') || v.startsWith('/')) return true;
  return /^(https?:|mailto:|tel:)/i.test(v);
}

/** True when every attribute on every opening tag is allowed. */
function attributesAreSafe(html: string): boolean {
  const tagRe = /<\s*([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
  const attrRe = /\s+([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(html))) {
    const rawAttrs = tag[2] ?? '';
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(rawAttrs))) {
      const name = a[1]!.toLowerCase();
      const value = (a[2] ?? a[3] ?? a[4] ?? '').trim();
      if (name.startsWith('on')) return false;
      if (name === 'style') return false;
      // URL attributes are allowed only when the URL itself is safe; all other
      // attribute names must be in the allow-list.
      const isUrlAttr = URL_ATTRS.has(name);
      if (!isUrlAttr && !SAFE_ATTRS.has(name)) return false;
      if (isUrlAttr && !isSafeUrl(value)) return false;
    }
  }
  return true;
}

/**
 * Sanitise a raw HTML fragment for display. Returns the HTML when it is safe
 * (allowed tags, allow-listed attributes, safe URLs, no event handlers), or
 * null when any part is unsafe — in which case the whole fragment is skipped
 * rather than partially rendered (arch §8: HTML is inert or absent).
 */
function sanitizeHtml(raw: string): string | null {
  const html = raw.trim();
  if (html === '') return null;
  const checked = decodeEntitiesForCheck(html);
  if (DANGEROUS_TAG.test(checked)) return null;
  if (EVENT_HANDLER.test(checked)) return null;
  if (UNSAFE_SCHEME.test(checked)) return null;
  if (DATA_TEXT_HTML.test(checked)) return null;
  if (!attributesAreSafe(checked)) return null;
  return html;
}

// ---------------------------------------------------------------------------
// In-place block editing (click a rendered text section to edit its Markdown)
// ---------------------------------------------------------------------------

/**
 * Supplies the raw Markdown source of a block node and persists a replacement
 * back into the document. Provided by the shell (which owns the workspace);
 * components stay pure. When no resolver is wired, blocks render read-only.
 */
export interface EditResolver {
  /** Raw Markdown source of a block node, or null when it has no source span. */
  sourceOf: (doc: Document, node: Node) => string | null;
  /** Persist a replacement Markdown source for a block node. */
  update: (doc: Document, node: Node, source: string) => Promise<void>;
}

export const EditContext = createContext<EditResolver | null>(null);

/**
 * Wraps a block-level text node (paragraph, heading, list item, blockquote,
 * table cell) so it can be edited in place: clicking it swaps the rendered
 * block for a textarea pre-filled with its Markdown source. Commits on blur or
 * Cmd/Ctrl+Enter, cancels on Escape. Link clicks bubble through untouched.
 */
function EditableBlock(props: {
  node: Node;
  ctx: RenderContext;
  tag: string;
  children: ReactNode;
}): ReactElement {
  const resolver = useContext(EditContext);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const source = resolver ? resolver.sourceOf(props.ctx.document, props.node) : null;

  // No resolver wired (bare DocumentView, headless tests) or no source span
  // (hand-built ASTs): render exactly as before, with no edit affordance.
  if (!resolver || source === null) {
    return createElement(props.tag, null, props.children);
  }

  if (!editing) {
    return createElement(
      props.tag,
      {
        className: 'tributary-editable',
        'data-editable': props.node.type,
        title: 'Click to edit',
        onClick: (e: MouseEvent<HTMLElement>) => {
          // Let link clicks (wiki links, transclusions) pass through unchanged.
          if ((e.target as HTMLElement).closest('a')) return;
          e.stopPropagation();
          setDraft(source);
          setEditing(true);
        },
      },
      props.children,
    );
  }

  const commit = async (): Promise<void> => {
    if (saving) return;
    const next = draft;
    setEditing(false);
    if (next !== source) {
      setSaving(true);
      try {
        await resolver.update(props.ctx.document, props.node, next);
      } finally {
        setSaving(false);
      }
    }
  };

  const cancel = (): void => setEditing(false);

  const rows = Math.min(16, Math.max(1, draft.split('\n').length));

  return createElement('textarea', {
    className: 'block-editor',
    'data-block-editor': props.node.type,
    value: draft,
    rows,
    autoFocus: true,
    title: 'Cmd/Ctrl+Enter to save · Esc to cancel',
    onChange: (e: ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: () => void commit(),
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    },
  });
}

/**
 * In-place ProseMirror editing for a leaf text block (paragraph/heading/cell).
 * Clicking swaps the rendered block for a ProseMirror editor editing its inline
 * content; commits on Enter / Cmd+Enter / blur, cancels on Escape.
 */
function ProseMirrorEditableBlock(props: {
  node: Node;
  ctx: RenderContext;
  tag: string;
  children: ReactNode;
}): ReactElement {
  const resolver = useContext(EditContext);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const source = resolver ? resolver.sourceOf(props.ctx.document, props.node) : null;

  if (!resolver || source === null) {
    return createElement(props.tag, null, props.children);
  }

  if (!editing) {
    return createElement(
      props.tag,
      {
        className: 'tributary-editable',
        'data-editable': props.node.type,
        title: 'Click to edit',
        onClick: (e: MouseEvent<HTMLElement>) => {
          if ((e.target as HTMLElement).closest('a')) return;
          e.stopPropagation();
          setEditing(true);
        },
      },
      props.children,
    );
  }

  const commit = async (markdown: string): Promise<void> => {
    if (saving) return;
    setEditing(false);
    if (markdown !== source) {
      setSaving(true);
      try {
        await resolver.update(props.ctx.document, props.node, markdown);
      } finally {
        setSaving(false);
      }
    }
  };

  return createElement(InlineEditor, {
    node: props.node,
    onCommit: (m: string) => void commit(m),
    onCancel: () => setEditing(false),
  });
}

// ---------------------------------------------------------------------------
// Concrete components
// ---------------------------------------------------------------------------

// Classless root: render the document's blocks directly (no wrapper class) so
// the shell's `[data-doc] > :first-child` rules land on the first real block.
const rootComponent: NodeComponent = ({ children }) =>
  createElement(Fragment, null, children);

const paragraphComponent: NodeComponent = ({ node, children, ctx }) =>
  supportsInlineEditing(node)
    ? createElement(ProseMirrorEditableBlock, { node, ctx, tag: 'p', children })
    : createElement(EditableBlock, { node, ctx, tag: 'p', children });

const headingComponent: NodeComponent = ({ node, children, ctx }) =>
  supportsInlineEditing(node)
    ? createElement(ProseMirrorEditableBlock, { node, ctx, tag: 'h' + (node as Heading).depth, children })
    : createElement(EditableBlock, { node, ctx, tag: 'h' + (node as Heading).depth, children });

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

const tableCellComponent: NodeComponent = ({ node, children, ctx }) =>
  supportsInlineEditing(node)
    ? createElement(ProseMirrorEditableBlock, { node, ctx, tag: 'td', children })
    : createElement(EditableBlock, { node, ctx, tag: 'td', children });

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

// --- Transclusion embedding (Stage 2) ------------------------------------------

/**
 * Resolves a transclusion reference to a renderable document. Supplied by the
 * shell (which owns the workspace/index); components stay pure. For a heading
 * embed the resolver may return a *synthetic* document whose root is exactly
 * the heading's section slice.
 */
export interface TransclusionResolver {
  resolve(target: string, heading?: string): Document | undefined;
}

export const TransclusionContext = createContext<TransclusionResolver | null>(null);

/** Render-time guard: fail visibly instead of recursing forever (§8). */
const MAX_EMBED_DEPTH = 12;

function transclusionDiagnostic(message: string): ReactElement {
  return createElement(
    'div',
    { 'data-transclusion-error': '', className: 'transclusion-diagnostic' },
    message,
  );
}

const transclusionComponent: NodeComponent = ({ node, ctx }) => {
  const t = node as Transclusion;
  const resolver = useContext(TransclusionContext);
  const chain = ctx?.transclusionChain ?? ['doc'];

  const placeholder = (): ReactElement => {
    const label = t.heading ? `${t.target}#${t.heading}` : t.target;
    return createElement(
      'div',
      { 'data-transclusion': t.target, className: 'transclusion-placeholder' },
      label,
    );
  };

  // No resolver wired (bare DocumentView, headless tests, source view): the
  // dialect node degrades to a placeholder, never to an error.
  if (!resolver) return placeholder();

  const target = resolver.resolve(t.target, t.heading);
  if (!target) return placeholder();

  if (chain.includes(target.id)) {
    return transclusionDiagnostic(
      `Circular transclusion: ${[...chain, target.id].join(' → ')}`,
    );
  }
  if (chain.length >= MAX_EMBED_DEPTH) {
    return transclusionDiagnostic(
      `Transclusion depth limit reached (${MAX_EMBED_DEPTH})`,
    );
  }
  const render = createDocumentRenderer(defaultRegistry);
  return createElement(
    'div',
    { className: 'transclusion', 'data-transclusion-embed': target.path },
    render(target, { transclusionChain: [...chain, target.id] }),
  );
};

/** A cell's live render output, produced by the renderer-side evaluator. */
export interface CellRenderResult {
  node: ReactNode;
  error: boolean;
}

export interface CellResolver {
  resolve: (cell: Cell) => CellRenderResult | undefined;
  update: (cell: Cell, source: string) => Promise<void>;
  /** 0-based position of the cell in document order, when the host knows it. */
  indexOf?: (cell: Cell) => number;
}

export const CellContext = createContext<CellResolver | null>(null);

function CellView({ cell }: { cell: Cell }): ReactElement {
  const resolver = useContext(CellContext);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const source = cell.value as string;

  if (!resolver) {
    // No evaluator wired: degrade to a source-only code fence.
    return createElement(
      'pre',
      { className: 'cell' },
      createElement('code', { className: 'language-' + cell.lang }, source),
    );
  }

  const result = resolver.resolve(cell);
  const index = resolver.indexOf ? resolver.indexOf(cell) : undefined;
  const status: string =
    !result ? 'pending' : result.error ? 'error' : 'ok';
  const label =
    (cell.lang ?? 'cell') + (index !== undefined ? ' · cell ' + (index + 1) : '');

  const onEdit = (v: string): void => {
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void resolver.update(cell, v);
    }, 500);
  };

  return createElement(
    'figure',
    { 'data-cell': '', 'data-lang': cell.lang, 'data-status': status },
    createElement(
      'figcaption',
      null,
      createElement('span', null, label),
      createElement(
        'span',
        { 'data-cell-actions': '' },
        createElement(
          'span',
          { 'data-status': status },
          status === 'error' ? 'error' : status === 'pending' ? '…' : 'ok',
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: 'cell-edit-toggle',
            onClick: () => {
              if (!editing) setDraft(source);
              setEditing(!editing);
            },
          },
          editing ? 'Done' : 'Edit cell',
        ),
      ),
    ),
    createElement(
      'div',
      { 'data-cell-body': '' },
      result === undefined ? null : result.node,
    ),
    editing
      ? createElement('textarea', {
          className: 'cell-editor',
          value: draft ?? source,
          rows: 6,
          onChange: (e: ChangeEvent<HTMLTextAreaElement>) => onEdit(e.target.value),
        })
      : null,
  );
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