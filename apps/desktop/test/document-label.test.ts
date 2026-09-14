import { describe, it, expect } from 'vitest';
import { kindLabel } from '../src/renderer/document-label.js';
import type { Document } from '@tributary/api';

function doc(fm: Record<string, unknown>): Document {
  return { id: 'd', path: 'd.md', frontmatter: fm, root: { type: 'root', children: [] } } as unknown as Document;
}

describe('kindLabel', () => {
  it('reads the canonical type (finding 7)', () => {
    expect(kindLabel(doc({ type: 'project' }))).toBe('project');
    expect(kindLabel(doc({ type: 'note' }))).toBe('note');
  });

  it('folds the deprecated kind alias', () => {
    expect(kindLabel(doc({ kind: 'project' }))).toBe('project');
  });

  it('shows a work item status instead of its type', () => {
    expect(kindLabel(doc({ type: 'work-item', status: 'in-progress' }))).toBe('in-progress');
  });

  it('defaults to note', () => {
    expect(kindLabel(doc({}))).toBe('note');
  });
});
