import { z } from "zod";
import { getDb } from "@/server/db/client";
import {
  getStyleMemory,
  setStyleMemory,
  type StyleMemoryKind,
  type StyleMemoryRow,
  type StyleMemorySetting,
} from "@/server/repositories/style-memory-repo";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

const STYLE_MEMORY_KINDS: StyleMemoryKind[] = ["resume", "cover-letter"];

const putSchema = z.object({
  kind: z.enum(["resume", "cover-letter"]),
  notes: z.string().optional(),
  enabled: z.boolean().optional(),
});

/** A kind with no stored row yet reads as the same shape a real row has, so
 *  the client never special-cases "never saved" vs. "saved but empty". */
function rowOrDefault(row: StyleMemoryRow | null, kind: StyleMemoryKind): StyleMemorySetting {
  return row ?? { kind, notes: "", enabled: true, sourceCount: 0, updatedAt: null };
}

function listAll(): StyleMemorySetting[] {
  const db = getDb();
  return STYLE_MEMORY_KINDS.map((kind) => rowOrDefault(getStyleMemory(db, kind), kind));
}

export async function GET() {
  return handle(() => ok(listAll()));
}

export async function PUT(request: Request) {
  return handle(async () => {
    const body = putSchema.parse(await request.json());
    setStyleMemory(getDb(), body.kind, { notes: body.notes, enabled: body.enabled });
    return ok(listAll());
  });
}
