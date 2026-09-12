import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { DocumentFrontmatter } from '@tributary/api';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface FrontmatterSplit {
  frontmatter: DocumentFrontmatter;
  body: string;
}

/** Split a leading YAML frontmatter block from the document body. */
export function parseFrontmatter(source: string): FrontmatterSplit {
  const m = FRONTMATTER_RE.exec(source);
  if (!m) return { frontmatter: {}, body: source };

  let frontmatter: DocumentFrontmatter = {};
  const yamlText = m[1] ?? '';
  if (yamlText.trim() !== '') {
    const parsed = parseYaml(yamlText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as DocumentFrontmatter;
    }
  }
  return { frontmatter, body: source.slice(m[0].length) };
}

/** Serialize a frontmatter object back into a YAML block (without delimiters). */
export function stringifyFrontmatter(frontmatter: DocumentFrontmatter): string {
  return stringifyYaml(frontmatter);
}