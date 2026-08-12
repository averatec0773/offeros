import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { createApplication, getApplication } from "../../repositories/application-repo";
import { listEvents } from "../../repositories/application-event-repo";
import { recordShapes, shapesFor } from "../../repositories/form-memory-repo";
import { reconApplication, htmlToText } from "../recon-service";
import {
  parseGreenhouseUrl,
  parseGreenhouseJob,
  greenhouseClosedMarker,
} from "../recon/greenhouse";

/**
 * Reconnaissance is deliberately dumb and deliberately honest: status codes and
 * the platform's own words, never a guess dressed up as a verdict. These tests
 * pin both halves — the classification, and the refusal to classify.
 *
 * No test here touches the network. Every response is a saved fixture.
 */

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-recon-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const seed = (applyLink?: string, jdText?: string) =>
  createApplication(db, {
    jobInfo: {
      jobId: "j1",
      jobTitle: "ML Engineer",
      companyName: "Acme",
      ...(applyLink ? { applyLink } : {}),
    },
    ...(jdText ? { jdText } : {}),
  }).id;

/** A response fixture, standing in for one fetch. */
const respond = (
  body: unknown,
  init: { status?: number; url?: string; text?: string; location?: string } = {},
): Response =>
  ({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    url: init.url ?? "",
    headers: new Headers(init.location ? { location: init.location } : {}),
    json: async () => body,
    text: async () => init.text ?? JSON.stringify(body),
    arrayBuffer: async () =>
      new TextEncoder().encode(init.text ?? JSON.stringify(body)).buffer as ArrayBuffer,
  }) as unknown as Response;

/** Everything in these tests is a public host as far as the guard is
 *  concerned; the guard's own refusals are covered in safe-fetch.test.ts. */
const publicDns = async () => ["93.184.216.34"];

