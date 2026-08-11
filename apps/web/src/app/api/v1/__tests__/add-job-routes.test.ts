import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "offeros-addjob-"));
process.env.OFFEROS_DB_PATH = join(dir, "addjob.db");

const applicationsRoute = await import("../applications/route");
const { getDb } = await import("@/server/db/client");
const { listApplications } = await import("@/server/repositories/application-repo");
const { listEvents } = await import("@/server/repositories/application-event-repo");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Adding a job is one paste. What these tests hold is that it stays honest:
 * a platform we can read fills itself in, a platform we cannot gets a minimal
 * record instead of a guess, and the same posting twice is one application.
 */

const GH_JOB = {
  title: "Machine Learning Engineer",
  company_name: "Acme Corp",
  location: { name: "Austin, TX" },
  content: "&lt;p&gt;We need Python.&lt;/p&gt;",
  questions: [
    { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
  ],
};

function post(url: unknown) {
  return applicationsRoute.POST(
    new Request("http://localhost/api/v1/applications", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          url: "",
          json: async () => GH_JOB,
          text: async () => JSON.stringify(GH_JOB),
        }) as unknown as Response,
    ),
  );
});

describe("POST /api/v1/applications", () => {
  it("fills the record from the platform when it can read the posting", async () => {
    const body = await (await post("https://boards.greenhouse.io/acme/jobs/4321")).json();
    expect(body.success).toBe(true);
    expect(body.result.duplicate).toBe(false);
    expect(body.result.application.jobInfo.jobTitle).toBe("Machine Learning Engineer");
    expect(body.result.application.jobInfo.companyName).toBe("Acme Corp");
    expect(body.result.application.jdText).toContain("We need Python.");
    // The check runs on arrival, so the requirements card has something to say.
    expect(body.result.recon.verdict).toBe("open");
    const events = listEvents(getDb(), body.result.application.id);
    expect(events.some((e) => e.kind === "job-checked")).toBe(true);
  });

  it("keeps a minimal record for a site it cannot read, rather than guessing", async () => {
    const body = await (
      await post("https://careers.example.com/jobs/senior-widget-wrangler")
    ).json();
    expect(body.result.application.jobInfo.jobTitle).toBe("Untitled role");
    // The host is a fact; a company name would be a guess.
    expect(body.result.application.jobInfo.companyName).toBe("careers.example.com");
    expect(body.result.application.jobInfo.applyLink).toBe(
      "https://careers.example.com/jobs/senior-widget-wrangler",
    );
  });

  it("returns the existing application, flagged, instead of a second copy", async () => {
    const url = "https://boards.greenhouse.io/acme/jobs/9999";
    const first = await (await post(url)).json();
    const before = listApplications(getDb()).length;
    const second = await (await post(url)).json();

    expect(second.result.duplicate).toBe(true);
    expect(second.result.application.id).toBe(first.result.application.id);
    expect(listApplications(getDb()).length).toBe(before);
  });

  it("refuses what is not a trackable link", async () => {
    expect((await post("")).status).toBe(400);
    expect((await post("not a url")).status).toBe(400);
    expect((await post("javascript:alert(1)")).status).toBe(400);
    expect((await post(42)).status).toBe(400);
  });
});
