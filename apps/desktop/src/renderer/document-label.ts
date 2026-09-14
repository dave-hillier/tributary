import type { Document } from '@tributary/api';
import { documentType } from '@tributary/ontology';

/** Short label for a document in the sidebar: work-item status, type, or note. */
export function kindLabel(doc: Document): string {
  const type = documentType(doc.frontmatter);
  if (type === 'work-item') return doc.frontmatter.status ?? 'work-item';
  return type ?? 'note';
}
