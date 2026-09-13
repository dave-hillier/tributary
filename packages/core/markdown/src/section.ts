import type { Document, Node, Parent, Text } from '@tributary/api';
import type { Heading } from '@tributary/api';

// ---------------------------------------------------------------------------
// AST section utilities for transclusion (Stage 2): resolve a `target#heading`
// reference to the slice of root children that a heading section denotes.
// Pure AST logic, no I/O — lives in the parser package so renderers and
// shells can use it without pulling in the (native) index package.
// ---------------------------------------------------------------------------

/** Flatten the visible text of phrasing content (heading labels etc.). */
export function headingText(node: Node): string {
  let out = '';
  const walk = (n: Node): void => {
    if (n.type === 'text') out += (n as Text).value;
    if ('children' in n) for (const c of (n as Parent).children) walk(c);
  };
  walk(node);
  return out;
}

/**
 * Find a heading section by its (case-insensitive) text label.
 * Returns the root children `[heading, ...following nodes]` up to (not
 * including) the next heading of the same or higher level.
 */
export function findSection(doc: Document, heading: string): Node[] | undefined {
  const want = heading.trim().toLowerCase();
  const children = doc.root.children;
  for (let i = 0; i < children.length; i++) {
    const n = children[i]!;
    if (n.type !== 'heading') continue;
    if (headingText(n).trim().toLowerCase() !== want) continue;
    const depth = (n as Heading).depth ?? 1;
    const slice: Node[] = [n];
    for (let j = i + 1; j < children.length; j++) {
      const s = children[j]!;
      if (s.type === 'heading' && ((s as Heading).depth ?? 1) <= depth) break;
      slice.push(s);
    }
    return slice;
  }
  return undefined;
}