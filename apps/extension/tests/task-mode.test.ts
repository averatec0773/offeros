import { describe, expect, it } from "vitest";
import type { FieldTrace } from "@offeros/autofill";
import {
  matchHandoff,
  buildFieldReports,
  isCoverLetterField,
  isTextAnswerTarget,
} from "../src/lib/autofill/task-mode";
import type { FillTicket } from "../src/lib/offeros-api";
import { jobIdFromUrl } from "../src/lib/autofill/recipes";

const ticket = (over: Partial<FillTicket>): FillTicket => ({
  id: "h1",
  taskId: "t1",
  applicationId: "a1",
  status: "pending",
  createdAt: 1,
  updatedAt: 1,
  job: { title: "SWE", company: "Acme" },
  ...over,
});

describe("matchHandoff", () => {
  it("matches on ATS job id parsed from applyLink vs page URL", () => {
    const tickets = [
      ticket({ id: "hA", applyLink: "https://jobs.lever.co/other/zzz" }),
      ticket({ id: "hB", applyLink: "https://boards.greenhouse.io/acme/jobs/12345" }),
    ];
    const page = "https://boards.greenhouse.io/acme/jobs/12345?token=x";
    expect(matchHandoff(tickets, page, jobIdFromUrl)?.id).toBe("hB");
  });

  it("prefers a job-id match over a mere hostname match", () => {
    const tickets = [
      // same hostname as the page but a different job id
      ticket({ id: "hHost", applyLink: "https://boards.greenhouse.io/acme/jobs/99999" }),
      // different hostname but the same job id as the page
      ticket({ id: "hId", applyLink: "https://boards.greenhouse.io/acme/jobs/12345" }),
    ];
    const page = "https://boards.greenhouse.io/acme/jobs/12345";
    expect(matchHandoff(tickets, page, jobIdFromUrl)?.id).toBe("hId");
  });

  it("falls back to hostname when no job id matches", () => {
    const tickets = [
      ticket({ id: "hA", applyLink: "https://jobs.lever.co/foo/aaaa" }),
      ticket({ id: "hB", applyLink: "https://jobs.ashbyhq.com/acme/bbbb" }),
    ];
    const page = "https://jobs.ashbyhq.com/acme/cccc";
    expect(matchHandoff(tickets, page, jobIdFromUrl)?.id).toBe("hB");
  });

  it("reads applyLink from the job header when the top-level field is absent", () => {
    const tickets = [
      ticket({
        id: "hB",
        applyLink: undefined,
        job: { title: "SWE", company: "Acme", applyLink: "https://jobs.ashbyhq.com/acme/bbbb" },
      }),
    ];
    const page = "https://jobs.ashbyhq.com/acme/cccc";
    expect(matchHandoff(tickets, page, jobIdFromUrl)?.id).toBe("hB");
  });

  it("falls back to the single open ticket when nothing else matches", () => {
    const tickets = [ticket({ id: "only", applyLink: "https://jobs.lever.co/foo/aaaa" })];
    const page = "https://boards.greenhouse.io/acme/jobs/12345";
    expect(matchHandoff(tickets, page, jobIdFromUrl)?.id).toBe("only");
  });

  it("returns null when multiple tickets are ambiguous (no id/host match)", () => {
    const tickets = [
      ticket({ id: "hA", applyLink: "https://jobs.lever.co/foo/aaaa" }),
      ticket({ id: "hB", applyLink: "https://jobs.ashbyhq.com/bar/bbbb" }),
    ];
    const page = "https://boards.greenhouse.io/acme/jobs/12345";
    expect(matchHandoff(tickets, page, jobIdFromUrl)).toBeNull();
  });

  it("returns null for an empty ticket list", () => {
    expect(matchHandoff([], "https://x.test/jobs/1", jobIdFromUrl)).toBeNull();
  });

  it("ignores completed/cancelled tickets for the single-open fallback", () => {
    const tickets = [
      ticket({ id: "done", status: "completed", applyLink: "https://jobs.lever.co/foo/aaaa" }),
      ticket({ id: "live", status: "pending", applyLink: "https://jobs.ashbyhq.com/bar/bbbb" }),
    ];
    const page = "https://boards.greenhouse.io/acme/jobs/12345";
    expect(matchHandoff(tickets, page, jobIdFromUrl)?.id).toBe("live");
  });
});

const trace = (over: Partial<FieldTrace>): FieldTrace => ({
  fieldId: "f1",
  label: "Field",
  classifiedType: "unknown",
  status: "fillable",
  chosenValue: "",
  source: "none",
  reason: "",
  ...over,
});

