// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FillPanel, type FillApi } from "../../src/sidepanel/fill-panel";
import type { ScanResponse, FillResponse, CaptureJdResponse } from "../../src/lib/autofill/autofill-messaging";
import type { FillValue } from "../../src/lib/autofill/dom-fill";
import type {
  AnswerEntry,
  ApiResult,
  ApplicationSummary,
  FileFetchResult,
  FillTaskBundle,
  FillTicket,
  FitSummary,
} from "../../src/lib/offeros-api";

const bundle: FillTaskBundle = {
  handoffId: "h1",
  taskId: "t1",
  applicationId: "a1",
  job: { title: "Engineer", company: "Acme" },
  fillProfile: {
    personal: { name: "Jordan Rivera", email: "a@b.com", phone: "", address: "", links: {} },
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
  job: { title: "Engineer", company: "Acme" },
};

const captureOk: CaptureJdResponse = {
  jd: "jd",
  source: "body",
  metaCompany: "Acme",
  metaTitle: "Engineer",
  url: "https://boards.greenhouse.io/acme/jobs/1",
};

const okFill = (values: FillValue[]): FillResponse => ({
  ok: true,
  filled: values.length,
  outcomes: values.map((v) => [v.fieldId, "filled"] as [string, "filled"]),
});

const text = (fieldId: string, label: string) => ({
  fieldId,
  label,
  name: "",
  autocomplete: "",
  type: "textarea",
  placeholder: "",
  ariaLabel: "",
  required: true,
});

const scan: ScanResponse = {
  ok: true,
  atsId: "greenhouse",
  url: "https://boards.greenhouse.io/acme/jobs/1",
  company: "Acme",
  title: "Engineer",
  descriptors: [
    { fieldId: "f1", label: "Email", name: "email", autocomplete: "email", type: "email", placeholder: "", ariaLabel: "" },
    // Exactly the questions the choice-group guardrails refuse — but rendered
    // as free text, which many ATSes do.
    text("q1", "Are you legally authorized to work in the United States without visa sponsorship?"),
    text("q2", "Please describe any disability or accommodation you need for the interview process."),
    text("q3", "Why do you want to work at this company and what excites you about the role?"),
  ],
};

const api = (): FillApi => ({
  getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [ticket] })),
  claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
  postReport: vi.fn(async () => ({ ok: true as const, value: {} })),
  generateAnswer: vi.fn(async () => ({ ok: true as const, value: { answer: "Yes, I am authorized." } })),
  findApplicationsByJobUrl: vi.fn(async (): Promise<ApiResult<ApplicationSummary[]>> => ({ ok: true, value: [] })),
  createTaskFromJd: vi.fn(async () => ({ ok: true as const, value: { id: "t2", applicationId: "a2" } })),
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
});

describe("AI-answering guardrails on FREE-TEXT questions", () => {
  it("must not AI-answer truth-required or self-identification questions rendered as text", async () => {
    const used = api();
    const fill = vi.fn(async (v: FillValue[]) => okFill(v));
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
    await screen.findByText("Engineer · Acme");
    const btn = await screen.findByRole("button", { name: /^Fill/ });
    await act(async () => {
      await userEvent.click(btn);
    });
    // Harness sanity: the benign open-ended question IS AI-answered.
    expect(used.generateAnswer).toHaveBeenCalledWith("t1", expect.objectContaining({
      question: "Why do you want to work at this company and what excites you about the role?",
    }));
    const asked = (used.generateAnswer as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => (c[1] as { question: string }).question,
    );
    expect(asked).toEqual([
      "Why do you want to work at this company and what excites you about the role?",
    ]);
  });
});
