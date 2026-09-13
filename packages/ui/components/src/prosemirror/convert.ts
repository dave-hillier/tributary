import type { Node as PMNode, Mark } from 'prosemirror-model';
import { MarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown';
import type { Node as MdastNode, Parent } from '@tributary/api';
import { proseMirrorSchema } from './schema.js';

/** Inline node types the editor can round-trip faithfully. */
const SUPPORTED_INLINE = new Set([
  'text', 'strong', 'emphasis', 'delete', 'inlineCode', 'link', 'image',
  'wikiLink', 'transclusion', 'break',
]);

/** Children of an editable block, flattened to inline content. */
function inlineChildren(node: MdastNode): MdastNode[] {
  if (node.type === 'tableCell') {
    const out: MdastNode[] = [];
    for (const c of (node as Parent).children ?? []) {
      if ('children' in c) out.push(...(c as Parent).children);
      else out.push(c);
    }
    return out;
  }
  return (node as Parent).children ?? [];
}

/** True when every inline node in the block is supported by the editor. */
export function supportsInlineEditing(node: MdastNode): boolean {
  const walk = (n: MdastNode): boolean => {
    if (!SUPPORTED_INLINE.has(n.type)) return false;
    if ('children' in n) {
      for (const c of (n as Parent).children) if (!walk(c)) return false;
    }
    return true;
  };
  return inlineChildren(node).every(walk);
}

const valueOf = (n: MdastNode): string => {
  const v = (n as unknown as { value?: unknown }).value;
  return typeof v === 'string' ? v : '';
};

/** Convert mdast phrasing content into ProseMirror inline nodes. */
function inlineToPM(children: MdastNode[], marks: Mark[]): PMNode[] {
  const out: PMNode[] = [];
  for (const child of children) {
    switch (child.type) {
      case 'text':
        out.push(proseMirrorSchema.text(valueOf(child), marks));
        break;
      case 'strong':
        out.push(...inlineToPM((child as Parent).children, marks.concat(proseMirrorSchema.marks.strong.create())));
        break;
      case 'emphasis':
        out.push(...inlineToPM((child as Parent).children, marks.concat(proseMirrorSchema.marks.em.create())));
        break;
      case 'delete':
        out.push(...inlineToPM((child as Parent).children, marks.concat(proseMirrorSchema.marks.del.create())));
        break;
      case 'inlineCode':
        out.push(proseMirrorSchema.text(valueOf(child), marks.concat(proseMirrorSchema.marks.code.create())));
        break;
      case 'link': {
        const href = (child as { url?: string }).url ?? '';
        out.push(...inlineToPM((child as Parent).children, marks.concat(proseMirrorSchema.marks.link.create({ href }))));
        break;
      }
      case 'image': {
        const img = child as { url?: string; alt?: string | null; title?: string | null } & Parent;
        out.push(proseMirrorSchema.nodes.image.create({ src: img.url ?? '', alt: img.alt ?? null, title: img.title ?? null }));
        break;
      }
      case 'wikiLink': {
        const wl = child as { target?: string; alias?: string | null } & Parent;
        out.push(proseMirrorSchema.nodes.wikilink.create({ target: wl.target ?? '', alias: wl.alias ?? null }));
        break;
      }
      case 'transclusion': {
        const tr = child as { target?: string; heading?: string | null } & Parent;
        out.push(proseMirrorSchema.nodes.transclusion.create({ target: tr.target ?? '', heading: tr.heading ?? null }));
        break;
      }
      case 'break':
        out.push(proseMirrorSchema.nodes.hard_break.create());
        break;
      default:
        break;
    }
  }
  return out;
}

/** Convert a single editable Markdown block into a ProseMirror document. */
export function blockToProseMirror(node: MdastNode): PMNode {
  const inline = inlineToPM(inlineChildren(node), []);
  const headingLevel = node.type === 'heading' ? (node as { depth?: number }).depth ?? 1 : null;
  const block = headingLevel !== null
    ? proseMirrorSchema.nodes.heading.create({ level: headingLevel }, inline)
    : proseMirrorSchema.nodes.paragraph.create(null, inline);
  return proseMirrorSchema.nodes.doc.create(null, block);
}

/** Serializer: default Markdown handlers plus the dialect nodes and strikethrough. */
const serializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    wikilink(state, node) {
      const alias = node.attrs.alias;
      state.write('[[' + node.attrs.target + (alias ? '|' + alias : '') + ']]');
    },
    transclusion(state, node) {
      const heading = node.attrs.heading;
      state.write('![[' + node.attrs.target + (heading ? '#' + heading : '') + ']]');
    },
  },
  {
    ...defaultMarkdownSerializer.marks,
    del: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  },
);

/** Serialize a ProseMirror block document back to a Markdown string. */
export function serializeBlock(doc: PMNode): string {
  return serializer.serialize(doc).replace(/[ \t\r\n]+$/, '');
}
