export type CellResult =
  | { kind: 'element'; type: string; props: Record<string, unknown> }
  | { kind: 'value'; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'undefined' };

const REACT_ELEMENT = Symbol.for('react.element');

function isElement(v: unknown): v is { type: unknown; props: Record<string, unknown> } {
  return !!v && typeof v === 'object' && (v as { $$typeof?: unknown }).$$typeof === REACT_ELEMENT;
}

function serializeNode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(serializeNode);
  if (isElement(v)) return serializeCellOutput(v);
  if (v && typeof v === 'object') return v;
  return v;
}

/** Serialize a cell's evaluated output into a JSON-safe result. */
export function serializeCellOutput(value: unknown): CellResult {
  if (value instanceof Error) return { kind: 'error', message: value.message };
  if (isElement(value)) {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value.props)) {
      if (k === 'key' || k === 'ref' || v === undefined) continue;
      props[k] = serializeNode(v);
    }
    return { kind: 'element', type: String(value.type), props };
  }
  if (value === undefined) return { kind: 'undefined' };
  if (typeof value === 'object' && value !== null) {
    return { kind: 'value', text: JSON.stringify(value, null, 2) };
  }
  return { kind: 'value', text: String(value) };
}
