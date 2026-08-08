import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { GET } from "../route";

const emitter = () => (globalThis as { __offerosAgentBus?: EventEmitter }).__offerosAgentBus!;

describe("SSE stream teardown", () => {
  it("does not leak a bus listener when the client is already gone", async () => {
    // Force the bus module to initialize.
    const { subscribeAgentEvents } = await import("@/server/events/bus");
    subscribeAgentEvents(() => {})();
    const before = emitter().listenerCount("agent-event");

    // A client that disconnected before/while the handler ran: the request's
    // signal is already aborted, so the "abort" event will never fire again.
    const controller = new AbortController();
    controller.abort();
    const res = await GET(
      new Request("http://127.0.0.1:3000/api/v1/agent/events", { signal: controller.signal }),
    );
    // Touch the body so the stream actually starts.
    void res.body;
    await new Promise((r) => setTimeout(r, 20));

    expect(emitter().listenerCount("agent-event")).toBe(before);
  });

  it("does not leak listeners across repeated aborted connections", async () => {
    const before = emitter().listenerCount("agent-event");
    for (let i = 0; i < 20; i += 1) {
      const c = new AbortController();
      c.abort();
      const res = await GET(
        new Request("http://127.0.0.1:3000/api/v1/agent/events", { signal: c.signal }),
      );
      void res.body;
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(emitter().listenerCount("agent-event")).toBe(before);
  });
});
