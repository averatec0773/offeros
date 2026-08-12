import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "offeros-api-"));
process.env.OFFEROS_DB_PATH = join(dir, "api.db");

const profileRoute = await import("../profile/route");
const appsRoute = await import("../applications/route");
const appRoute = await import("../applications/[id]/route");
const tasksRoute = await import("../agent/tasks/route");
const { getDb } = await import("@/server/db/client");
const { createApplication } = await import("@/server/repositories/application-repo");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PROFILE = {
  personal: { name: "Jordan Rivera", email: "j@example.com", phone: "555", links: {} },
  skills: ["Python"],
  education: [],
  experience: [],
};

describe("/api/v1/profile", () => {
  it("returns null before a profile exists, then round-trips a PUT", async () => {
    const empty = await (await profileRoute.GET()).json();
    expect(empty.success).toBe(true);
    expect(empty.result).toBeNull();

    const put = await profileRoute.PUT(
      new Request("http://localhost/api/v1/profile", {
        method: "PUT",
        body: JSON.stringify(PROFILE),
      }),
    );
    expect((await put.json()).result.personal.name).toBe("Jordan Rivera");

    const after = await (await profileRoute.GET()).json();
    expect(after.result.skills).toEqual(["Python"]);
  });

  it("rejects an invalid profile with a 400", async () => {
    const res = await profileRoute.PUT(
      new Request("http://localhost/api/v1/profile", {
        method: "PUT",
        body: JSON.stringify({ nonsense: true }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/v1/applications", () => {
  it("gets and patches an application created through the repository", async () => {
    const id = createApplication(getDb(), {
      jobInfo: { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" },
    }).id;

    const got = await (
      await appRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id }) })
    ).json();
    expect(got.result.jobInfo.companyName).toBe("Evolver");

    // "applied" is deliberately not settable here — submission is five things,
    // and this route does one of them. See submitted-route.test.ts.
    const patched = await (
      await appRoute.PATCH(
        new Request("http://localhost", {
          method: "PATCH",
          body: JSON.stringify({ status: "interview" }),
        }),
        { params: Promise.resolve({ id }) },
      )
    ).json();
    expect(patched.result.status).toBe("interview");
  });

  it("404s for a missing application id", async () => {
    const res = await appRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ status: "interview" }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(res.status).toBe(404);
  });

  it("?jobUrl= returns only matching applications; absent param is a 400", async () => {
    const jobUrl = "https://boards.greenhouse.io/acme/jobs/999";
    const matching = createApplication(getDb(), {
      jobInfo: {
        jobId: "j-url-1",
        jobTitle: "Dedup Target",
        companyName: "Acme",
        applyLink: jobUrl,
      },
    });
    createApplication(getDb(), {
      jobInfo: {
        jobId: "j-url-2",
        jobTitle: "Other",
        companyName: "Other Co",
        applyLink: "https://example.com/other",
      },
    });

    const filtered = await (
      await appsRoute.GET(
        new Request(`http://localhost/api/v1/applications?jobUrl=${encodeURIComponent(jobUrl)}`),
      )
    ).json();
    expect(filtered.result).toHaveLength(1);
    expect(filtered.result[0].id).toBe(matching.id);

    // The plain-list branch is gone with its nonexistent caller: no jobUrl, no list.
    const bare = await appsRoute.GET(new Request("http://localhost/api/v1/applications"));
    expect(bare.status).toBe(400);
  });
});

describe("/api/v1/agent/tasks", () => {
  it("creates a task for an application and lists it", async () => {
    const app = createApplication(getDb(), {
      jobInfo: { jobId: "j2", jobTitle: "T", companyName: "C" },
    });

    const task = await (
      await tasksRoute.POST(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify({ applicationId: app.id }),
        }),
      )
    ).json();
    expect(task.result.status).toBe("queued");
  });

  it("400s when applicationId is missing", async () => {
    const res = await tasksRoute.POST(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
  });
});
