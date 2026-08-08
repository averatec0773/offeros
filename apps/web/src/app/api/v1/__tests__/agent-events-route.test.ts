import { describe, expect, it } from "vitest";
import { GET } from "../agent/events/route";
import { emitAgentEvent } from "@/server/events/bus";

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
  timeoutMs = 2000,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (predicate(text)) return text;
  }
  return text;
}

describe("GET /api/v1/agent/events (SSE)", () => {
  it("streams a ready frame, then pushes emitted events as data lines", async () => {
    const abort = new AbortController();
    const res = await GET(
      new Request("http://localhost:3000/api/v1/agent/events", { signal: abort.signal }),
    );
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const reader = res.body!.getReader();

    let text = await readUntil(reader, (t) => t.includes("event: ready"));
    expect(text).toContain("event: ready");

    emitAgentEvent({ applicationId: "a1", kind: "fill-reported", at: 42 });
    text = await readUntil(reader, (t) => t.includes("fill-reported"));
    expect(text).toContain('"applicationId":"a1"');
    expect(text).toContain('"kind":"fill-reported"');
    abort.abort();
  });

  it("filters to one application when ?applicationId= is given", async () => {
    const abort = new AbortController();
    const res = await GET(
      new Request("http://localhost:3000/api/v1/agent/events?applicationId=mine", {
        signal: abort.signal,
      }),
    );
    const reader = res.body!.getReader();
    await readUntil(reader, (t) => t.includes("event: ready"));

    emitAgentEvent({ applicationId: "other", kind: "noise", at: 1 });
    emitAgentEvent({ applicationId: "mine", kind: "signal", at: 2 });
    const text = await readUntil(reader, (t) => t.includes("signal"));
    expect(text).toContain("signal");
    expect(text).not.toContain("noise");
    abort.abort();
  });
});
