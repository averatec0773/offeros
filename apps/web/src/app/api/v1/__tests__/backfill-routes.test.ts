import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "offeros-backfill-"));
process.env.OFFEROS_DB_PATH = join(dir, "backfill.db");

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const route = await import("../applications/backfill-jd/route");
const { getDb } = await import("@/server/db/client");
const { createApplication, getApplication } =
  await import("@/server/repositories/application-repo");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Filling in what was missed. Re-runnable, capped, and honest about the ones
 * it cannot read — some pages simply are not readable from a server.
 */

const GH_JOB = {
  title: "ML Engineer",
  company_name: "Acme",
  location: { name: "Austin, TX" },
  content: "&lt;p&gt;Build models.&lt;/p&gt;",
};

function reply(body: string, status = 200) {
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

const seed = (over: { jdText?: string; applyLink?: string } = {}) =>
  createApplication(getDb(), {
    jobInfo: {
      jobId: Math.random().toString(36).slice(2),
      jobTitle: "ML Engineer",
      companyName: "Acme",
      ...(over.applyLink !== undefined ? { applyLink: over.applyLink } : {}),
    },
    ...(over.jdText ? { jdText: over.jdText } : {}),
  }).id;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("boards-api") ? reply(JSON.stringify(GH_JOB)) : reply("<html></html>"),
    ),
  );
});

describe("GET (how much is missing)", () => {
  it("counts only the ones a link could actually fill", async () => {
    seed({ applyLink: "https://boards.greenhouse.io/acme/jobs/1", jdText: "already here" });
    seed({}); // no link at all — nothing to try
    const withLink = seed({ applyLink: "https://boards.greenhouse.io/acme/jobs/2" });

    const body = await (await route.GET()).json();
    expect(body.result.missing).toBe(1);
    expect(typeof body.result.cap).toBe("number");
    expect(getApplication(getDb(), withLink)!.jdText).toBeUndefined();
  });
});

describe("POST (fill them)", () => {
  it("fills what it can and records where the text came from", async () => {
    const id = seed({ applyLink: "https://boards.greenhouse.io/acme/jobs/3" });
    const body = await (await route.POST()).json();

    expect(body.result.filled).toBeGreaterThanOrEqual(1);
    const application = getApplication(getDb(), id)!;
    expect(application.jdText).toContain("Build models.");
    expect(application.jdSource).toBe("vendor-api");
  });

  it("never touches one that already has a description", async () => {
    const id = seed({ applyLink: "https://boards.greenhouse.io/acme/jobs/4", jdText: "mine" });
    await route.POST();
    expect(getApplication(getDb(), id)!.jdText).toBe("mine");
  });

  it("says why each failure failed, rather than reporting a bare count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply("<html><body>nothing here</body></html>", 200)),
    );
    const id = seed({ applyLink: "https://careers.example.com/apply" });
    const body = await (await route.POST()).json();

    const entry = body.result.results.find((r: { id: string }) => r.id === id);
    expect(entry.ok).toBe(false);
    expect(entry.detail).toBeTruthy();
    expect(entry.job).toContain("ML Engineer");
  });

  it("is re-runnable: a second pass only retries what failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply("<html><body>nothing</body></html>", 200)),
    );
    seed({ applyLink: "https://careers.example.com/still-broken" });
    const first = await (await route.POST()).json();
    const second = await (await route.POST()).json();
    expect(second.result.considered).toBe(first.result.considered);
    expect(second.result.filled).toBe(0);
  });
});
