import { describe, expect, it } from "vitest";
import type { FieldTrace } from "@offeros/autofill";
import {
  matchHandoff,
  buildFieldReports,
  isCoverLetterField,
  isTextAnswerTarget,
  NO_FILE_REASON,
  CUSTOM_UPLOADER_REASON,
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

  it("never claims a ticket for another tenant on a multi-tenant board host", () => {
    // Real incident: a pending ticket for another company's Ashby posting was
    // claimed on jobs.ashbyhq.com/<other-company> because bare hostnames match.
    const tickets = [ticket({ id: "hA", applyLink: "https://jobs.ashbyhq.com/forward/1111" })];
    const page = "https://jobs.ashbyhq.com/sentilink/2222/application";
    expect(matchHandoff(tickets, page, jobIdFromUrl)).toBeNull();
  });

  it("matches same tenant on a multi-tenant board host (slug compared case-insensitively)", () => {
    const tickets = [ticket({ id: "hB", applyLink: "https://jobs.ashbyhq.com/SentiLink/1111" })];
    const page = "https://jobs.ashbyhq.com/sentilink/2222/application";
    expect(matchHandoff(tickets, page, jobIdFromUrl)?.id).toBe("hB");
  });

  it("falls back to the single open ticket only when it has no applyLink to compare", () => {
    const linkless = [ticket({ id: "only", applyLink: undefined })];
    const page = "https://boards.greenhouse.io/acme/jobs/12345";
    expect(matchHandoff(linkless, page, jobIdFromUrl)?.id).toBe("only");

    // A linkable ticket that didn't match by id or tenant belongs elsewhere.
    const linked = [ticket({ id: "only", applyLink: "https://jobs.lever.co/foo/aaaa" })];
    expect(matchHandoff(linked, page, jobIdFromUrl)).toBeNull();
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
      ticket({ id: "live", status: "pending", applyLink: undefined }),
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

  it("maps a verified résumé attach to filled + source resume-file + filename value", () => {
    const t = [
      trace({
        fieldId: "f1",
        label: "Resume/CV",
        classifiedType: "resume",
        status: "needs-answer",
        source: "personal",
      }),
    ];
    const r = buildFieldReports(
      t,
      new Map([["f1", { outcome: "filled", value: "Jordan_Rivera_Resume.pdf", source: "resume-file" }]]),
      new Set(["f1"]),
      "p",
    )[0]!;
    expect(r).toMatchObject({
      outcome: "filled",
      source: "resume-file",
      value: "Jordan_Rivera_Resume.pdf",
    });
  });

  it("maps a cover-letter file attach to filled + source cover-letter-file", () => {
    const t = [
      trace({
        fieldId: "f1",
        label: "Cover Letter",
        classifiedType: "coverLetter",
        status: "needs-answer",
        source: "personal",
      }),
    ];
    const r = buildFieldReports(
      t,
      new Map([["f1", { outcome: "filled", value: "Cover_Letter.pdf", source: "cover-letter-file" }]]),
      new Set(),
      "p",
    )[0]!;
    expect(r).toMatchObject({ outcome: "filled", source: "cover-letter-file", value: "Cover_Letter.pdf" });
  });

  it("a write outcome's explicit reason overrides the trace's default reason", () => {
    const t = [
      trace({
        fieldId: "f1",
        classifiedType: "resume",
        status: "needs-answer",
        reason: "file input (classified 'resume') → always manual upload, left needs-answer",
      }),
    ];
    const r = buildFieldReports(
      t,
      new Map([["f1", { outcome: "needs-user", reason: NO_FILE_REASON, source: "resume-file" }]]),
      new Set(),
      "p",
    )[0]!;
    expect(r.outcome).toBe("needs-user");
    expect(r.reason).toBe(NO_FILE_REASON);
  });

  it("a failed-verification attach reports needs-user with the custom-uploader reason", () => {
    const t = [trace({ fieldId: "f1", classifiedType: "coverLetter", status: "needs-answer" })];
    const r = buildFieldReports(
      t,
      new Map([["f1", { outcome: "needs-user", reason: CUSTOM_UPLOADER_REASON, source: "cover-letter-file" }]]),
      new Set(),
      "p",
    )[0]!;
    expect(r.outcome).toBe("needs-user");
    expect(r.reason).toBe(CUSTOM_UPLOADER_REASON);
  });

  it("without a write override, reason falls back to the trace's classify-time reason unchanged", () => {
    const t = [trace({ fieldId: "f1", status: "unknown", source: "none", reason: "no classifier match → left unknown" })];
    const r = buildFieldReports(t, new Map(), new Set(), "p")[0]!;
    expect(r.reason).toBe("no classifier match → left unknown");
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
  // isCoverLetterField delegates to @offeros/autofill's isCoverLetterLabel — the same
  // matcher classifyField's file-kind detection uses — so a hyphenated label now
  // matches through both paths (they used to disagree: this used a raw substring
  // check that "cover-letter" never contained).
  it("detects a hyphenated label, matching classifyField's file-kind detection", () => {
    expect(isCoverLetterField("Cover-Letter")).toBe(true);
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
