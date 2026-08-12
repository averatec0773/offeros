// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FillPanel, type FillApi } from "../../src/sidepanel/fill-panel";
import type {
  ScanResponse,
  FillResponse,
  CaptureJdResponse,
} from "../../src/lib/autofill/autofill-messaging";
import type { FillValue } from "../../src/lib/autofill/dom-fill";
import type { AiResolution } from "../../src/lib/autofill/task-mode";
import type {
  AnswerEntry,
  ApiResult,
  ApplicationSummary,
  FieldReport,
  FileFetchResult,
  FillTaskBundle,
  FillTicket,
  FitSummary,
} from "../../src/lib/offeros-api";

/**
 * The whole fallback chain, on a form the deterministic vocabulary cannot read.
 *
 * The labels here are German. Nothing in `classify.ts` matches them, so every
 * field lands as `unknown` and an ordinary fill does nothing at all — that is
 * the situation this feature exists for, and the first test pins it so the rest
 * of the file cannot pass by accident.
 */

const bundle: FillTaskBundle = {
  handoffId: "h1",
  taskId: "t1",
  applicationId: "a1",
  job: { title: "Ingenieur", company: "Acme" },
  fillProfile: {
    personal: {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "555-0142",
      address: "1 Example Way",
      links: {},
    },
    skills: [],
    answerBank: [],
  },
  resumeText: null,
  coverLetterText: null,
  jdSummary: null,
  attachResume: "tailored",
};

const ticket: FillTicket = {
  id: "h1",
  taskId: "t1",
  applicationId: "a1",
  status: "pending",
  createdAt: 1,
  updatedAt: 1,
  job: { title: "Ingenieur", company: "Acme" },
};

const captureOk: CaptureJdResponse = {
  jd: "jd",
  source: "body",
  metaCompany: "Acme",
  metaTitle: "Ingenieur",
  url: "https://boards.greenhouse.io/acme/jobs/1",
};

const field = (fieldId: string, label: string, type = "text") => ({
  fieldId,
  label,
  name: "",
  autocomplete: "",
  type,
  placeholder: "",
  ariaLabel: "",
  required: true,
});

const scan: ScanResponse = {
  ok: true,
  atsId: "greenhouse",
  url: "https://boards.greenhouse.io/acme/jobs/1",
  company: "Acme",
  title: "Ingenieur",
  descriptors: [
    field("f1", "Telefonnummer"),
    field("f2", "Wohnort"),
    field("f3", "Arbeitserlaubnis"),
    field("f4", "Feld 7"),
  ],
};

/** What the server returns after resolving the model's mappings. */
const resolutions: AiResolution[] = [
  {
    fieldId: "f1",
    status: "fillable",
    value: "555-0142",
    source: "personal",
    confidence: 0.95,
    reason: "AI matched this to your phone.",
  },
  {
    fieldId: "f2",
    status: "fillable",
    value: "Springfield",
    source: "personal",
    confidence: 0.8,
    reason: "AI matched this to your city.",
  },
  {
    fieldId: "f3",
    status: "needs-answer",
    value: "",
    source: "none",
    confidence: 0.9,
    blockedBy: "truth",
    reason: "AI matched this field, but work-authorization questions are a legal statement.",
  },
  {
    fieldId: "f4",
    status: "unknown",
    value: "",
    source: "none",
    confidence: 0.2,
    reason: "AI couldn't tell what this field is asking for.",
  },
];

const okFill = (values: FillValue[]): FillResponse => ({
  ok: true,
  filled: values.length,
  outcomes: values.map((v) => [v.fieldId, "filled"] as [string, "filled"]),
});

const api = (over: Partial<FillApi> = {}): FillApi => ({
  getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [ticket] })),
  claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
  postReport: vi.fn(async () => ({ ok: true as const, value: {} })),
  postEvidence: vi.fn(async () => ({ ok: true as const, value: { file: "", bytes: 0 } })),
  generateAnswer: vi.fn(async () => ({ ok: true as const, value: { answer: "" } })),
  classifyFields: vi.fn(async () => ({
    ok: true as const,
    value: { resolutions, considered: 4, classified: 3 },
  })),
  findApplicationsByJobUrl: vi.fn(async (): Promise<ApiResult<ApplicationSummary[]>> => ({
    ok: true,
    value: [],
  })),
  createTaskFromJd: vi.fn(async () => ({
    ok: true as const,
    value: { id: "t2", applicationId: "a2" },
  })),
  instantFill: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: false, error: "no" })),
  tailorResume: vi.fn(async (): Promise<ApiResult<unknown>> => ({ ok: true, value: {} })),
  generateCoverLetter: vi.fn(async (): Promise<ApiResult<unknown>> => ({ ok: true, value: {} })),
  getFit: vi.fn(async (): Promise<ApiResult<FitSummary>> => ({ ok: false, error: "no" })),
  computeFit: vi.fn(async (): Promise<ApiResult<FitSummary>> => ({ ok: false, error: "no" })),
  resolveFillAction: vi.fn(async (): Promise<ApiResult<unknown>> => ({ ok: true, value: {} })),
  undoSubmission: vi.fn(async (): Promise<ApiResult<unknown>> => ({ ok: true, value: {} })),
  postRepairEvent: vi.fn(async (): Promise<ApiResult<unknown>> => ({ ok: true, value: {} })),
  fetchResumeFile: vi.fn(async (): Promise<FileFetchResult> => ({ ok: false })),
  fetchArtifactPdf: vi.fn(async (): Promise<FileFetchResult> => ({ ok: false })),
  listAnswers: vi.fn(async (): Promise<ApiResult<AnswerEntry[]>> => ({ ok: true, value: [] })),
  createAnswer: vi.fn(async (): Promise<ApiResult<AnswerEntry>> => ({
    ok: true,
    value: { id: "n1", questionPatterns: [], answer: "", type: "text", category: "custom" },
  })),
  updateAnswer: vi.fn(async (): Promise<ApiResult<AnswerEntry>> => ({
    ok: true,
    value: { id: "n1", questionPatterns: [], answer: "", type: "text", category: "custom" },
  })),
  ...over,
});

