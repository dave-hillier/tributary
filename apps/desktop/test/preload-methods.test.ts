import { describe, it, expect } from 'vitest';

describe('preload methods', () => {
  it('matches the live preload surface and omits removed methods (finding 14)', async () => {
    const { PRELOAD_METHODS } = (await import('../e2e/preload-methods.mjs')) as { PRELOAD_METHODS: string[] };
    expect(PRELOAD_METHODS).toContain('compileDocument');
    expect(PRELOAD_METHODS).toContain('updateCell');
    expect(PRELOAD_METHODS).toContain('runWeeklyReport');
    expect(PRELOAD_METHODS).toContain('listJobBranches');
    expect(PRELOAD_METHODS).toContain('mergeJobBranch');
    expect(PRELOAD_METHODS).not.toContain('evaluateDocument');
  });
});
