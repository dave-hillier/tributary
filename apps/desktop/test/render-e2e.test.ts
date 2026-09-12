import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { parseMarkdown } from '@tributary/markdown';
import { DocumentView } from '@tributary/components';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, '../../../docs/examples/slice-0');

describe('slice-0 end-to-end render (fixture -> parser -> renderer -> HTML)', () => {
  it('renders index.md with links, transclusion and a replot block', () => {
    const source = readFileSync(join(FIXTURES, 'index.md'), 'utf8');
    const doc = parseMarkdown(source, { path: 'index.md' });

    expect(doc.frontmatter.kind).toBe('index');
    expect(doc.frontmatter.title).toBe('Tributary Demo');

    const html = renderToString(createElement(DocumentView, { document: doc }));
    expect(html).toContain('Tributary Demo');
    expect(html).toContain('data-replot');
    expect(html).toContain('data-transclusion');
    expect(html).toContain('notes/hello');
  });

  it('renders a work item document from its frontmatter', () => {
    const source = readFileSync(join(FIXTURES, 'items/task-1.md'), 'utf8');
    const doc = parseMarkdown(source, { path: 'items/task-1.md' });
    expect(doc.frontmatter.kind).toBe('work-item');
    expect(doc.frontmatter.status).toBe('todo');

    const html = renderToString(createElement(DocumentView, { document: doc }));
    expect(html).toContain('Ship the demo');
  });
});
