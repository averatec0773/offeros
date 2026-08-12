import { describe, it, expect, vi } from "vitest";
import { extractJob } from "../ladder";
import { ashbyAdapter } from "../vendors/ashby";
import { leverAdapter } from "../vendors/lever";
import { VENDOR_ADAPTERS } from "../vendors";

/**
 * Two more platforms, added to prove the seam: neither of these needed a
 * change to the ladder, the merge or any caller.
 *
 * Every payload below mirrors the SHAPE of a real API response — endpoints and
 * field names were read off live boards before these were written — with
 * synthetic boards and ids.
 */

const publicDns = async () => ["93.184.216.34"];
const JOB_UUID = "3414ba28-35f7-45d3-8e13-35c883959635";

function reply(body: string, init: { status?: number; type?: string } = {}) {
  return {
    status: init.status ?? 200,
    headers: new Headers(init.type ? { "content-type": init.type } : {}),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

const LEVER_JOB = {
  id: JOB_UUID,
  text: "Android Engineer III",
  categories: { location: "New York, New York", commitment: "Full-time", team: "Engineering" },
  descriptionPlain: "You will build the Android app.",
  additionalPlain: "Benefits include everything.",
  salaryRange: { interval: "per-year-salary", currency: "USD", min: 150000, max: 180000 },
  // Their prose field is a legal paragraph on real postings; it must not be
  // mistaken for a value.
  salaryDescriptionPlain:
    "Factors such as scope and responsibilities of the position, candidate's work experience, education/training, job-related skills and market considerations may influence base pay offered.",
  createdAt: 1779223091267,
  hostedUrl: `https://jobs.lever.co/acme/${JOB_UUID}`,
};

const ASHBY_BOARD = {
  apiVersion: "1",
  jobs: [
    { id: "00000000-0000-4000-8000-000000000001", title: "Someone Else's Job" },
    {
      id: JOB_UUID,
      title: "Security Engineer, Cloud",
      location: "New York, NY (HQ)",
      descriptionPlain: "You will secure the cloud.",
      descriptionHtml: "<p>You will secure the cloud.</p>",
      publishedAt: "2026-04-07T17:12:35.753+00:00",
      compensation: { compensationTierSummary: "$200K – $250K" },
    },
  ],
};

describe("Lever", () => {
  it("reads its own platform link", () => {
    expect(leverAdapter.fromUrl(`https://jobs.lever.co/acme/${JOB_UUID}`)).toEqual({
      vendor: "lever",
      board: "acme",
      jobId: JOB_UUID,
    });
    expect(leverAdapter.fromUrl(`https://jobs.eu.lever.co/acme/${JOB_UUID}`)).toMatchObject({
      board: "acme",
    });
    expect(leverAdapter.fromUrl("https://jobs.lever.co/acme")).toBeNull();
    expect(leverAdapter.fromUrl("https://boards.greenhouse.io/acme/jobs/1")).toBeNull();
  });

  it("recognises itself embedded in a company's own careers page", () => {
    // The thing the whole redesign bought: the URL is the employer's, and only
    // the markup says which board is behind it.
    const html = `<html><body><div data-lever></div>
      <script src="https://jobs.lever.co/acme/embed.js"></script></body></html>`;
    expect(leverAdapter.fromHtml(html, `https://acme.com/careers/${JOB_UUID}`)).toEqual({
      vendor: "lever",
      board: "acme",
      jobId: JOB_UUID,
    });
  });

  it("fetches a posting and maps its fields", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      reply(JSON.stringify(LEVER_JOB), { type: "application/json" }),
    );
    const evidence = await leverAdapter.fetchJob(
      { vendor: "lever", board: "acme", jobId: JOB_UUID },
      { fetchImpl: fetchImpl as never, resolve: publicDns },
    );

    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      `https://api.lever.co/v0/postings/acme/${JOB_UUID}?mode=json`,
    );
    expect(evidence!.fields.title).toBe("Android Engineer III");
    expect(evidence!.fields.location).toBe("New York, New York");
    expect(evidence!.fields.salary).toBe("USD 150,000–180,000 per year");
    // Body and the "additional" block their own page shows beneath it.
    expect(evidence!.fields.jdText).toContain("build the Android app");
    expect(evidence!.fields.jdText).toContain("Benefits include everything");
    expect(evidence!.fields.postedAt).toMatch(/^2026-/);
  });

  it("returns nothing rather than guessing when the API will not answer", async () => {
    const evidence = await leverAdapter.fetchJob(
      { vendor: "lever", board: "acme", jobId: JOB_UUID },
      { fetchImpl: vi.fn(async () => reply("nope", { status: 404 })) as never, resolve: publicDns },
    );
    expect(evidence).toBeNull();
  });
});

