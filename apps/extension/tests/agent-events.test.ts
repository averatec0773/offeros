import { describe, expect, it, vi } from "vitest";
import { subscribeAgentEvents } from "../src/lib/agent-events";

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

const waitFor = async (cond: () => boolean, ms = 1500) => {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
};

describe("subscribeAgentEvents (fetch SSE reader)", () => {
  it("parses data frames into events and ignores ready/comment/malformed frames", async () => {
    const events: string[] = [];
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        "event: ready\ndata: {}\n\n",
        ": hb\n\n",
        'data: {"applicationId":"a1","kind":"fill-reported","at":1}\n\n',
        "data: not json\n\n",
        'data: {"applicationId":"a1","kind":"task-started","at":2}\n\n',
      ]),
    );
    const stop = subscribeAgentEvents(
      "http://localhost:3000",
      (e) => events.push(e.kind),
      fetchImpl as unknown as typeof fetch,
      50,
    );
    await waitFor(() => events.length >= 2);
    stop();
    expect(events).toEqual(["fill-reported", "task-started"]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/agent/events",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("handles events split across chunks", async () => {
    const events: string[] = [];
    const frame = 'data: {"applicationId":"a1","kind":"split-frame","at":3}\n\n';
    const fetchImpl = vi.fn(async () => sseResponse([frame.slice(0, 20), frame.slice(20)]));
    const stop = subscribeAgentEvents(
      "http://localhost:3000",
      (e) => events.push(e.kind),
      fetchImpl as unknown as typeof fetch,
      50,
    );
    await waitFor(() => events.length >= 1);
    stop();
    expect(events).toEqual(["split-frame"]);
  });

  it("reconnects after the stream ends until unsubscribed", async () => {
    const fetchImpl = vi.fn(async () => sseResponse(["event: ready\ndata: {}\n\n"]));
    const stop = subscribeAgentEvents(
      "http://localhost:3000",
      () => {},
      fetchImpl as unknown as typeof fetch,
      20,
    );
    await waitFor(() => fetchImpl.mock.calls.length >= 2);
    stop();
    const callsAtStop = fetchImpl.mock.calls.length;
    expect(callsAtStop).toBeGreaterThanOrEqual(2);
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchImpl.mock.calls.length).toBe(callsAtStop);
  });
});
