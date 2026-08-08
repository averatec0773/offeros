/**
 * Fetch-based SSE reader for the web app's agent event stream. fetch (not
 * EventSource) because extension host_permissions exempt fetch from CORS
 * unambiguously. Reconnects with a fixed delay until unsubscribed; a broken
 * web app just means silence, never a crash.
 */

export interface AgentEvent {
  applicationId: string;
  kind: string;
  at: number;
}

export function subscribeAgentEvents(
  apiBase: string,
  onEvent: (event: AgentEvent) => void,
  fetchImpl: typeof fetch = fetch,
  reconnectDelayMs = 3000,
): () => void {
  const controller = new AbortController();

  const parse = (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const parsed = JSON.parse(line.slice(6)) as Partial<AgentEvent>;
        if (typeof parsed.applicationId === "string" && typeof parsed.kind === "string") {
          onEvent(parsed as AgentEvent);
        }
      } catch {
        // ready frame / malformed line — not an event
      }
    }
  };

  void (async () => {
    while (!controller.signal.aborted) {
      try {
        const res = await fetchImpl(`${apiBase}/api/v1/agent/events`, {
          signal: controller.signal,
        });
        const reader = res.body?.getReader();
        if (!reader) throw new Error("no stream body");
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            parse(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
          }
        }
      } catch {
        // network drop / server restart — fall through to the retry delay
      }
      if (!controller.signal.aborted) {
        await new Promise((r) => setTimeout(r, reconnectDelayMs));
      }
    }
  })();

  return () => controller.abort();
}