describe("Ashby", () => {
  it("reads its own platform link", () => {
    expect(ashbyAdapter.fromUrl(`https://jobs.ashbyhq.com/acme/${JOB_UUID}`)).toEqual({
      vendor: "ashby",
      board: "acme",
      jobId: JOB_UUID,
    });
    expect(ashbyAdapter.fromUrl("https://jobs.ashbyhq.com/acme")).toBeNull();
  });

  it("recognises itself embedded in a company's own careers page", () => {
    const html = `<html><body><script src="https://jobs.ashbyhq.com/acme/embed"></script></body></html>`;
    expect(ashbyAdapter.fromHtml(html, `https://acme.com/jobs?ashby_jid=${JOB_UUID}`)).toEqual({
      vendor: "ashby",
      board: "acme",
      jobId: JOB_UUID,
    });
  });

  it("finds the one posting it was asked for in a board-wide response", async () => {
    // Their public API is board-level; one request returns every job.
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      reply(JSON.stringify(ASHBY_BOARD), { type: "application/json" }),
    );
    const evidence = await ashbyAdapter.fetchJob(
      { vendor: "ashby", board: "acme", jobId: JOB_UUID },
      { fetchImpl: fetchImpl as never, resolve: publicDns },
    );

    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true",
    );
    expect(evidence!.fields.title).toBe("Security Engineer, Cloud");
    expect(evidence!.fields.jdText).toContain("secure the cloud");
    expect(evidence!.fields.salary).toBe("$200K – $250K");
    expect(evidence!.fields.postedAt).toMatch(/^2026-04-07/);
  });

  it("returns nothing when the board does not contain that posting", async () => {
    const evidence = await ashbyAdapter.fetchJob(
      { vendor: "ashby", board: "acme", jobId: "00000000-0000-4000-8000-00000000dead" },
      {
        fetchImpl: vi.fn(async () =>
          reply(JSON.stringify(ASHBY_BOARD), { type: "application/json" }),
        ) as never,
        resolve: publicDns,
      },
    );
    expect(evidence).toBeNull();
  });
});

describe("through the ladder, unchanged", () => {
  it("extracts a Lever posting embedded on a company domain", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("api.lever.co")
        ? reply(JSON.stringify(LEVER_JOB), { type: "application/json" })
        : reply(
            `<html><body><script src="https://jobs.lever.co/acme/embed.js"></script></body></html>`,
            { type: "text/html" },
          ),
    );
    const result = await extractJob(`https://acme.com/careers/${JOB_UUID}`, {
      fetchImpl: fetchImpl as never,
      resolve: publicDns,
    });
    expect(result.vendor).toBe("lever");
    expect(result.fields.title).toBe("Android Engineer III");
    expect(result.sources.title).toBe("vendor-api");
  });

  it("extracts an Ashby posting from its platform link", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("api.ashbyhq.com")
        ? reply(JSON.stringify(ASHBY_BOARD), { type: "application/json" })
        : reply("<html><body>shell</body></html>", { type: "text/html" }),
    );
    const result = await extractJob(`https://jobs.ashbyhq.com/acme/${JOB_UUID}`, {
      fetchImpl: fetchImpl as never,
      resolve: publicDns,
    });
    expect(result.vendor).toBe("ashby");
    expect(result.fields.salary).toBe("$200K – $250K");
  });

  it("keeps every platform to itself", () => {
    // No adapter claims another's link — otherwise the first in the registry
    // would silently swallow the rest.
    const links = [
      "https://boards.greenhouse.io/acme/jobs/1234567",
      `https://jobs.lever.co/acme/${JOB_UUID}`,
      `https://jobs.ashbyhq.com/acme/${JOB_UUID}`,
    ];
    for (const link of links) {
      const claimed = VENDOR_ADAPTERS.filter((a) => a.fromUrl(link) !== null);
      expect(claimed, link).toHaveLength(1);
    }
  });
});
