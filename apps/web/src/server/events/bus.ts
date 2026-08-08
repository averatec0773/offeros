import { EventEmitter } from "node:events";

/**
 * In-process agent event bus: every application-event append is mirrored here
 * so live surfaces (the workspace page, the extension panel) can be PUSHED
 * fresh state instead of polling for it. The web app is a single local Node
 * process, so an EventEmitter is the whole pub/sub story — no broker, no
 * persistence (the durable record is the application_events table; this bus
 * only says "something changed, refetch").
 */

export interface AgentBusEvent {
  applicationId: string;
  kind: string;
  at: number;
}

type Listener = (event: AgentBusEvent) => void;

// Next dev hot-reload re-evaluates modules; pin the emitter on globalThis so
// live SSE subscriptions survive a reload of this module.
const globalScope = globalThis as { __offerosAgentBus?: EventEmitter };
const emitter = (globalScope.__offerosAgentBus ??= new EventEmitter());
// One listener per open SSE connection — well above any realistic tab count.
emitter.setMaxListeners(100);

export function emitAgentEvent(event: AgentBusEvent): void {
  emitter.emit("agent-event", event);
}

/** Subscribe to all agent events; returns the unsubscribe function. */
export function subscribeAgentEvents(listener: Listener): () => void {
  emitter.on("agent-event", listener);
  return () => {
    emitter.off("agent-event", listener);
  };
}
