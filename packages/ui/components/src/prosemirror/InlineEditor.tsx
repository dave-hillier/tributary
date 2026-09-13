import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { createElement } from 'react';
import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { inputRules, InputRule } from 'prosemirror-inputrules';
import { history } from 'prosemirror-history';
import type { MarkType } from 'prosemirror-model';
import type { Node as MdastNode } from '@tributary/api';
import { proseMirrorSchema } from './schema.js';
import { blockToProseMirror, serializeBlock } from './convert.js';

/** Wrap trailing Markdown punctuation as a mark, Linear-style (e.g. **bold**). */
function markInputRule(regexp: RegExp, markType: MarkType) {
  return new InputRule(regexp, (state, match, start, end) => {
    const tr = state.tr;
    if (match[1]) {
      const textStart = start + match[0].indexOf(match[1]);
      const textEnd = textStart + match[1].length;
      if (textEnd < end) tr.delete(textEnd, end);
      if (textStart > start) tr.delete(start, textStart);
      end = start + match[1].length;
    }
    return tr.addMark(start, end, markType.create());
  });
}

interface InlineEditorProps {
  node: MdastNode;
  onCommit: (markdown: string) => void;
  onCancel: () => void;
}

/**
 * A ProseMirror editor for a single Markdown block's inline content. Mounts an
 * EditorView on mount, commits the serialized Markdown on Enter / Cmd+Enter /
 * blur, and cancels on Escape. Shift+Enter inserts a line break.
 */
export function InlineEditor(props: InlineEditorProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const doneRef = useRef(false);
  const commitRef = useRef(props.onCommit);
  const cancelRef = useRef(props.onCancel);
  commitRef.current = props.onCommit;
  cancelRef.current = props.onCancel;

  useEffect(() => {
    doneRef.current = false;

    const commit = (): void => {
      if (doneRef.current) return;
      doneRef.current = true;
      commitRef.current(viewRef.current ? serializeBlock(viewRef.current.state.doc) : '');
    };
    const cancel = (): void => {
      if (doneRef.current) return;
      doneRef.current = true;
      cancelRef.current();
    };

    const state = EditorState.create({
      doc: blockToProseMirror(props.node),
      plugins: [
        history(),
        keymap({
          Enter: () => { commit(); return true; },
          'Shift-Enter': (_state, dispatch) => {
            if (dispatch) dispatch(_state.tr.replaceSelectionWith(proseMirrorSchema.nodes.hard_break.create()).scrollIntoView());
            return true;
          },
          'Mod-Enter': () => { commit(); return true; },
          Escape: () => { cancel(); return true; },
        }),
        inputRules({
          rules: [
            markInputRule(/[*][*]([^*]+)[*][*]$/, proseMirrorSchema.marks.strong),
            markInputRule(/`([^`]+)`$/, proseMirrorSchema.marks.code),
            markInputRule(/~~([^~]+)~~$/, proseMirrorSchema.marks.del),
          ],
        }),
      ],
    });

    const view = new EditorView(hostRef.current!, { state });
    viewRef.current = view;
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [props.node]);

  return createElement('div', {
    className: 'pm-inline-editor',
    ref: hostRef,
    onBlur: () => {
      if (doneRef.current) return;
      doneRef.current = true;
      commitRef.current(viewRef.current ? serializeBlock(viewRef.current.state.doc) : '');
    },
  });
}
