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

/** Update top-level keys in raw YAML, preserving all other text. */
function patchRawYaml(raw: string, patch: Record<string, unknown>): string {
  const lines = raw.split('\n');
  for (const key of Object.keys(patch)) {
    // Top-level keys only: anchored at column 0, so a nested `  status:` is
    // never mistaken for the top-level key.
    const keyRe = new RegExp('^' + escapeRegExp(key) + '\\s*:');
    const idx = lines.findIndex((l) => keyRe.test(l));
    const replacement = renderKey(key, patch[key]);
    if (idx >= 0) {
      // Replace the key's whole existing value (scalar, block scalar, or an
      // indented/top-level sequence), not just its first line.
      lines.splice(idx, valueEnd(lines, idx) - idx, ...replacement);
    } else {
      lines.push(...replacement);
    }
  }
  return lines.join('\n');
}

/** Render a `key:` assignment, using an indented block for non-scalar values. */
function renderKey(key: string, value: unknown): string[] {
  const str = stringifyYaml(value).trimEnd();
  if (value !== null && typeof value === 'object') {
    const size = Array.isArray(value) ? value.length : Object.keys(value).length;
    if (size > 0) return [key + ':', ...str.split('\n').map((l) => '  ' + l)];
  }
  return [key + ': ' + str];
}

/**
 * Exclusive end index of the value beginning at key line `i`: a scalar ends on
 * the key line; a block scalar or an empty inline value consumes the following
 * indented lines (and a top-level `- ` sequence, which YAML permits at the
 * key's own indentation).
 */
function valueEnd(lines: string[], i: number): number {
  const colon = (lines[i] ?? '').indexOf(':');
  const inline = colon >= 0 ? (lines[i] ?? '').slice(colon + 1).trim() : '';
  if (inline !== '' && !/^[|>]/.test(inline)) return i + 1;
  let j = i + 1;
  while (j < lines.length) {
    const l = lines[j] ?? '';
    if (l.trim() === '') break;
    if (/^\s/.test(l) || /^-(\s|$)/.test(l)) j++;
    else break;
  }
  return j;
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