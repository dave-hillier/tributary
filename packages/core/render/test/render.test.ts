import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement, Fragment } from 'react';
import {
  createDocumentRenderer,
  renderUnknownBlock,
} from '@tributary/render';
import type { NodeComponent, ComponentRegistry } from '@tributary/render';
import type { Node, Literal, Document, Text } from '@tributary/api';

describe('renderUnknownBlock', () => {
  it('renders an unknown literal node as a source code fence', () => {
    const node: Literal = { type: 'query', value: 'SELECT * FROM docs' };
    const html = renderToString(renderUnknownBlock(node));

    expect(html).toContain('<pre');
    expect(html).toContain('<code');
    expect(html).toContain('language-query');
    expect(html).toContain('SELECT * FROM docs');
  });

  it('never throws and still emits a fence for a value-less node', () => {
    const node: Node = { type: 'mystery' };
    const html = renderToString(renderUnknownBlock(node));

    expect(html).toContain('<pre');
    expect(html).toContain('<code');
    expect(html).toContain('language-mystery');
  });
});

describe('createDocumentRenderer', () => {
  const root: NodeComponent = ({ children }) =>
    createElement('div', { className: 'doc' }, children);
  const paragraph: NodeComponent = ({ children }) =>
    createElement('p', null, children);
  const text: NodeComponent = ({ node }) =>
    createElement(Fragment, null, (node as Text).value);

  const registry: ComponentRegistry = { root, paragraph, text };

  it('renders known nodes and degrades unknown blocks to a code fence', () => {
    const doc: Document = {
      id: 'doc-1',
      path: 'index.md',
      frontmatter: {},
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Known paragraph.' }],
          },
          // An unknown typed block that the registry does not understand.
          { type: 'queryBlock', value: 'SHOW TABLES' },
        ],
      },
    };

    const html = renderToString(createDocumentRenderer(registry)(doc));

    // Known node renders normally.
    expect(html).toContain('<p>Known paragraph.</p>');
    // Unknown node degrades to a code fence (never throws).
    expect(html).toContain('<pre');
    expect(html).toContain('language-queryBlock');
    expect(html).toContain('SHOW TABLES');
  });

  it('never throws when the registry is empty', () => {
    const doc: Document = {
      id: 'doc-1',
      path: 'index.md',
      frontmatter: {},
      root: {
        type: 'root',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] }],
      },
    };

    // Every node type is unknown here, so the whole tree becomes code fences.
    expect(() => renderToString(createDocumentRenderer({})(doc))).not.toThrow();
  });
});