const GH_JOB = {
  id: 4321,
  title: "Machine Learning Engineer",
  company_name: "Acme Corp",
  location: { name: "Austin, TX" },
  content: "&lt;p&gt;We need &lt;strong&gt;Python&lt;/strong&gt;.&lt;/p&gt;",
  questions: [
    { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
    { label: "Resume", required: true, fields: [{ name: "resume", type: "input_file" }] },
    {
      label: "Why do you want to work here?",
      required: false,
      fields: [{ name: "question_1", type: "textarea" }],
    },
    {
      label: "Are you legally authorized to work in the US?",
      required: true,
      fields: [
        {
          name: "question_2",
          type: "multi_value_single_select",
          values: [
            { label: "Yes", value: 1 },
            { label: "No", value: 0 },
          ],
        },
      ],
    },
  ],
};

describe("Greenhouse URL parsing", () => {
  it("reads the board token and job id off every shape of board URL", () => {
    expect(parseGreenhouseUrl("https://boards.greenhouse.io/acme/jobs/4321")).toEqual({
      token: "acme",
      jobId: "4321",
    });
    expect(parseGreenhouseUrl("https://job-boards.greenhouse.io/acme/jobs/4321?gh_src=x")).toEqual({
      token: "acme",
      jobId: "4321",
    });
    expect(parseGreenhouseUrl("https://acme.greenhouse.io/jobs/4321")).toEqual({
      token: "acme",
      jobId: "4321",
    });
    // The embed form carries both ids in the query string instead.
    expect(
      parseGreenhouseUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=4321"),
    ).toEqual({ token: "acme", jobId: "4321" });
  });

  it("refuses anything that is not a Greenhouse posting", () => {
    expect(parseGreenhouseUrl("https://jobs.lever.co/acme/abc")).toBeNull();
    expect(parseGreenhouseUrl("https://boards.greenhouse.io/acme")).toBeNull();
    expect(parseGreenhouseUrl("https://boards.greenhouse.io/acme/jobs/not-a-number")).toBeNull();
    expect(parseGreenhouseUrl("not a url")).toBeNull();
    // A lookalike host must not pass for the real one.
    expect(parseGreenhouseUrl("https://greenhouse.io.evil.com/acme/jobs/1")).toBeNull();
  });
});

describe("Greenhouse payload parsing", () => {
  it("turns the API's questions into keyed, typed, required-marked questions", () => {
    const job = parseGreenhouseJob(GH_JOB)!;
    expect(job.title).toBe("Machine Learning Engineer");
    expect(job.company).toBe("Acme Corp");
    expect(job.questions).toHaveLength(4);

    const authorization = job.questions.find((q) => q.question.startsWith("Are you legally"))!;
    expect(authorization.required).toBe(true);
    // The board API's select type name maps onto the same control the fill
    // engine uses, which is what lets the two sightings share a key.
    expect(authorization.control).toBe("single-select");

    const free = job.questions.find((q) => q.question.startsWith("Why do you"))!;
    expect(free.control).toBe("long-text");
    expect(free.required).toBe(false);

    // Keys are non-empty and distinct per question.
    expect(new Set(job.questions.map((q) => q.questionKey)).size).toBe(4);
  });

  it("returns null for a payload that is not a job", () => {
    expect(parseGreenhouseJob(null)).toBeNull();
    expect(parseGreenhouseJob({ error: "not found" })).toBeNull();
  });

  it("recognises the platform's own closed-page wording", () => {
    expect(greenhouseClosedMarker("<h1>This job is no longer available</h1>")).toBe(true);
    expect(greenhouseClosedMarker("<p>NO LONGER ACCEPTING APPLICATIONS</p>")).toBe(true);
    expect(greenhouseClosedMarker("<h1>Machine Learning Engineer</h1>")).toBe(false);
  });
});

describe("verdicts", () => {
  it("open: the board API still has the posting", async () => {
    const id = seed("https://boards.greenhouse.io/acme/jobs/4321");
    const result = await reconApplication(db, id, {
      resolve: publicDns,
      fetchImpl: vi.fn(async () => respond(GH_JOB)) as unknown as typeof fetch,
    });
    expect(result!.verdict).toBe("open");
    expect(result!.vendor).toBe("greenhouse");
    expect(result!.questionsFound).toBe(4);
    expect(result!.requiredFound).toBe(3);
  });

  it("closed: the board API 404s, which is how Greenhouse says a job is gone", async () => {
    const id = seed("https://boards.greenhouse.io/acme/jobs/4321");
    const result = await reconApplication(db, id, {
      resolve: publicDns,
      fetchImpl: vi.fn(async () => respond(null, { status: 404 })) as unknown as typeof fetch,
    });
    expect(result!.verdict).toBe("closed");
  });

  it("closed: an unrecognised page carrying a known platform's closed copy", async () => {
    // A Greenhouse URL whose API shape we cannot address still gets the page
    // read for the platform's own wording.
    const id = seed("https://boards.greenhouse.io/embed/job_app?for=acme&token=4321");
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("boards-api")
        ? respond(null, { status: 500 })
        : respond(null, { text: "<h1>This job is no longer available</h1>" }),
    );
    const result = await reconApplication(db, id, {
      resolve: publicDns,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result!.verdict).toBe("closed");
  });

  it("suspected-closed: the posting now redirects to the board index", async () => {
    // A real redirect, followed hop by hop — the old fixture faked the final
    // URL on a 200, which stopped being how this works once every hop got its
    // own host check.
    const id = seed("https://jobs.example.com/careers/jobs/4321");
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).endsWith("/jobs/4321")
        ? respond(null, { status: 301, location: "https://jobs.example.com/careers" })
        : respond(null, { text: "<h1>All openings</h1>" }),
    );
    const result = await reconApplication(db, id, {
      resolve: publicDns,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result!.verdict).toBe("suspected-closed");
  });

  it("unknown: a link that resolves into the local network is refused, honestly", async () => {
    // The guard's job, seen from here: no verdict is invented, and the reason
    // is reported rather than swallowed.
    const id = seed("https://internal.example/jobs/1");
    const fetchImpl = vi.fn();
    const result = await reconApplication(db, id, {
      resolve: async () => ["127.0.0.1"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result!.verdict).toBe("unknown");
    expect(result!.detail).toMatch(/private address/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("unknown: a network failure is reported, never guessed at", async () => {
    const id = seed("https://jobs.example.com/careers/jobs/4321");
    const result = await reconApplication(db, id, {
      resolve: publicDns,
      fetchImpl: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect(result!.verdict).toBe("unknown");
    expect(result!.detail).toMatch(/could not reach/i);
  });

  it("unknown: a site we cannot read is not promoted to open just because it answered", async () => {
    // The classic false positive: a login wall serving a friendly 200.
    const id = seed("https://careers.example.com/login?redirect=/job/4321");
    const result = await reconApplication(db, id, {
      resolve: publicDns,
      fetchImpl: vi.fn(async () =>
        respond(null, { text: "<h1>Sign in to continue</h1>" }),
      ) as unknown as typeof fetch,
    });
    expect(result!.verdict).toBe("unknown");
  });

  it("unknown: nothing to check when the application has no link", async () => {
    const id = seed();
    const fetchImpl = vi.fn();
    const result = await reconApplication(db, id, {
      resolve: publicDns,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result!.verdict).toBe("unknown");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null for an application that does not exist", async () => {
    expect(await reconApplication(db, "nope")).toBeNull();
  });

  it("writes the verdict onto the application's timeline", async () => {
    const id = seed("https://boards.greenhouse.io/acme/jobs/4321");
    await reconApplication(db, id, {
      resolve: publicDns,
      fetchImpl: vi.fn(async () => respond(GH_JOB)) as unknown as typeof fetch,
    });
    const checked = listEvents(db, id).filter((e) => e.kind === "job-checked");
    expect(checked).toHaveLength(1);
    expect(checked[0]!.payload).toMatchObject({ verdict: "open", vendor: "greenhouse" });
  });
});

describe("prescan storage", () => {
  const run = (id: string) =>
    reconApplication(db, id, {
      resolve: publicDns,
      fetchImpl: vi.fn(async () => respond(GH_JOB)) as unknown as typeof fetch,
    });

  it("stores the questions as prescan, without claiming to have met them", async () => {
    const id = seed("https://boards.greenhouse.io/acme/jobs/4321");
    await run(id);
    const keys = parseGreenhouseJob(GH_JOB)!.questions.map((q) => q.questionKey);
    const stored = shapesFor(db, keys);
    expect(stored).toHaveLength(4);
    expect(stored.every((s) => s.source === "prescan")).toBe(true);
    // A prescan is not a sighting: it must not inflate "how often has this
    // actually come up".
    expect(stored.every((s) => s.seenCount === 0)).toBe(true);
    expect(stored.filter((s) => s.required)).toHaveLength(3);
  });

  it("a real fill outranks a prescan and takes the row over", async () => {
    const id = seed("https://boards.greenhouse.io/acme/jobs/4321");
    await run(id);
    const key = parseGreenhouseJob(GH_JOB)!.questions[0]!.questionKey;

    recordShapes(
      db,
      "greenhouse",
      id,
      [
        {
          questionKey: key,
          question: "First name (as it appears on your ID)",
          classifiedType: "text",
          failed: true,
          required: true,
        },
      ],
      2_000,
    );

    const [row] = shapesFor(db, [key]);
    expect(row!.source).toBe("fill");
    expect(row!.question).toBe("First name (as it appears on your ID)");
    expect(row!.seenCount).toBe(1);
  });

  it("a later prescan does not overwrite what a real fill recorded", async () => {
    const id = seed("https://boards.greenhouse.io/acme/jobs/4321");
    const key = parseGreenhouseJob(GH_JOB)!.questions[0]!.questionKey;
    recordShapes(
      db,
      "greenhouse",
      id,
      [
        {
          questionKey: key,
          question: "What the real form actually asked",
          classifiedType: "text",
          failed: false,
          required: true,
        },
      ],
      1_000,
    );

    await run(id);

    const [row] = shapesFor(db, [key]);
    expect(row!.source).toBe("fill");
    expect(row!.question).toBe("What the real form actually asked");
    expect(row!.seenCount).toBe(1);
  });
});

describe("job description backfill", () => {
  it("fills an empty jdText from the posting, as text", async () => {
    const id = seed("https://boards.greenhouse.io/acme/jobs/4321");
    const result = await reconApplication(db, id, {
      resolve: publicDns,
      fetchImpl: vi.fn(async () => respond(GH_JOB)) as unknown as typeof fetch,
    });
    expect(result!.jdBackfilled).toBe(true);
    expect(getApplication(db, id)!.jdText).toContain("We need Python.");
  });

  it("never replaces a description we already had", async () => {
    const id = seed("https://boards.greenhouse.io/acme/jobs/4321", "captured from the real page");
    const result = await reconApplication(db, id, {
      resolve: publicDns,
      fetchImpl: vi.fn(async () => respond(GH_JOB)) as unknown as typeof fetch,
    });
    expect(result!.jdBackfilled).toBeUndefined();
    expect(getApplication(db, id)!.jdText).toBe("captured from the real page");
  });

  it("htmlToText unescapes and strips without inventing anything", () => {
    expect(htmlToText("&lt;p&gt;Hello&lt;br&gt;world&lt;/p&gt;")).toBe("Hello\nworld");
    expect(htmlToText("<p>A &amp; B</p>")).toBe("A & B");
  });
});

/**
 * Who is allowed to replace a description that is already stored.
 *
 * The rule was "only fill an empty one", which is right for a check that runs
 * on its own — silently replacing text the user pasted would be taking
 * something away from them. It is wrong for a check they pressed. A capture bug
 * once stored a page's JavaScript as the job description, and with this rule
 * there was no way to fix it from the UI: every fetch looked at the garbage,
 * saw a non-empty string, and left it there.
 */
describe("replacing a stored description", () => {
  const GARBAGE = "var app={init:function(){for(var i=0;i<10;i++){go(i);}}};".repeat(6);

  it("an automatic check leaves what is already there alone", async () => {
    const id = seed("https://boards.greenhouse.io/acme/jobs/4321", GARBAGE);
    await reconApplication(db, id, {
      resolve: publicDns,
      fetchImpl: vi.fn(async () => respond(GH_JOB)) as unknown as typeof fetch,
    });
    expect(getApplication(db, id)!.jdText).toBe(GARBAGE);
  });

  it("a check the user pressed replaces it", async () => {
    const id = seed("https://boards.greenhouse.io/acme/jobs/4321", GARBAGE);
    await reconApplication(db, id, {
      allowOverwrite: true,
      resolve: publicDns,
      fetchImpl: vi.fn(async () => respond(GH_JOB)) as unknown as typeof fetch,
    });
    const after = getApplication(db, id)!;
    expect(after.jdText).not.toBe(GARBAGE);
    expect(after.jdText).toContain("Python");
  });

  it("puts what it replaced on the timeline, so a bad fetch is traceable", () => {
    // A fetch that makes things worse has to be findable afterwards.
    return (async () => {
      const id = seed("https://boards.greenhouse.io/acme/jobs/4321", GARBAGE);
      await reconApplication(db, id, {
        allowOverwrite: true,
        resolve: publicDns,
        fetchImpl: vi.fn(async () => respond(GH_JOB)) as unknown as typeof fetch,
      });
      const replaced = listEvents(db, id).find((e) => e.kind === "jd-replaced");
      expect(replaced).toBeTruthy();
      expect((replaced!.payload as { previousChars: number }).previousChars).toBe(GARBAGE.length);
      expect((replaced!.payload as { previousPreview: string }).previousPreview).toContain(
        "var app",
      );
    })();
  });

  it("still fills an empty description without pressing anything", async () => {
    const id = seed("https://boards.greenhouse.io/acme/jobs/4321");
    await reconApplication(db, id, {
      resolve: publicDns,
      fetchImpl: vi.fn(async () => respond(GH_JOB)) as unknown as typeof fetch,
    });
    expect(getApplication(db, id)!.jdText).toContain("Python");
  });

  it("does not record a replacement when the text is identical", async () => {
    // Fetching the same description twice is not an event.
    const id = seed("https://boards.greenhouse.io/acme/jobs/4321");
    const run = () =>
      reconApplication(db, id, {
        allowOverwrite: true,
        resolve: publicDns,
        fetchImpl: vi.fn(async () => respond(GH_JOB)) as unknown as typeof fetch,
      });
    await run();
    await run();
    expect(listEvents(db, id).filter((e) => e.kind === "jd-replaced")).toHaveLength(0);
  });
});
