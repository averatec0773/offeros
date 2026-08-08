import { pauseQueue } from "@/server/services/queue-service";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

/** Pause the run loop after the in-flight item finishes. */
export async function POST() {
  return handle(async () => ok(pauseQueue()));
}
