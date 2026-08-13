import { getDb } from "@/server/db/client";
import { answerGaps } from "@/server/services/question-coverage-service";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

/**
 * The questions your applications keep asking that you have no answer for.
 *
 * Deterministic and local: it reads the coverage read model, which reads your
 * own fill history and the platform descriptions already stored. No model call,
 * no network, nothing to spend.
 */
export async function GET() {
  return handle(() => ok(answerGaps(getDb())));
}
