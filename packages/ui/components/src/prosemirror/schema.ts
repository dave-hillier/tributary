import { Schema } from 'prosemirror-model';
import { nodes as basicNodes, marks as basicMarks } from 'prosemirror-schema-basic';

/**
 * ProseMirror schema for in-place inline editing of a single Markdown block
 * (paragraph, heading, or table cell). The document holds exactly one block;
 * wiki links and transclusions are inline atom nodes so they round-trip
 * verbatim and are selectable as a unit while typing around them.
 */
export const proseMirrorSchema = new Schema({
  nodes: {
    ...basicNodes,
    doc: { content: 'block' },
    wikilink: {
      inline: true,
      group: 'inline',
      attrs: { target: { default: '' }, alias: { default: null } },
      toDOM: (node) => ['span', { class: 'pm-wikilink' }, node.attrs.alias ?? node.attrs.target],
    },
    transclusion: {
      inline: true,
      group: 'inline',
      attrs: { target: { default: '' }, heading: { default: null } },
      toDOM: (node) => ['span', { class: 'pm-transclusion' }, node.attrs.target],
    },
  },
  marks: {
    ...basicMarks,
    del: {
      parseDOM: [{ tag: 'del' }, { tag: 's' }, { tag: 'strike' }],
      toDOM: () => ['del', 0],
    },
  },
});
