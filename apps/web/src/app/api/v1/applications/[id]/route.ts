import { z } from "zod";
import { APPLICATION_STATUSES, ATTACH_RESUME_OPTIONS } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { getApplication, updateApplication } from "@/server/repositories/application-repo";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Statuses this route may set. "applied" is refused on purpose.
 *
 * Submission is five things — close the tickets, set the date, finish the task,
 * leave a timeline entry, and leave enough behind to undo it — and a plain
 * status write did exactly one of them. An application marked through here read
 * as applied while its ticket stayed open, its date stayed null, its timeline
 * stayed silent, and there was no way back, because undo restores from the
 * event this path never wrote. `POST /applications/[id]/submitted` does the
 * whole thing; this refuses the shortcut rather than half-doing it.
 *
 * Mirrors the same refusal the agent's `update_application` tool already makes.
 */
const SETTABLE_STATUSES = [
  "saved",
  "applying",
  "interview",
  "offer",
  "rejected",
  "archived",
] as const satisfies readonly (typeof APPLICATION_STATUSES)[number][];

const patchSchema = z.object({
  status: z.enum(SETTABLE_STATUSES).optional(),
  notes: z.string().optional(),
  jdText: z.string().optional(),
  jdSource: z.string().optional(),
  resumeId: z.string().optional(),
  attachResume: z.enum(ATTACH_RESUME_OPTIONS).optional(),
  appliedAt: z.number().optional(),
});

export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const found = getApplication(getDb(), id);
    return found ? ok(found) : notFound("application");
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = patchSchema.parse(await request.json());
    const updated = updateApplication(getDb(), id, patch);
    return updated ? ok(updated) : notFound("application");
  });
}
