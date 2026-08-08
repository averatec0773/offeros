import { subscribeAgentEvents } from "@/server/events/bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-sent events: the push channel behind live workspace/panel updates.
 * Emits one `data:` line per agent event (optionally filtered to one
 * application via ?applicationId=), plus an initial `ready` event and comment
 * heartbeats so proxies and clients can tell the stream is alive. Loopback
 * Host enforcement comes from the request guard like every other route; this
 * endpoint carries no payload beyond "something changed" (id + kind), so a
 * listener still has to fetch actual state through the normal API.
 */
export async function GET(request: Request) {
  const applicationId = new URL(request.url).searchParams.get("applicationId");
  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already torn down by the runtime
        }
      };
      send("event: ready\ndata: {}\n\n");
      unsubscribe = subscribeAgentEvents((event) => {
        if (applicationId && event.applicationId !== applicationId) return;
        send(`data: ${JSON.stringify(event)}\n\n`);
      });
      heartbeat = setInterval(() => send(": hb\n\n"), 25_000);
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
