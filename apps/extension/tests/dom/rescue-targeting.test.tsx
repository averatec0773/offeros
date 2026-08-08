// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://boards.greenhouse.io/acme/jobs" }
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createEngine } from "../../src/lib/engine/engine-service";
import { pickPostingLink } from "../../src/lib/autofill/rescue";
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

afterEach(() => {
  document.body.innerHTML = "";
});

/* ------------------------------------------------------------------ */
/* 1. A board page whose postings each carry an "Apply" link           */
/* ------------------------------------------------------------------ */

describe("board page → applyHref", () => {
  it("must not surface another posting's apply link as THE jump target on a directory", async () => {
    const boardUrl = "https://boards.greenhouse.io/acme/jobs";
    history.replaceState(null, "", boardUrl);
    const origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      return { width: 100, height: 20 } as DOMRect;
    };
    try {
      // A real careers directory: filter dropdowns (which scan as fields) plus
      // a list of postings, each with its own Apply link.
      document.body.innerHTML = `
        <main>
          <h1>Open roles</h1>
          <select name="department"><option>All</option><option>Eng</option></select>
          <select name="location"><option>All</option><option>Remote</option></select>
          <ul>
            <li><a href="/acme/jobs/11">Head of Marketing</a>
                <a href="/acme/jobs/11/application">Apply</a></li>
            <li><a href="/acme/jobs/12">Design Operations Manager</a>
                <a href="/acme/jobs/12/application">Apply</a></li>
            <li><a href="/acme/jobs/42">Machine Learning Engineer</a>
                <a href="/acme/jobs/42/application">Apply</a></li>
          </ul>
        </main>`;
      const res = (await createEngine(document).scan()) as {
        ok: boolean;
        reason?: string;
        applyHref?: string;
        postingLinks?: { href: string; text: string }[];
      };
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("no_form");
      // The held job is "Machine Learning Engineer" (/42). The engine hands the
      // panel an applyHref for a completely unrelated posting.
      expect(res.applyHref).not.toBe("https://boards.greenhouse.io/acme/jobs/11/application");
    } finally {
      Element.prototype.getBoundingClientRect = origRect;
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. The panel prefers applyHref over the title match → wrong job     */
/* ------------------------------------------------------------------ */

const bundle: FillTaskBundle = {
  handoffId: "h1",
  taskId: "t1",
  applicationId: "a1",
  job: { title: "Machine Learning Engineer", company: "Acme" },
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
  job: { title: "Machine Learning Engineer", company: "Acme" },
};

const captureOk: CaptureJdResponse = {
  jd: "jd",
  source: "body",
  metaCompany: "Acme",
  metaTitle: "Machine Learning Engineer",
  url: "https://boards.greenhouse.io/acme/jobs",
};

const heldTaskApi = (): FillApi => ({
  getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [ticket] })),
  claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
  postReport: vi.fn(async () => ({ ok: true as const, value: {} })),
  generateAnswer: vi.fn(async () => ({ ok: true as const, value: { answer: "" } })),
  findApplicationsByJobUrl: vi.fn(async (): Promise<ApiResult<ApplicationSummary[]>> => ({ ok: true, value: [] })),
  createTaskFromJd: vi.fn(async () => ({ ok: true as const, value: { id: "t2", applicationId: "a2" } })),
  instantFill: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: false, error: "no" })),
  tailorResume: vi.fn(async (): Promise<ApiResult<unknown>> => ({ ok: true, value: {} })),
  generateCoverLetter: vi.fn(async (): Promise<ApiResult<unknown>> => ({ ok: true, value: {} })),
  getFit: vi.fn(async (): Promise<ApiResult<FitSummary>> => ({ ok: false, error: "not found" })),
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

const okFill = (values: FillValue[]): FillResponse => ({
  ok: true,
  filled: values.length,
  outcomes: values.map((v) => [v.fieldId, "filled"] as [string, "filled"]),
});

const BOARD_SCAN: ScanResponse = {
  ok: false,
  reason: "no_form",
  url: "https://boards.greenhouse.io/acme/jobs",
  // What the engine actually returns for the board fixture above.
  applyHref: "https://boards.greenhouse.io/acme/jobs/11/application",
  postingLinks: [
    { href: "https://boards.greenhouse.io/acme/jobs/11", text: "Head of Marketing" },
    { href: "https://boards.greenhouse.io/acme/jobs/12", text: "Design Operations Manager" },
    { href: "https://boards.greenhouse.io/acme/jobs/42", text: "Machine Learning Engineer" },
  ],
} as ScanResponse;

const FORM_SCAN: ScanResponse = {
  ok: true,
  atsId: "greenhouse",
  url: "https://boards.greenhouse.io/acme/jobs/42/application",
  company: "Acme",
  title: "Machine Learning Engineer",
  descriptors: [
    {
      fieldId: "f1",
      label: "Email",
      name: "email",
      autocomplete: "email",
      type: "email",
      placeholder: "",
      ariaLabel: "",
    },
  ],
};

describe("rescue jump target on a directory page", () => {
  it("must never auto-jump to an unrelated posting's apply link", async () => {
    const api = heldTaskApi();
    const navigateTab = vi.fn(async () => {});
    const props = {
      fill: vi.fn(async (v: FillValue[]) => okFill(v)),
      capture: vi.fn(async () => captureOk),
      attachFile: vi.fn(async () => ({ ok: true })),
      api,
      openWebApp: vi.fn(),
      openApplication: vi.fn(),
      webReachable: true,
      tabUrl: "https://boards.greenhouse.io/acme/jobs",
      navigateTab,
    };
    // Scan the real form once so the ticket is claimed, then land on the board.
    let n = 0;
    const scan = async (): Promise<ScanResponse> => (++n === 1 ? FORM_SCAN : BOARD_SCAN);
    const { rerender } = render(<FillPanel scan={scan} rescanNonce={0} {...props} />);
    await screen.findByText("Machine Learning Engineer · Acme");
    rerender(<FillPanel scan={scan} rescanNonce={1} {...props} />);

    await waitFor(() => expect(navigateTab).toHaveBeenCalled());
    // The held job is /42. Jumping to /11's form means the panel is about to
    // fill (and report on) a completely different job.
    expect(navigateTab).not.toHaveBeenCalledWith("https://boards.greenhouse.io/acme/jobs/11/application");
  });
});

/* ------------------------------------------------------------------ */
/* 3. Title-match ties auto-jump to the wrong seniority                */
/* ------------------------------------------------------------------ */

describe("pickPostingLink ties", () => {
  it("must not auto-pick when several postings match the held title equally", () => {
    const links = [
      { href: "https://x.test/co/1", text: "Senior Software Engineer" },
      { href: "https://x.test/co/2", text: "Software Engineer" },
      { href: "https://x.test/co/3", text: "Software Engineer Intern" },
    ];
    // Every one of these scores 1.0 for "Software Engineer": the tokens of the
    // held title are all present in each. Auto-navigating to the first is a
    // coin flip between three different jobs.
    const pick = pickPostingLink(links, "Software Engineer");
    expect(pick?.href).not.toBe("https://x.test/co/1");
  });
});
