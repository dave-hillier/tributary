import { describe, it, expect } from 'vitest';
import { blockToProseMirror, serializeBlock, supportsInlineEditing } from '../src/prosemirror/convert.js';
import type { Node } from '@tributary/api';

const para = (children: Node[]): Node => ({ type: 'paragraph', children });
const heading = (depth: number, children: Node[]): Node => ({ type: 'heading', depth, children });
const text = (value: string): Node => ({ type: 'text', value });

function roundTrip(node: Node): string {
  return serializeBlock(blockToProseMirror(node));
}

describe('ProseMirror block converter', () => {
  it('round-trips a plain paragraph', () => {
    expect(roundTrip(para([text('Hello world.')]))).toBe('Hello world.');
  });

  it('round-trips inline formatting (strong, em, code, del)', () => {
    const node = para([
      text('a '),
      { type: 'strong', children: [text('bold')] },
      text(' '),
      { type: 'emphasis', children: [text('em')] },
      text(' '),
      { type: 'inlineCode', value: 'code' },
      text(' '),
      { type: 'delete', children: [text('gone')] },
    ]);
    expect(roundTrip(node)).toBe('a **bold** *em* `code` ~~gone~~');
  });

  it('round-trips a heading with its level', () => {
    expect(roundTrip(heading(2, [text('Title')]))).toBe('## Title');
  });

  it('round-trips wiki links and transclusions', () => {
    const node = para([
      text('See '),
      { type: 'wikiLink', target: 'notes/foo', alias: 'Foo', children: [] },
      text(' and '),
      { type: 'transclusion', target: 'notes/other', children: [] },
    ]);
    expect(roundTrip(node)).toBe('See [[notes/foo|Foo]] and ![[notes/other]]');
  });

  it('round-trips a link and an image', () => {
    const node = para([
      { type: 'link', url: 'https://example.com', children: [text('Example')] },
      text(' '),
      { type: 'image', url: 'img.png', alt: 'alt text', children: [] },
    ]);
    expect(roundTrip(node)).toBe('[Example](https://example.com) ![alt text](img.png)');
  });

  it('supportsInlineEditing rejects unsupported inline nodes', () => {
    expect(supportsInlineEditing(para([text('x')]))).toBe(true);
    expect(supportsInlineEditing(para([{ type: 'linkReference', identifier: 'r', children: [text('x')] }]))).toBe(false);
  });
});
