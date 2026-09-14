import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAutosave } from '../src/renderer/autosave.js';

describe('createAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves the value that triggered the debounce, not the render state (finding 1)', () => {
    const save = vi.fn();
    const autosave = createAutosave(save, 1000);
    autosave.schedule('first');
    vi.advanceTimersByTime(500);
    autosave.schedule('second');
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('second');
  });

  it('drops a pending save on cancel (finding 11)', () => {
    const save = vi.fn();
    const autosave = createAutosave(save, 1000);
    autosave.schedule('unsaved');
    autosave.cancel();
    vi.advanceTimersByTime(5000);
    expect(save).not.toHaveBeenCalled();
  });
});
