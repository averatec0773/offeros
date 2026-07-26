import { z } from "zod";
import { getDb } from "@/server/db/client";
import { listResumes, uploadResume } from "@/server/services/resume-service";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

const uploadSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string(),
  dataBase64: z.string().min(1),
  isPrimary: z.boolean().optional(),
  text: z.string().optional(),
});

export async function GET() {
  return handle(() => ok(listResumes(getDb())));
}

export async function POST(request: Request) {
  return handle(async () => {
    const input = uploadSchema.parse(await request.json());
    return ok(uploadResume(getDb(), input));
  });
}
