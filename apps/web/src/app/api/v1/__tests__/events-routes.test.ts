import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "offeros-events-api-"));
process.env.OFFEROS_DB_PATH = join(dir, "events.db");

const eventsRoute = await import("../applications/[id]/events/route");
const { getDb } = await import("@/server/db/client");
const { createApplication } = await import("@/server/repositories/application-repo");
const { appendEvent } = await import("@/server/repositories/application-event-repo");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

function seedApplication(): string {
  const app = createApplication(getDb(), {
    jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
    jdText: "We are hiring an ML Engineer.",
  });
  return app.id;
}

describe("/api/v1/applications/[id]/events", () => {
  it("GET returns the application's events, oldest first", async () => {
    const appId = seedApplication();
    appendEvent(getDb(), { applicationId: appId, kind: "task-started" });
    appendEvent(getDb(), { applicationId: appId, kind: "marked-submitted" });

    const res = await eventsRoute.GET(new Request("http://localhost"), idCtx(appId));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.result).toHaveLength(2);
    expect(body.result[0].kind).toBe("task-started");
    expect(body.result[1].kind).toBe("marked-submitted");
  });

  it("GET returns an empty list for an application with no events", async () => {
    const appId = seedApplication();
    const res = await eventsRoute.GET(new Request("http://localhost"), idCtx(appId));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result).toEqual([]);
  });

  it("GET on an unknown application returns notFound", async () => {
    const res = await eventsRoute.GET(new Request("http://localhost"), idCtx("missing"));
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
  });
});
