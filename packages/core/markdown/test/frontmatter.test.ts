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

  it('patches a top-level key without rewriting the same key nested below', () => {
    const src = '---\nmeta:\n  status: draft\ntitle: T\n---\n\nBody\n';
    const out = updateFrontmatter(src, { status: 'todo' });
    expect(out).toContain('  status: draft');
    expect(out).toContain('status: todo');
    const fm = parseMarkdown(out, { path: 'x.md' }).frontmatter as Record<string, unknown>;
    expect(fm.status).toBe('todo');
    expect(fm.meta).toEqual({ status: 'draft' });
  });

  it('serializes a list as an indented block that re-parses', () => {
    const src = '---\nassignees: alice\n---\n\nBody\n';
    const out = updateFrontmatter(src, { assignees: ['user:a', 'user:b'] });
    expect(out).toContain('assignees:\n  - user:a\n  - user:b');
    const fm = parseMarkdown(out, { path: 'x.md' }).frontmatter as Record<string, unknown>;
    expect(fm.assignees).toEqual(['user:a', 'user:b']);
  });

  it('replaces an existing block list rather than leaving orphaned items', () => {
    const src = '---\nassignees:\n- user:a\n- user:b\ntitle: T\n---\n\nBody\n';
    const out = updateFrontmatter(src, { assignees: ['user:c'] });
    expect(out).toContain('assignees:\n  - user:c');
    expect(out).not.toContain('user:a');
    const fm = parseMarkdown(out, { path: 'x.md' }).frontmatter as Record<string, unknown>;
    expect(fm.assignees).toEqual(['user:c']);
    expect(fm.title).toBe('T');
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
