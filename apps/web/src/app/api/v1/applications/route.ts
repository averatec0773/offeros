import { z } from "zod";
import { jobInfoSchema, APPLICATION_STATUSES } from "@offeros/core";
import { getDb } from "@/server/db/client";
import {
  listApplications,
  listApplicationsByJobUrl,
  createApplication,
} from "@/server/repositories/application-repo";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

const createSchema = z.object({
  jobInfo: jobInfoSchema,
  status: z.enum(APPLICATION_STATUSES).optional(),
  jdText: z.string().optional(),
});

export async function GET(request: Request) {
  return handle(() => {
    const jobUrl = new URL(request.url).searchParams.get("jobUrl");
    return ok(jobUrl ? listApplicationsByJobUrl(getDb(), jobUrl) : listApplications(getDb()));
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const input = createSchema.parse(await request.json());
    return ok(createApplication(getDb(), input));
  });
}
