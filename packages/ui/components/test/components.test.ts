import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { DocumentView, TransclusionContext } from '@tributary/components';
import type { TransclusionResolver } from '@tributary/components';
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

  it('rejects entity-encoded, event-handler, style and data-URL smuggling', () => {
    const html = renderDoc({
      type: 'root',
      children: [
        // `&#106;` decodes to `j` — must not bypass the javascript: check.
        { type: 'html', value: '<a href="&#106;avascript:alert(1)">enc</a>' },
        // Event handler on a benign tag.
        { type: 'html', value: '<img src="x.png" onerror="alert(1)">' },
        // style attribute (CSS injection surface).
        { type: 'html', value: '<div style="position:fixed">x</div>' },
        // Non-image data: URL.
        { type: 'html', value: '<img src="data:text/html;base64,PHNvbGQ=">' },
        // Arbitrary attribute.
        { type: 'html', value: '<div onclick="alert(1)">y</div>' },
        // Case-insensitive vbscript.
        { type: 'html', value: '<a href="VBScRiPt:x()">z</a>' },
      ],
    });

    expect(html).not.toContain('&#106;');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('text/html');
    expect(html).not.toContain('vbscript');
  });

  it('keeps safe links and attributes', () => {
    const html = renderDoc({
      type: 'root',
      children: [
        { type: 'html', value: '<a href="https://example.com" rel="nofollow">link</a>' },
        { type: 'html', value: '<a href="/local/path" title="t">rel</a>' },
        { type: 'html', value: '<blockquote cite="https://src">q</blockquote>' },
        { type: 'html', value: '<table><tr><td colspan="2">x</td></tr></table>' },
      ],
    });

    expect(html).toContain('https://example.com');
    expect(html).toContain('/local/path');
    expect(html).toContain('cite=');
    expect(html).toContain('colspan');
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
describe('transclusion embedding (Stage 2)', () => {
  const transclusion = (target: string, heading?: string) => ({
    type: 'transclusion' as const,
    target,
    ...(heading ? { heading } : {}),
    children: [],
  });

  function renderWithResolver(
    root: Document['root'],
    resolver: TransclusionResolver | null,
    selfId = 'doc-1',
  ): string {
    const doc: Document = { id: selfId, path: 'index.md', frontmatter: {}, root };
    const view = createElement(DocumentView, { document: doc });
    if (!resolver) return renderToString(view);
    return renderToString(
      createElement(TransclusionContext.Provider, { value: resolver }, view),
    );
  }

  const targetDoc: Document = {
    id: 'notes/b',
    path: 'notes/b.md',
    frontmatter: { title: 'B' },
    root: {
      type: 'root',
      children: [
        { type: 'heading', depth: 1, children: [{ type: 'text', value: 'B Doc' }] },
        { type: 'paragraph', children: [{ type: 'text', value: 'embedded body' }] },
      ],
    },
  };

  const resolver: TransclusionResolver = {
    resolve: (target, heading) => (target === 'notes/b' ? targetDoc : undefined),
  };

  it('embeds the resolved document content instead of a placeholder', () => {
    const html = renderWithResolver(
      { type: 'root', children: [{ type: 'paragraph', children: [transclusion('notes/b')] }] },
      resolver,
    );
    expect(html).toContain('embedded body');
    expect(html).toContain('data-transclusion-embed="notes/b.md"');
    expect(html).not.toContain('transclusion-placeholder');
  });

  it('embeds a heading section when a heading is requested', () => {
    const sectionResolver: TransclusionResolver = {
      resolve: (target, heading) => {
        if (target !== 'notes/b' || heading !== 'Details') return undefined;
        // Synthetic section document (root = the section slice).
        return {
          id: 'notes/b',
          path: 'notes/b.md',
          frontmatter: {},
          root: {
            type: 'root',
            children: [
              { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Details' }] },
              { type: 'paragraph', children: [{ type: 'text', value: 'only this section shows' }] },
            ],
          },
        } as Document;
      },
    };
    const html = renderWithResolver(
      { type: 'root', children: [{ type: 'paragraph', children: [transclusion('notes/b', 'Details')] }] },
      sectionResolver,
    );
    expect(html).toContain('only this section shows');
  });

  it('falls back to a placeholder when the target is unresolved', () => {
    const html = renderWithResolver(
      { type: 'root', children: [{ type: 'paragraph', children: [transclusion('missing')] }] },
      resolver,
    );
    expect(html).toContain('transclusion-placeholder');
    expect(html).toContain('missing');
  });

  it('remains a placeholder when no resolver is wired', () => {
    const html = renderWithResolver(
      { type: 'root', children: [{ type: 'paragraph', children: [transclusion('notes/b')] }] },
      null,
    );
    expect(html).toContain('transclusion-placeholder');
  });

  it('fails visibly and safely on a circular transclusion (a -> b -> a)', () => {
    const docA: Document = {
      id: 'a', path: 'a.md', frontmatter: {},
      root: { type: 'root', children: [{ type: 'paragraph', children: [transclusion('b')] }] },
    };
    const docB: Document = {
      id: 'b', path: 'b.md', frontmatter: {},
      root: { type: 'root', children: [{ type: 'paragraph', children: [transclusion('a')] }] },
    };
    const cyclic: TransclusionResolver = {
      resolve: (target) => (target === 'a' ? docA : docB),
    };
    const html = renderWithResolver(
      { type: 'root', children: [{ type: 'paragraph', children: [transclusion('a')] }] },
      cyclic,
      'self',
    );
    expect(html).toContain('Circular transclusion');
    expect(html).toContain('data-transclusion-error');
  });

  it('fails visibly at the embed depth limit instead of recursing forever', () => {
    const n = 16; // > MAX_EMBED_DEPTH (12)
    const chain = new Map<string, Document>();
    for (let i = 0; i < n; i++) {
      const id = 'd' + i;
      chain.set(id, {
        id,
        path: id + '.md',
        frontmatter: {},
        root: {
          type: 'root',
          children: [
            { type: 'paragraph', children: [transclusion('d' + (i + 1))] },
          ],
        },
      });
    }
    const deep: TransclusionResolver = { resolve: (target) => chain.get(target) };
    const html = renderWithResolver(
      { type: 'root', children: [{ type: 'paragraph', children: [transclusion('d0')] }] },
      deep,
      'self',
    );
    expect(html).toContain('Transclusion depth limit reached');
    expect(html).toContain('data-transclusion-error');
  });
});
