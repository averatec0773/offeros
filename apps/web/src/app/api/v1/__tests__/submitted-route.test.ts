import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "offeros-submitted-"));
process.env.OFFEROS_DB_PATH = join(dir, "submitted.db");

const detailRoute = await import("../applications/[id]/route");
const submittedRoute = await import("../applications/[id]/submitted/route");
const { getDb } = await import("@/server/db/client");
const { createApplication, getApplication } =
  await import("@/server/repositories/application-repo");
const { listEvents } = await import("@/server/repositories/application-event-repo");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * The status dropdown used to be a side door around submission: it wrote
 * `applied` and nothing else, leaving the date null, the timeline silent and
 * the whole thing impossible to undo. The door is now shut at the route.
 */

function seed() {
  return createApplication(getDb(), {
    jobInfo: { jobId: "j1", jobTitle: "Engineer", companyName: "Acme" },
  }).id;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function patch(id: string, body: unknown) {
  return detailRoute.PATCH(
    new Request(`http://localhost/api/v1/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    ctx(id),
  );
}

describe("PATCH /applications/[id]", () => {
  it("refuses to set status to applied", async () => {
    const id = seed();
    const res = await patch(id, { status: "applied" });
    expect(res.status).toBe(400);
    expect(getApplication(getDb(), id)!.status).not.toBe("applied");
  });

  it("still accepts every other status", async () => {
    const id = seed();
    for (const status of ["saved", "applying", "interview", "offer", "rejected", "archived"]) {
      const res = await patch(id, { status });
      expect(res.status, status).toBe(200);
    }
  });

  it("still accepts the other fields it always did", async () => {
    const id = seed();
    const res = await patch(id, { notes: "called back" });
    expect(res.status).toBe(200);
    expect(getApplication(getDb(), id)!.notes).toBe("called back");
  });
});

describe("POST /applications/[id]/submitted", () => {
  it("does the whole thing: status, date, and a timeline entry that says where from", async () => {
    const id = seed();
    const res = await submittedRoute.POST(new Request("http://localhost"), ctx(id));
    expect(res.status).toBe(200);

    const app = getApplication(getDb(), id)!;
    expect(app.status).toBe("applied");
    expect(typeof app.appliedAt).toBe("number");
    const marked = listEvents(getDb(), id).find((e) => e.kind === "marked-submitted");
    expect(marked).toBeTruthy();
    expect((marked!.payload as { source?: string }).source).toBe("web-status");
  });

  it("can be taken back", async () => {
    const id = seed();
    await submittedRoute.POST(new Request("http://localhost"), ctx(id));
    const res = await submittedRoute.DELETE(new Request("http://localhost"), ctx(id));
    expect(res.status).toBe(200);

    const app = getApplication(getDb(), id)!;
    expect(app.status).not.toBe("applied");
    expect(app.appliedAt ?? null).toBeNull();
    expect(listEvents(getDb(), id).some((e) => e.kind === "submission-undone")).toBe(true);
  });

  it("404s for an application that does not exist", async () => {
    const res = await submittedRoute.POST(new Request("http://localhost"), ctx("nope"));
    expect(res.status).toBe(404);
  });
});
