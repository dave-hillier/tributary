export const answer = 42;

export function add(x: number, y: number): number {
  return x + y;
}

/** A fake "component": any function a cell imports and renders via JSX. */
export function Strong(props: { n: number }): { __tributary: 'strong'; n: number } {
  return { __tributary: 'strong', n: props.n };
}

export default function identity<T>(x: T): T {
  return x;
}
