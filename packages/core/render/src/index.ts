/**
 * @tributary/render — generic AST -> React renderer.
 *
 * This package owns the *mechanism* of turning a mdast document into a React
 * tree and is deliberately Electron-free and concrete-component-free. It knows
 * nothing about headings, paragraphs, wiki links, replot blocks, etc.; those
 * live in `@tributary/components`. Any node type that has no registered
 * component degrades to a source code fence (`renderUnknownBlock`) and never
 * throws — the portability rule from the architecture (§4.1).
 *
 * React remains the sole DOM owner: every component is a pure function that
 * returns React elements and never touches `document`/`window`.
 */

import { createElement, Fragment, cloneElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Node, Parent, Document } from '@tributary/api';

/**
 * A component that renders a single AST node to React elements.
 *
 * `children` is the already-rendered React tree for the node's children (when
 * the node is a parent); leaf nodes receive `undefined`.
 */
export type NodeComponent = (props: {
  node: Node;
  children?: ReactNode;
  ctx: RenderContext;
}) => ReactElement | null;

/**
 * Maps a node `type` (e.g. `"heading"`, `"wikiLink"`) to the component
 * that renders it.
 */
export interface ComponentRegistry {
  [nodeType: string]: NodeComponent;
}

/**
 * Ambient context threaded through every component. Currently carries the
 * source document and the chain of transcluded document ids leading here
 * (used by the components layer to guard embedding depth and cycles).
 */
export interface RenderContext {
  document: Document;
  /** Ids of documents expanded to reach this node, outermost first. */
  transclusionChain?: string[];
}

function childNodes(node: Node): Node[] {
  return 'children' in node ? (node as Parent).children : [];
}

function nodeValue(node: Node): string {
  const value = (node as { value?: unknown }).value;
  return typeof value === 'string' ? value : '';
}

/**
 * Degrade any unknown node to a source code fence (`<pre><code>`).
 *
 * This is the portability fallback: a renderer that does not understand a node
 * still shows its source readably and never corrupts the document. It must
 * never throw, even for nodes with no `value`.
 */
export function renderUnknownBlock(node: Node): ReactElement {
  return createElement(
    'pre',
    { className: 'tributary-unknown' },
    createElement('code', { className: `language-${node.type}` }, nodeValue(node)),
  );
}

function renderChildList(
  nodes: Node[],
  ctx: RenderContext,
  registry: ComponentRegistry,
): ReactNode[] {
  return nodes.map((child, index) => {
    const rendered = renderNode(child, ctx, registry);
    if (rendered === null) return null;
    // Keys keep React's reconciliation stable for lists; they do not appear
    // in server-rendered HTML and are ignored by renderToString.
    return cloneElement(rendered, { key: index });
  });
}

function renderNode(
  node: Node,
  ctx: RenderContext,
  registry: ComponentRegistry,
): ReactElement | null {
  const component = registry[node.type];
  if (!component) {
    return renderUnknownBlock(node);
  }
  const children = childNodes(node);
  const renderedChildren =
    children.length > 0 ? renderChildList(children, ctx, registry) : undefined;
  return component({ node, children: renderedChildren, ctx });
}

/**
 * Build a renderer for a given component registry.
 *
 * `createDocumentRenderer(registry)` returns a function that renders a
 * `Document` (its mdast `root`) into a single React element. The optional
 * second argument seeds the render context — the transclusion embedding chain
 * defaults to `[doc.id]`.
 */
export function createDocumentRenderer(
  registry: ComponentRegistry,
): (doc: Document, options?: { transclusionChain?: string[] }) => ReactElement {
  return function renderDocument(
    doc: Document,
    options: { transclusionChain?: string[] } = {},
  ): ReactElement {
    const ctx: RenderContext = {
      document: doc,
      transclusionChain: options.transclusionChain ?? [doc.id],
    };
    return renderNode(doc.root, ctx, registry) ?? createElement(Fragment, null);
  };
}
