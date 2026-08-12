// @vitest-environment happy-dom
/**
 * Independent audit of the side-panel side of the answer guards:
 * the "planned actions" button count and the "Check what you agreed to" card.
 */
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
import type {
  AnswerEntry,
  ApiResult,
  ApplicationSummary,
  FileFetchResult,
  FillTaskBundle,
  FillTicket,
  FitSummary,
} from "../../src/lib/offeros-api";

const baseBundle: FillTaskBundle = {
  handoffId: "h1",
  taskId: "t1",
  applicationId: "a1",
  job: { title: "Engineer", company: "Acme" },
  fillProfile: {
    personal: { name: "Jordan Rivera", email: "a@b.com", phone: "", address: "", links: {} },
    skills: [],
    answerBank: [],
    education: [],
    experience: [],
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

const api = (bundle: FillTaskBundle): FillApi => ({
  getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [ticket] })),
  claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
  postReport: vi.fn(async () => ({ ok: true as const, value: {} })),
  postEvidence: vi.fn(async () => ({ ok: true as const, value: { file: "", bytes: 0 } })),
  generateAnswer: vi.fn(async () => ({ ok: true as const, value: { answer: "Yes" } })),
  analyzeFields: vi.fn(async () => ({
    ok: true as const,
    value: { fields: [], summary: "" },
  })),
  saveJdFromPage: vi.fn(async () => ({ ok: true as const, value: {} })),
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
});

type OkScanResponse = Extract<ScanResponse, { ok: true }>;

const scanOf = (descriptors: OkScanResponse["descriptors"]): ScanResponse => ({
  ok: true,
  atsId: "greenhouse",
  url: "https://boards.greenhouse.io/acme/jobs/1",
  company: "Acme",
  title: "Engineer",
  descriptors,
});

const mount = async (
  scan: ScanResponse,
  used: FillApi,
  fill = vi.fn(async (v: FillValue[]) => okFill(v)),
) => {
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
      tabUrl="https://boards.greenhouse.io/acme/jobs/1"
    />,
  );
  await screen.findByText("Engineer · Acme");
  return { fill };
};

describe("AUDIT panel: the Fill button counts work the run performs", () => {
  it("guarded/unperformable work is excluded from the count", async () => {
    // The bundle has NO cover letter (skipped, or not generated yet). The
    // cover-letter textarea is `generatable` and a text target, so it counts as
    // a planned action — but step 2 skips it (no text) and step 3 excludes
    // cover-letter labels outright. The click is a no-op.
    const used = api(baseBundle);
    const { fill } = await mount(
      scanOf([
        {
          fieldId: "cl",
          label: "Cover Letter",
          name: "",
          autocomplete: "",
          type: "textarea",
          placeholder: "",
          ariaLabel: "",
          required: false,
        },
      ]),
      used,
    );
    const btn = await screen.findByRole("button", { name: /^Fill/ });
    const label = btn.textContent;
    await act(async () => {
      await userEvent.click(btn);
    });
    // The click writes nothing at all…
    expect(used.generateAnswer).not.toHaveBeenCalled();
    expect(fill.mock.calls.flatMap((c) => c[0])).toEqual([]);
    // …so the button must not have offered to do one field's worth of work.
    expect(label).toBe("Fill 0 fields");
  });
});

describe("AUDIT panel: the policy review card", () => {
  it("every policy answer is shown WITH the value that went in", async () => {
    // The commonest case by far: the consent is answered from the user's own
    // answer bank, i.e. step 1, whose write outcome is the bare string "filled".
    const bundle: FillTaskBundle = {
      ...baseBundle,
      fillProfile: {
        ...baseBundle.fillProfile,
        answerBank: [
          {
            id: "a1",
            questionPatterns: ["ai use policy"],
            answer: "Yes",
            type: "enum",
            category: "screening",
          },
        ],
        education: [],
        experience: [],
      },
    };
    const used = api(bundle);
    await mount(
      scanOf([
        {
          fieldId: "consent",
          label:
            "Do you acknowledge and agree to comply with our AI use policy during the interview process?",
          name: "",
          autocomplete: "",
          type: "radio-group",
          placeholder: "",
          ariaLabel: "",
          required: true,
          options: ["Yes", "No"],
        },
      ]),
      used,
    );
    await act(async () => {
      await userEvent.click(await screen.findByRole("button", { name: /^Fill/ }));
    });
    expect(await screen.findByText("Check what you agreed to")).toBeInTheDocument();
    expect(screen.getByText(/answered: Yes/)).toBeInTheDocument();
  });

  it("an acknowledgment whose wording lives in the OPTIONS is surfaced too", async () => {
    const used = api(baseBundle);
    used.generateAnswer = vi.fn(async () => ({
      ok: true as const,
      value: { answer: "I have read and accept the terms and conditions" },
    }));
    await mount(
      scanOf([
        {
          fieldId: "ack",
          // Real forms put the sentence in the option and leave the group bare.
          label: "",
          name: "",
          autocomplete: "",
          type: "checkbox-group",
          placeholder: "",
          ariaLabel: "",
          required: true,
          options: ["I have read and accept the terms and conditions"],
        },
      ]),
      used,
    );
    await act(async () => {
      await userEvent.click(await screen.findByRole("button", { name: /^Fill/ }));
    });
    expect(used.generateAnswer).toHaveBeenCalled(); // it WAS answered…
    expect(screen.queryByText("Check what you agreed to")).toBeInTheDocument(); // …so it must be reviewable
  });
});

describe("AUDIT panel: truth-required questions in the choice lane", () => {
  it("sponsorship is never auto-answered — even when the label is neutral", async () => {
    const used = api(baseBundle);
    used.generateAnswer = vi.fn(async () => ({
      ok: true as const,
      value: { answer: "I am authorized to work in the US and will not require visa sponsorship" },
    }));
    await mount(
      scanOf([
        {
          fieldId: "auth",
          label: "Please select one",
          name: "",
          autocomplete: "",
          type: "radio-group",
          placeholder: "",
          ariaLabel: "",
          required: true,
          options: [
            "I am authorized to work in the US and will not require visa sponsorship",
            "I will require visa sponsorship now or in the future",
          ],
        },
      ]),
      used,
    );
    await act(async () => {
      await userEvent.click(await screen.findByRole("button", { name: /^Fill/ }));
    });
    expect(used.generateAnswer).not.toHaveBeenCalled();
  });
});
