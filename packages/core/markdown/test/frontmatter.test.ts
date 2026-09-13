import { describe, it, expect } from 'vitest';
import { parseMarkdown, stringifyMarkdown, updateFrontmatter } from '../src/index.js';

describe('updateFrontmatter', () => {
  it('updates one key while preserving comments, other keys and body', () => {
    const src = '---\nid: task-1\n# a comment\nstatus: todo\npriority: high\n---\n\n# Body\n';
    const out = updateFrontmatter(src, { status: 'done' });
    expect(out).toContain('status: done');
    expect(out).toContain('# a comment');
    expect(out).toContain('priority: high');
    expect(out).toContain('id: task-1');
    expect(out).toContain('# Body');
    expect(out).not.toContain('status: todo');
  });

  it('appends a key that does not yet exist', () => {
    const src = '---\ntitle: T\n---\n\n# Body\n';
    expect(updateFrontmatter(src, { status: 'done' })).toBe('---\ntitle: T\nstatus: done\n---\n\n# Body\n');
  });

  it('creates a frontmatter block when none is present', () => {
    expect(updateFrontmatter('# Body\n', { kind: 'wiki' })).toBe('---\nkind: wiki\n---\n\n# Body\n');
  });
});

describe('stringifyMarkdown preserves raw frontmatter', () => {
  it('keeps frontmatter comments across a round-trip', () => {
    const src = '---\ntitle: T\n# keep me\nkind: wiki\n---\n\n# Hi\n';
    const doc = parseMarkdown(src, { path: 'x.md' });
    const out = stringifyMarkdown(doc);
    expect(out).toContain('# keep me');
    expect(out).toContain('kind: wiki');
    // and it remains idempotent
    const doc2 = parseMarkdown(out, { path: 'x.md' });
    expect(doc2.frontmatter.kind).toBe('wiki');
    expect(doc2.frontmatter.title).toBe('T');
  });
});
