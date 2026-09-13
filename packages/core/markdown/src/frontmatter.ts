import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { DocumentFrontmatter } from '@tributary/api';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/;

export interface FrontmatterSplit {
  frontmatter: DocumentFrontmatter;
  /** Text after the frontmatter block, verbatim (leading blank line included). */
  body: string;
  /** Raw YAML text between the `---` delimiters (verbatim), or `null` if absent. */
  raw: string | null;
}

/** Split a leading YAML frontmatter block from the document body. */
export function parseFrontmatter(source: string): FrontmatterSplit {
  const m = FRONTMATTER_RE.exec(source);
  if (!m) return { frontmatter: {}, body: source, raw: null };

  const raw = m[1] ?? '';
  let frontmatter: DocumentFrontmatter = {};
  if (raw.trim() !== '') {
    const parsed = parseYaml(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as DocumentFrontmatter;
    }
  }
  return { frontmatter, body: source.slice(m[0].length), raw };
}

/** Serialize a frontmatter object into a YAML block (without delimiters). */
export function stringifyFrontmatter(frontmatter: DocumentFrontmatter): string {
  return stringifyYaml(frontmatter);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Update top-level scalar keys in raw YAML, preserving all other text. */
function patchRawYaml(raw: string, patch: Record<string, unknown>): string {
  const lines = raw.split('\n');
  const matched = new Set<string>();
  for (const key of Object.keys(patch)) {
    const keyRe = new RegExp('^\\s*' + escapeRegExp(key) + '\\s*:');
    const idx = lines.findIndex((l) => keyRe.test(l));
    const value = stringifyYaml(patch[key]).trimEnd();
    if (idx >= 0) {
      const line = lines[idx] ?? '';
      const indent = line.match(/^\s*/)?.[0] ?? '';
      lines[idx] = indent + key + ': ' + value;
      matched.add(key);
    }
  }
  for (const key of Object.keys(patch)) {
    if (!matched.has(key)) {
      lines.push(key + ': ' + stringifyYaml(patch[key]).trimEnd());
    }
  }
  return lines.join('\n');
}

/**
 * Surgically update frontmatter keys, preserving all other raw YAML text
 * (comments, anchors, ordering, formatting) and the body byte-for-byte. Creates
 * a frontmatter block when the source has none.
 */
export function updateFrontmatter(source: string, patch: Record<string, unknown>): string {
  const { body, raw } = parseFrontmatter(source);
  if (raw === null) {
    return '---\n' + stringifyYaml(patch).trimEnd() + '\n---\n\n' + body;
  }
  return '---\n' + patchRawYaml(raw, patch) + '\n---\n' + body;
}