async function mount(used: FillApi, fill = vi.fn(async (v: FillValue[]) => okFill(v))) {
  render(
    <FillPanel
      scan={async () => scan}
      fill={fill}
      capture={vi.fn(async () => captureOk)}
      attachFile={vi.fn(async () => ({ ok: true }))}
      api={used}
      rescanNonce={0}
      openWebApp={vi.fn()}
      openApplication={vi.fn()}
      webReachable
      tabUrl={scan.ok ? scan.url : ""}
    />,
  );
  await screen.findByText("Ingenieur · Acme");
  return fill;
}

describe("a form the closed vocabulary cannot read", () => {
  it("offers the AI read, because nothing here was recognised", async () => {
    await mount(api());
    // The premise: with every field unknown, the ordinary fill has nothing to do.
    expect(await screen.findByText(/Most fields here weren't recognized/)).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Have AI read this form/ })).toBeTruthy();
  });

  it("marks the button as spending the user's own API credit", async () => {
    await mount(api());
    const btn = await screen.findByRole("button", { name: /Have AI read this form/ });
    expect(btn.getAttribute("title")).toContain("your own API key");
  });

  it("sends only the fields the engine gave up on, and never a value", async () => {
    const used = api();
    await mount(used);
    await act(async () => {
      await userEvent.click(await screen.findByRole("button", { name: /Have AI read this form/ }));
    });
    const [taskId, fields] = (used.classifyFields as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0] as [string, { fieldId: string; currentStatus: string }[]];
    expect(taskId).toBe("t1");
    expect(fields.map((f) => f.fieldId).sort()).toEqual(["f1", "f2", "f3", "f4"]);
    expect(fields.every((f) => f.currentStatus === "unknown")).toBe(true);
    // A classifier has no use for the applicant's data, so it is not sent.
    expect(JSON.stringify(fields)).not.toContain("555-0142");
    expect(JSON.stringify(fields)).not.toContain("jordan@example.com");
  });
});

describe("what happens to the mappings that came back", () => {
  it("fills the mapped fields through the ordinary verified write path", async () => {
    const used = api();
    const fill = await mount(used);
    await act(async () => {
      await userEvent.click(await screen.findByRole("button", { name: /Have AI read this form/ }));
    });
    const written = fill.mock.calls.flatMap((c) => c[0]);
    expect(written).toEqual(
      expect.arrayContaining([
        { fieldId: "f1", value: "555-0142" },
        { fieldId: "f2", value: "Springfield" },
      ]),
    );
    // The guarded field and the unreadable one are not written at all.
    expect(written.map((w) => w.fieldId)).not.toContain("f3");
    expect(written.map((w) => w.fieldId)).not.toContain("f4");
  });

  it("reports those fields as AI-matched, so the workspace can show which they were", async () => {
    const used = api();
    await mount(used);
    await act(async () => {
      await userEvent.click(await screen.findByRole("button", { name: /Have AI read this form/ }));
    });
    const calls = (used.postReport as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const reports = calls.at(-1)![1] as FieldReport[];
    const byId = new Map(reports.map((r) => [r.fieldId, r]));
    expect(byId.get("f1")!.source).toBe("ai-classified");
    expect(byId.get("f1")!.outcome).toBe("filled");
    // The reason travels with it — a filled field whose reason still said "no
    // classifier match" would be a false account of what happened.
    expect(byId.get("f1")!.reason).toContain("AI matched");
  });

  it("a guarded field stays the user's, and a value never reaches it", async () => {
    const used = api();
    await mount(used);
    await act(async () => {
      await userEvent.click(await screen.findByRole("button", { name: /Have AI read this form/ }));
    });
    const calls = (used.postReport as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const reports = calls.at(-1)![1] as FieldReport[];
    const f3 = reports.find((r) => r.fieldId === "f3")!;
    expect(f3.outcome).toBe("needs-user");
    expect(f3.value ?? "").toBe("");
  });

  it("says how many it read and how many it placed", async () => {
    await mount(api());
    await act(async () => {
      await userEvent.click(await screen.findByRole("button", { name: /Have AI read this form/ }));
    });
    expect(await screen.findByText(/AI read 4 unrecognised fields and placed 3\./)).toBeTruthy();
  });

  it("shows the error instead of doing nothing when the call fails", async () => {
    const used = api({
      classifyFields: vi.fn(async () => ({
        ok: false as const,
        error: "No AI provider connected",
      })),
    });
    await mount(used);
    await act(async () => {
      await userEvent.click(await screen.findByRole("button", { name: /Have AI read this form/ }));
    });
    expect(await screen.findByText("No AI provider connected")).toBeTruthy();
  });
});
