/**
 * Keyed debouncer: `schedule(key, fn)` runs `fn` after `delayMs` of silence for that key.
 * `flush(key)` runs a pending call immediately; `cancel(key)` drops it.
 */
export interface Debouncer {
  schedule: (key: string, fn: () => void) => void;
  flush: (key: string) => void;
  flushAll: () => void;
  cancel: (key: string) => void;
  pending: (key: string) => boolean;
}

export function createDebouncer(delayMs: number): Debouncer {
  const timers = new Map<string, { timer: ReturnType<typeof setTimeout>; fn: () => void }>();

  const run = (key: string) => {
    const entry = timers.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    timers.delete(key);
    entry.fn();
  };

  return {
    schedule(key, fn) {
      const existing = timers.get(key);
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(() => {
        run(key);
      }, delayMs);
      timers.set(key, { timer, fn });
    },
    flush: run,
    flushAll() {
      for (const key of Array.from(timers.keys())) run(key);
    },
    cancel(key) {
      const existing = timers.get(key);
      if (!existing) return;
      clearTimeout(existing.timer);
      timers.delete(key);
    },
    pending(key) {
      return timers.has(key);
    },
  };
}
