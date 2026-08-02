import { describe, it, expect } from "vitest";
import { applicationEventSchema } from "../application-event";

describe("applicationEventSchema", () => {
  it("round-trips a full event with a payload", () => {
    const parsed = applicationEventSchema.parse({
      id: "e1",
      applicationId: "app-1",
      kind: "step-completed",
      at: 1000,
      payload: { step: "tailor-resume" },
    });
    expect(parsed.kind).toBe("step-completed");
    expect(parsed.payload).toEqual({ step: "tailor-resume" });
  });

  it("parses an event with no payload (payload stays undefined)", () => {
    const parsed = applicationEventSchema.parse({
      id: "e2",
      applicationId: "app-1",
      kind: "task-started",
      at: 1000,
    });
    expect(parsed.payload).toBeUndefined();
  });

  it("tolerates any kind string — new kinds don't require a schema change", () => {
    const parsed = applicationEventSchema.parse({
      id: "e3",
      applicationId: "app-1",
      kind: "some-future-kind-nobody-has-invented-yet",
      at: 1000,
      payload: { anything: "goes", nested: { a: 1 } },
    });
    expect(parsed.kind).toBe("some-future-kind-nobody-has-invented-yet");
    expect(parsed.payload).toEqual({ anything: "goes", nested: { a: 1 } });
  });

  it("rejects a missing required field", () => {
    const bad = applicationEventSchema.safeParse({
      id: "e4",
      kind: "task-started",
      at: 1000,
    });
    expect(bad.success).toBe(false);
  });
});
