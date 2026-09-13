import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { DocumentView } from '@tributary/components';
import type { Document } from '@tributary/api';

function renderDoc(root: Document['root']): string {
  const doc: Document = { id: 'doc-1', path: 'index.md', frontmatter: {}, root };
  return renderToString(createElement(DocumentView, { document: doc }));
}

describe('DocumentView', () => {
  it('renders a heading, paragraph, and ordered list', () => {
    const html = renderDoc({
      type: 'root',
      children: [
        { type: 'heading', depth: 1, children: [{ type: 'text', value: 'Title' }] },
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Hello ' },
            { type: 'strong', children: [{ type: 'text', value: 'world' }] },
          ],
        },
        {
          type: 'list',
          ordered: true,
          children: [
            {
              type: 'listItem',
              children: [
                { type: 'paragraph', children: [{ type: 'text', value: 'One' }] },
              ],
            },
            {
              type: 'listItem',
              children: [
                { type: 'paragraph', children: [{ type: 'text', value: 'Two' }] },
              ],
            },
          ],
        },
      ],
    });

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<p>Hello <strong>world</strong></p>');
    expect(html).toContain('<ol><li><p>One</p></li><li><p>Two</p></li></ol>');
  });

  it('renders a wikiLink as an anchor with alias or target label', () => {
    const html = renderDoc({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'wikiLink', target: 'notes/foo', alias: 'Foo', children: [] },
          ],
        },
        {
          type: 'paragraph',
          children: [{ type: 'wikiLink', target: 'notes/bar', children: [] }],
        },
      ],
    });

    expect(html).toContain('<a href="notes/foo" class="wiki-link">Foo</a>');
    expect(html).toContain('<a href="notes/bar" class="wiki-link">notes/bar</a>');
  });

  it('renders a cell as a source-only code fence', () => {
    const html = renderDoc({
      type: 'root',
      children: [
        {
          type: 'cell',
          lang: 'tsx',
          value: '<Replot><BarY data={[[0,0],[1,2]]} /></Replot>',
        },
      ],
    });

    expect(html).toContain('<pre');
    expect(html).toContain('<code class="language-tsx">');
    expect(html).toContain('&lt;Replot&gt;');
    // Nothing executed: no chart SVG was produced.
    expect(html).not.toContain('<svg');
  });

  it('renders a transclusion as a placeholder div', () => {
    const html = renderDoc({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'transclusion', target: 'notes/other', children: [] },
          ],
        },
      ],
    });

    expect(html).toContain('data-transclusion="notes/other"');
    expect(html).toContain('transclusion-placeholder');
    expect(html).toContain('notes/other');
  });

  it('passes through safe HTML and skips unsafe HTML', () => {
    const html = renderDoc({
      type: 'root',
      children: [
        { type: 'html', value: '<div class="note">hello</div>' },
        { type: 'html', value: '<script>alert(1)</script>' },
        { type: 'html', value: '<a href="javascript:alert(1)">x</a>' },
      ],
    });

    expect(html).toContain('<div class="note">hello</div>');
    expect(html).not.toContain('script');
    expect(html).not.toContain('javascript:');
  });

  it('degrades an unknown node type to a code fence', () => {
    const html = renderDoc({
      type: 'root',
      children: [{ type: 'someFutureBlock', value: 'raw source' }],
    });

    expect(html).toContain('<pre');
    expect(html).toContain('language-someFutureBlock');
    expect(html).toContain('raw source');
  });

  it('renders ordinary CommonMark/GFM constructs', () => {
    const html = renderDoc({
      type: 'root',
      children: [
        {
          type: 'blockquote',
          children: [
            {
              type: 'paragraph',
              children: [
                { type: 'text', value: 'Quote ' },
                { type: 'emphasis', children: [{ type: 'text', value: 'em' }] },
              ],
            },
          ],
        },
        { type: 'code', lang: 'ts', value: 'const x = 1;' },
        {
          type: 'paragraph',
          children: [
            { type: 'inlineCode', value: 'code()' },
            { type: 'text', value: ' and ' },
            { type: 'delete', children: [{ type: 'text', value: 'gone' }] },
          ],
        },
        {
          type: 'paragraph',
          children: [
            { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'Example' }] },
          ],
        },
        {
          type: 'paragraph',
          children: [
            { type: 'image', url: 'img.png', alt: 'alt text' },
          ],
        },
        { type: 'thematicBreak' },
        {
          type: 'table',
          children: [
            {
              type: 'tableRow',
              children: [
                { type: 'tableCell', children: [{ type: 'text', value: 'A' }] },
                { type: 'tableCell', children: [{ type: 'text', value: 'B' }] },
              ],
            },
          ],
        },
      ],
    });

    expect(html).toContain('<blockquote><p>Quote <em>em</em></p></blockquote>');
    expect(html).toContain('<pre><code class="language-ts">const x = 1;</code></pre>');
    expect(html).toContain('<code>code()</code>');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<a href="https://example.com">Example</a>');
    expect(html).toContain('<img src="img.png" alt="alt text"/>');
    expect(html).toContain('<hr/>');
    expect(html).toContain('<table><tr><td>A</td><td>B</td></tr></table>');
  });
});