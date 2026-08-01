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
  it("creates, lists, gets and patches an application", async () => {
    const created = await (
      await appsRoute.POST(
        new Request("http://localhost/api/v1/applications", {
          method: "POST",
          body: JSON.stringify({
            jobInfo: { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" },
          }),
        }),
      )
    ).json();
    expect(created.success).toBe(true);
    const id: string = created.result.id;

    const list = await (
      await appsRoute.GET(new Request("http://localhost/api/v1/applications"))
    ).json();
    expect(list.result.length).toBeGreaterThan(0);

    const got = await (
      await appRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id }) })
    ).json();
    expect(got.result.jobInfo.companyName).toBe("Evolver");

    const patched = await (
      await appRoute.PATCH(
        new Request("http://localhost", {
          method: "PATCH",
          body: JSON.stringify({ status: "applied" }),
        }),
        { params: Promise.resolve({ id }) },
      )
    ).json();
    expect(patched.result.status).toBe("applied");
  });

  it("404s for a missing application", async () => {
    const res = await appRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("404s a PATCH for a missing application", async () => {
    const res = await appRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ status: "applied" }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(res.status).toBe(404);
  });

  it("400s for a malformed JSON body instead of 500", async () => {
    const res = await appsRoute.POST(
      new Request("http://localhost/api/v1/applications", {
        method: "POST",
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("?jobUrl= returns only matching applications; absent param returns all", async () => {
    const jobUrl = "https://boards.greenhouse.io/acme/jobs/999";
    const matching = await (
      await appsRoute.POST(
        new Request("http://localhost/api/v1/applications", {
          method: "POST",
          body: JSON.stringify({
            jobInfo: {
              jobId: "j-url-1",
              jobTitle: "Dedup Target",
              companyName: "Acme",
              applyLink: jobUrl,
            },
          }),
        }),
      )
    ).json();
    await appsRoute.POST(
      new Request("http://localhost/api/v1/applications", {
        method: "POST",
        body: JSON.stringify({
          jobInfo: {
            jobId: "j-url-2",
            jobTitle: "Other",
            companyName: "Other Co",
            applyLink: "https://example.com/other",
          },
        }),
      }),
    );

    const filtered = await (
      await appsRoute.GET(
        new Request(`http://localhost/api/v1/applications?jobUrl=${encodeURIComponent(jobUrl)}`),
      )
    ).json();
    expect(filtered.result).toHaveLength(1);
    expect(filtered.result[0].id).toBe(matching.result.id);

    const all = await (
      await appsRoute.GET(new Request("http://localhost/api/v1/applications"))
    ).json();
    expect(all.result.length).toBeGreaterThanOrEqual(2);
  });
});

describe("/api/v1/agent/tasks", () => {
  it("creates a task for an application and lists it", async () => {
    const app = await (
      await appsRoute.POST(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify({ jobInfo: { jobId: "j2", jobTitle: "T", companyName: "C" } }),
        }),
      )
    ).json();

    const task = await (
      await tasksRoute.POST(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify({ applicationId: app.result.id }),
        }),
      )
    ).json();
    expect(task.result.status).toBe("queued");

    const list = await (await tasksRoute.GET()).json();
    expect(list.result.length).toBeGreaterThan(0);
  });

  it("400s when applicationId is missing", async () => {
    const res = await tasksRoute.POST(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
  });
});