describe("buildFieldReports", () => {
  it("maps a filled personal field to outcome filled + source personal", () => {
    const t = [trace({ fieldId: "f1", label: "Email", classifiedType: "email", status: "fillable", chosenValue: "a@b.c", source: "personal" })];
    const r = buildFieldReports(t, new Map([["f1", "filled"]]), new Set(["f1"]), "page-1")[0]!;
    expect(r).toMatchObject({
      fieldId: "f1",
      outcome: "filled",
      source: "personal",
      value: "a@b.c",
      required: true,
      page: "page-1",
    });
  });

  it("maps a file input (needs-answer, unwritten) to needs-user with no value", () => {
    const t = [trace({ fieldId: "f1", label: "Resume", classifiedType: "resume", status: "needs-answer", chosenValue: "" })];
    const r = buildFieldReports(t, new Map(), new Set(["f1"]), "p")[0]!;
    expect(r.outcome).toBe("needs-user");
    expect(r.value).toBeUndefined();
  });

  it("maps an unknown, unwritten field to skipped", () => {
    const t = [trace({ fieldId: "f1", status: "unknown", source: "none" })];
    const r = buildFieldReports(t, new Map(), new Set(), "p")[0]!;
    expect(r.outcome).toBe("skipped");
  });

  it("maps a generated free-text answer to filled + source ai-generated", () => {
    const t = [trace({ fieldId: "f1", label: "Why us?", status: "needs-answer", source: "generate" })];
    const r = buildFieldReports(
      t,
      new Map([["f1", { outcome: "filled", value: "Because…", source: "ai-generated" }]]),
      new Set(),
      "p",
    )[0]!;
    expect(r).toMatchObject({ outcome: "filled", source: "ai-generated", value: "Because…" });
  });

  it("derives source ai-generated from a generate-source trace even with a bare string write", () => {
    const t = [trace({ fieldId: "f1", status: "needs-answer", source: "generate" })];
    const r = buildFieldReports(t, new Map([["f1", "filled"]]), new Set(), "p")[0]!;
    expect(r.source).toBe("ai-generated");
  });

  it("labels a cover-letter write via an explicit source override", () => {
    const t = [trace({ fieldId: "f1", label: "Cover letter", status: "needs-answer", source: "generate" })];
    const r = buildFieldReports(
      t,
      new Map([["f1", { outcome: "filled", value: "Dear team", source: "cover-letter" }]]),
      new Set(),
      "p",
    )[0]!;
    expect(r.source).toBe("cover-letter");
  });

  it("maps a failed DOM write to outcome failed", () => {
    const t = [trace({ fieldId: "f1", classifiedType: "skills", status: "fillable", source: "personal" })];
    const r = buildFieldReports(t, new Map([["f1", "failed"]]), new Set(), "p")[0]!;
    expect(r.outcome).toBe("failed");
    expect(r.source).toBe("skills");
  });

  it("maps an answer-bank hit to source answer-bank", () => {
    const t = [trace({ fieldId: "f1", status: "fillable", source: "answerBank", chosenValue: "Yes" })];
    const r = buildFieldReports(t, new Map([["f1", "filled"]]), new Set(), "p")[0]!;
    expect(r.source).toBe("answer-bank");
  });
});

describe("isCoverLetterField", () => {
  it("detects cover-letter labels", () => {
    expect(isCoverLetterField("Cover Letter")).toBe(true);
    expect(isCoverLetterField("Paste your cover letter")).toBe(true);
    expect(isCoverLetterField("Motivation letter")).toBe(true);
  });
  it("rejects unrelated labels", () => {
    expect(isCoverLetterField("Why do you want this role?")).toBe(false);
    expect(isCoverLetterField("Additional information")).toBe(false);
    expect(isCoverLetterField("")).toBe(false);
  });
});

describe("isTextAnswerTarget", () => {
  it("rejects a file input — a cover-letter-labeled upload must never be a paste/generation target", () => {
    expect(isTextAnswerTarget({ type: "file" })).toBe(false);
  });
  it("rejects a <select> — an unmatched pasted/generated string silently fails to select", () => {
    expect(isTextAnswerTarget({ type: "select" })).toBe(false);
  });
  it("rejects a checkbox", () => {
    expect(isTextAnswerTarget({ type: "checkbox" })).toBe(false);
  });
  it("rejects a radio button", () => {
    expect(isTextAnswerTarget({ type: "radio" })).toBe(false);
  });
  it("rejects number/date inputs — the value setter silently coerces an unparsable string to empty", () => {
    expect(isTextAnswerTarget({ type: "number" })).toBe(false);
    expect(isTextAnswerTarget({ type: "date" })).toBe(false);
  });
  it("accepts a textarea", () => {
    expect(isTextAnswerTarget({ type: "textarea" })).toBe(true);
  });
  it("accepts a plain text input", () => {
    expect(isTextAnswerTarget({ type: "text" })).toBe(true);
  });
  it("accepts email/tel/url/search — arbitrary text is accepted by the value setter", () => {
    expect(isTextAnswerTarget({ type: "email" })).toBe(true);
    expect(isTextAnswerTarget({ type: "tel" })).toBe(true);
    expect(isTextAnswerTarget({ type: "url" })).toBe(true);
    expect(isTextAnswerTarget({ type: "search" })).toBe(true);
  });
  it("accepts a bare <input> with no type attribute (describe() resolves it to the tag name \"input\")", () => {
    expect(isTextAnswerTarget({ type: "input" })).toBe(true);
  });
});

describe("writeOne outcome mapping (caller-path contract)", () => {
  // Mirrors fill-panel.tsx's writeOne: applyFillDetailed omits the outcome
  // entry entirely for fields it skips (file inputs, element gone) rather than
  // reporting "failed" — so an absent entry must map to "not filled", never to
  // a default success. This guards against re-introducing the `?? "filled"` bug.
  const writeOneOutcome = (outcomes: Map<string, "filled" | "failed"> | undefined, fieldId: string): boolean =>
    outcomes?.get(fieldId) === "filled";

  it("treats an absent outcome (skipped field, e.g. a file input) as not filled", () => {
    expect(writeOneOutcome(new Map(), "f1")).toBe(false);
    expect(writeOneOutcome(undefined, "f1")).toBe(false);
  });
  it("treats an explicit 'filled' outcome as filled", () => {
    expect(writeOneOutcome(new Map([["f1", "filled"]]), "f1")).toBe(true);
  });
  it("treats an explicit 'failed' outcome as not filled", () => {
    expect(writeOneOutcome(new Map([["f1", "failed"]]), "f1")).toBe(false);
  });
});
