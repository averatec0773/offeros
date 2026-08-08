/**
 * Browser-side subscription to the agent event stream (SSE). The stream only
 * says "something changed on application X" — callers refetch real state
 * through the normal API. EventSource reconnects on its own after drops.
 */

export interface AgentEvent {
  applicationId: string;
  kind: string;
  at: number;
}

export function subscribeToAgentEvents(
  applicationId: string | null,
  onEvent: (event: AgentEvent) => void,
): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return () => {};
  }
  const url = applicationId
    ? `/api/v1/agent/events?applicationId=${encodeURIComponent(applicationId)}`
    : "/api/v1/agent/events";
  const source = new EventSource(url);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data as string) as AgentEvent);
    } catch {
      // malformed frame — skip, the next event will land
    }
  };
  return () => source.close();
}
