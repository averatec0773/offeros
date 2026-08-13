import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "../src/lib/with-timeout";

/**
 * The rule this exists to keep: a wait on something outside the panel always
 * ends. A permission prompt that never opens never rejects either, and the
 * button behind it said "Starting…" until the panel was closed.
 */
describe("withTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("passes a prompt answer straight through", async () => {
    const res = await withTimeout(Promise.resolve("answered"), 1000, () => "gave up");
    expect(res).toBe("answered");
  });

  it("gives up on a promise that never settles", async () => {
    const pending = withTimeout(new Promise<string>(() => {}), 1000, () => "gave up");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe("gave up");
  });

  it("treats a rejection as an ending, not as an escape", async () => {
    // A throwing wait must not become an unhandled rejection in the caller's
    // finally block — the caller wants a value it can show.
    const res = await withTimeout(Promise.reject(new Error("nope")), 1000, () => "gave up");
    expect(res).toBe("gave up");
  });

  it("does not fire after the work has already answered", async () => {
    const onTimeout = vi.fn(() => "gave up");
    const res = await withTimeout(Promise.resolve("answered"), 1000, onTimeout);
    await vi.advanceTimersByTimeAsync(5000);
    expect(res).toBe("answered");
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("does not leave its timer running once the work answers", async () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    await withTimeout(Promise.resolve(1), 1000, () => 0);
    expect(clear).toHaveBeenCalled();
  });
});
