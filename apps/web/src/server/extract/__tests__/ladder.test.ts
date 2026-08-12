import { describe, it, expect, vi } from "vitest";
import { extractJob, explainEmpty, mergeExternalEvidence } from "../ladder";
import { VENDOR_ADAPTERS } from "../vendors";

/**
 * The regression this whole redesign exists for: an employer's own careers
 * page, with a board's job id in the query string and the board named only in
 * the markup. The old design asked "is this hostname a platform I know?",
 * answered no, and never sent a request.
 *
 * No test here touches the network.
 */

const publicDns = async () => ["93.184.216.34"];

function reply(body: string, init: { status?: number; type?: string; location?: string } = {}) {
  return {
    status: init.status ?? 200,
    headers: new Headers({
      ...(init.type ? { "content-type": init.type } : {}),
      ...(init.location ? { location: init.location } : {}),
    }),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

/** A page built in the browser: no job content, but it names its board. */
const EMBED_SHELL = `<!doctype html><html><head><title>Careers</title></head>
<body><div id="grnhse_app"></div>
<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>
</body></html>`;

const GH_JOB = {
  title: "AI Engineering Intern",
  company_name: "Acme",
  location: { name: "Boulder CO" },
  content: "&lt;p&gt;You will build &lt;strong&gt;models&lt;/strong&gt;.&lt;/p&gt;",
  questions: [
    { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
  ],
};

describe("an employer's own careers page (the regression)", () => {
  const url = "https://acme.com/careers/apply/?gh_jid=1234567";

  it("identifies the board from the page's markup and gets the posting from its API", async () => {
    const fetchImpl = vi.fn(async (target: string) =>
      String(target).includes("boards-api")
        ? reply(JSON.stringify(GH_JOB), { type: "application/json" })
        : reply(EMBED_SHELL, { type: "text/html" }),
    );

    const result = await extractJob(url, { fetchImpl: fetchImpl as never, resolve: publicDns });

    expect(result.identity).toEqual({ vendor: "greenhouse", board: "acme", jobId: "1234567" });
    expect(result.fields.title).toBe("AI Engineering Intern");
    expect(result.fields.jdText).toContain("You will build models.");
    // The description came from the platform, not from the empty shell.
    expect(result.sources.jdText).toBe("vendor-api");
    expect(result.questions).toHaveLength(1);
  });

  it("stays inside the two-request budget", async () => {
    const fetchImpl = vi.fn(async (target: string) =>
      String(target).includes("boards-api")
        ? reply(JSON.stringify(GH_JOB), { type: "application/json" })
        : reply(EMBED_SHELL, { type: "text/html" }),
    );
    await extractJob(url, { fetchImpl: fetchImpl as never, resolve: publicDns });
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("reports what each rung did, so a thin result can explain itself", async () => {
    const fetchImpl = vi.fn(async (target: string) =>
      String(target).includes("boards-api")
        ? reply(JSON.stringify(GH_JOB), { type: "application/json" })
        : reply(EMBED_SHELL, { type: "text/html" }),
    );
    const result = await extractJob(url, { fetchImpl: fetchImpl as never, resolve: publicDns });
    expect(result.attempts.some((a) => a.layer === "url" && !a.ok)).toBe(true);
    expect(result.attempts.some((a) => a.layer === "page" && a.detail.includes("names its"))).toBe(
      true,
    );
    expect(result.attempts.some((a) => a.layer === "vendor-api" && a.ok)).toBe(true);
  });
});

describe("a platform link", () => {
  it("is identified for free, before any request", async () => {
    const fetchImpl = vi.fn(async (target: string) =>
      String(target).includes("boards-api")
        ? reply(JSON.stringify(GH_JOB), { type: "application/json" })
        : reply("<html><body>redirected here</body></html>", { type: "text/html" }),
    );
    const result = await extractJob("https://boards.greenhouse.io/acme/jobs/1234567", {
      fetchImpl: fetchImpl as never,
      resolve: publicDns,
    });
    expect(result.attempts[0]).toMatchObject({ layer: "url", ok: true });
    expect(result.fields.title).toBe("AI Engineering Intern");
  });

  it("notices when the platform's own link lands on the employer's domain", async () => {
    const fetchImpl = vi.fn(async (target: string) => {
      if (String(target).includes("boards-api")) {
        return reply(JSON.stringify(GH_JOB), { type: "application/json" });
      }
      return String(target).includes("greenhouse.io")
        ? reply("", { status: 301, location: "https://acme.com/careers/apply/?gh_jid=1234567" })
        : reply(EMBED_SHELL, { type: "text/html" });
    });
    const result = await extractJob("https://job-boards.greenhouse.io/acme/jobs/1234567", {
      fetchImpl: fetchImpl as never,
      resolve: publicDns,
    });
    expect(result.finalUrl).toBe("https://acme.com/careers/apply/?gh_jid=1234567");
    expect(result.attempts.some((a) => a.detail.includes("followed a redirect"))).toBe(true);
  });
});

describe("what a page can give up on its own", () => {
  const JSON_LD = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Staff Engineer",
    description: "<p>Build things.</p>",
    datePosted: "2026-08-01",
    validThrough: "2026-09-30",
    hiringOrganization: { name: "Globex" },
    jobLocation: { address: { addressLocality: "Austin", addressRegion: "TX" } },
    baseSalary: {
      currency: "USD",
      value: { minValue: 180000, maxValue: 200000, unitText: "YEAR" },
    },
  })}</script></head><body>nothing else</body></html>`;

  it("reads a JobPosting, pay and closing date included", async () => {
    const result = await extractJob("https://careers.globex.example/jobs/7", {
      fetchImpl: vi.fn(async () => reply(JSON_LD, { type: "text/html" })) as never,
      resolve: publicDns,
    });
    expect(result.fields.title).toBe("Staff Engineer");
    expect(result.fields.company).toBe("Globex");
    expect(result.fields.location).toBe("Austin, TX");
    expect(result.fields.salary).toBe("USD 180,000–200,000 per year");
    expect(result.fields.deadline).toBe("2026-09-30");
    expect(result.fields.jdText).toBe("Build things.");
    expect(result.sources.salary).toBe("page");
  });
});

describe("when there is nothing to find", () => {
  it("comes back empty and says why, rather than shrugging", async () => {
    const result = await extractJob("https://careers.example.com/apply", {
      fetchImpl: vi.fn(async () =>
        reply("<html><body><div id=app></div></body></html>", { type: "text/html" }),
      ) as never,
      resolve: publicDns,
    });
    expect(result.fields.jdText).toBeUndefined();
    expect(explainEmpty(result)).toMatch(/built in the browser|no platform fingerprint/);
  });

  it("survives a page it cannot fetch at all", async () => {
    const result = await extractJob("https://careers.example.com/apply", {
      fetchImpl: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as never,
      resolve: publicDns,
    });
    expect(result.page?.ok).toBe(false);
    expect(explainEmpty(result)).toMatch(/could not reach it/);
  });

  it("refuses a link into the local network without pretending otherwise", async () => {
    const fetchImpl = vi.fn();
    const result = await extractJob("https://internal.example/jobs/1", {
      fetchImpl: fetchImpl as never,
      resolve: async () => ["10.0.0.5"],
    });
    expect(result.page?.ok).toBe(false);
    expect(result.page?.reason).toMatch(/private address/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps climbing when one rung fails", async () => {
    // The API is down; the page still yields its meta tags.
    const fetchImpl = vi.fn(async (target: string) =>
      String(target).includes("boards-api")
        ? reply("nope", { status: 500 })
        : reply(
            `<html><head><meta property="og:title" content="Backend Engineer"></head>
             <body><script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script></body></html>`,
            { type: "text/html" },
          ),
    );
    const result = await extractJob("https://acme.com/careers?gh_jid=1234567", {
      fetchImpl: fetchImpl as never,
      resolve: publicDns,
    });
    expect(result.fields.title).toBe("Backend Engineer");
    expect(result.attempts.some((a) => a.layer === "vendor-api" && !a.ok)).toBe(true);
  });
});

describe("the merge", () => {
  it("lets a higher rung overwrite a lower one, and never the reverse", async () => {
    const fetchImpl = vi.fn(async (target: string) =>
      String(target).includes("boards-api")
        ? reply(JSON.stringify(GH_JOB), { type: "application/json" })
        : reply(
            `<html><head><meta property="og:title" content="Page Title"></head>
             <body><script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script></body></html>`,
            { type: "text/html" },
          ),
    );
    const result = await extractJob("https://acme.com/careers?gh_jid=1234567", {
      fetchImpl: fetchImpl as never,
      resolve: publicDns,
    });
    // The platform's own title wins over the page's meta tag.
    expect(result.fields.title).toBe("AI Engineering Intern");
    expect(result.sources.title).toBe("vendor-api");
  });

  it("reserves a rung for the browser, which outranks everything the server saw", () => {
    const base = {
      fields: { jdText: "server guess" },
      sources: { jdText: "vendor-api" as const },
      questions: [],
      attempts: [],
    };
    const merged = mergeExternalEvidence(base, {
      source: "browser",
      fields: { jdText: "what the applicant actually sees" },
    });
    expect(merged.fields.jdText).toBe("what the applicant actually sees");
    expect(merged.sources.jdText).toBe("browser");
  });

  it("lets the user beat the browser", () => {
    const base = {
      fields: { jdText: "rendered" },
      sources: { jdText: "browser" as const },
      questions: [],
      attempts: [],
    };
    const merged = mergeExternalEvidence(base, {
      source: "manual",
      fields: { jdText: "pasted by hand" },
    });
    expect(merged.fields.jdText).toBe("pasted by hand");
  });
});

describe("the registry", () => {
  it("is the only place that knows which platforms exist", () => {
    expect(VENDOR_ADAPTERS.length).toBeGreaterThan(0);
    for (const adapter of VENDOR_ADAPTERS) {
      expect(typeof adapter.vendor).toBe("string");
      expect(typeof adapter.fromUrl).toBe("function");
      expect(typeof adapter.fromHtml).toBe("function");
      expect(typeof adapter.fetchJob).toBe("function");
    }
  });
});
