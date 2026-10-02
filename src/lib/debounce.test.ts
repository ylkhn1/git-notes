import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebouncer } from "./debounce";

describe("createDebouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces calls per key and keeps the latest fn", () => {
    const d = createDebouncer(100);
    const a = vi.fn();
    const b = vi.fn();
    d.schedule("x", a);
    vi.advanceTimersByTime(50);
    d.schedule("x", b);
    vi.advanceTimersByTime(99);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(d.pending("x")).toBe(false);
  });

  it("flushes and cancels", () => {
    const d = createDebouncer(100);
    const x = vi.fn();
    const y = vi.fn();
    d.schedule("x", x);
    d.schedule("y", y);
    d.flush("x");
    expect(x).toHaveBeenCalledTimes(1);
    d.cancel("y");
    vi.advanceTimersByTime(200);
    expect(y).not.toHaveBeenCalled();
    d.schedule("z", y);
    d.flushAll();
    expect(y).toHaveBeenCalledTimes(1);
  });
});
