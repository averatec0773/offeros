import { describe, expect, it, vi } from "vitest";
import { emitAgentEvent, subscribeAgentEvents } from "../bus";

describe("agent event bus", () => {
  it("delivers emitted events to subscribers and stops after unsubscribe", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeAgentEvents((e) => seen.push(e.kind));
    emitAgentEvent({ applicationId: "a1", kind: "task-started", at: 1 });
    expect(seen).toEqual(["task-started"]);
    unsubscribe();
    emitAgentEvent({ applicationId: "a1", kind: "after-unsub", at: 2 });
    expect(seen).toEqual(["task-started"]);
  });

  it("fans out to multiple independent subscribers", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unA = subscribeAgentEvents(a);
    const unB = subscribeAgentEvents(b);
    emitAgentEvent({ applicationId: "a1", kind: "x", at: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unA();
    unB();
  });
});
