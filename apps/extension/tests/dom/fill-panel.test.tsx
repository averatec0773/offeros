// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FillPanel, type FillApi } from "../../src/sidepanel/fill-panel";
import type {
  ScanResponse,
  FillResponse,
  CaptureJdResponse,
  AttachFileResponse,
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
import { NO_FILE_REASON, CUSTOM_UPLOADER_REASON, RENDER_FAILED_REASON } from "../../src/lib/autofill/task-mode";

const scanOk: ScanResponse = {
  ok: true,
  atsId: "greenhouse",
  url: "https://boards.greenhouse.io/acme/jobs/1",
  company: "Acme",
  title: "Engineer",
  descriptors: [
    { fieldId: "f1", label: "Email", name: "email", autocomplete: "email", type: "email", placeholder: "", ariaLabel: "" },
    { fieldId: "q1", label: "Why do you want to work here?", name: "why", autocomplete: "", type: "textarea", placeholder: "", ariaLabel: "" },
  ],
};

const resumeFileDescriptor = {
  fieldId: "r1",
  label: "Resume/CV",
  name: "resume",
  autocomplete: "",
  type: "file",
  placeholder: "",
  ariaLabel: "",
};
const coverLetterFileDescriptor = {
  fieldId: "cl1",
  label: "Cover Letter",
  name: "coverLetter",
  autocomplete: "",
  type: "file",
  placeholder: "",
  ariaLabel: "",
};

const scanWithResumeFile: ScanResponse = {
  ...scanOk,
  descriptors: [scanOk.descriptors[0]!, resumeFileDescriptor],
};

const scanWithBothFiles: ScanResponse = {
  ...scanOk,
  descriptors: [scanOk.descriptors[0]!, resumeFileDescriptor, coverLetterFileDescriptor],
};

const bundle: FillTaskBundle = {
  handoffId: "h1",
  taskId: "t1",
  applicationId: "a1",
  job: { title: "Engineer", company: "Acme" },
  fillProfile: { personal: { name: "Jordan Rivera", email: "a@b.com", phone: "", address: "", links: {} }, skills: [], answerBank: [] },
  resumeText: null,
  coverLetterText: null,
  jdSummary: null,
  attachResume: "tailored",
};

const ticket: FillTicket = {
  id: "h1", taskId: "t1", applicationId: "a1", status: "pending", createdAt: 1, updatedAt: 1,
  job: { title: "Engineer", company: "Acme" },
};

const FIT: FitSummary = {
  overall: 82,
  label: "Strong match",
  whyMatch: "Solid overlap with the core stack.",
  subScores: { experience: 80, skills: 85, education: 75 },
  notAlignedSkills: [
    { skill: "Kubernetes", advice: "Highlight infra work" },
    { skill: "Go", advice: "Mention side projects" },
  ],
};

const okFill = (values: FillValue[]): FillResponse => ({
  ok: true,
  filled: values.length,
  outcomes: values.map((v) => [v.fieldId, "filled"] as [string, "filled"]),
});

const emptyApi = (): FillApi => ({
  getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [] })),
  claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: false, error: "no" })),
  postReport: vi.fn(async () => ({ ok: true as const, value: {} })),
  generateAnswer: vi.fn(async () => ({ ok: true as const, value: { answer: "" } })),
  findApplicationsByJobUrl: vi.fn(async (): Promise<ApiResult<ApplicationSummary[]>> => ({ ok: true, value: [] })),
  createTaskFromJd: vi.fn(async () => ({ ok: true as const, value: { id: "t2", applicationId: "a2" } })),
  instantFill: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: false, error: "no" })),
  tailorResume: vi.fn(async (): Promise<ApiResult<unknown>> => ({ ok: true, value: {} })),
  generateCoverLetter: vi.fn(async (): Promise<ApiResult<unknown>> => ({ ok: true, value: {} })),
  getFit: vi.fn(async (): Promise<ApiResult<FitSummary>> => ({ ok: false, error: "not found" })),
  computeFit: vi.fn(async (): Promise<ApiResult<FitSummary>> => ({ ok: true, value: FIT })),
  resolveFillAction: vi.fn(async (): Promise<ApiResult<unknown>> => ({ ok: true, value: {} })),
  undoSubmission: vi.fn(async (): Promise<ApiResult<unknown>> => ({ ok: true, value: {} })),
  postRepairEvent: vi.fn(async (): Promise<ApiResult<unknown>> => ({ ok: true, value: {} })),
  fetchResumeFile: vi.fn(async (): Promise<FileFetchResult> => ({ ok: false })),
  fetchArtifactPdf: vi.fn(async (): Promise<FileFetchResult> => ({ ok: false })),
  listAnswers: vi.fn(async (): Promise<ApiResult<AnswerEntry[]>> => ({ ok: true, value: [] })),
  createAnswer: vi.fn(async (): Promise<ApiResult<AnswerEntry>> => ({
    ok: true,
    value: { id: "new-1", questionPatterns: [], answer: "", type: "text", category: "custom" },
  })),
  updateAnswer: vi.fn(async (): Promise<ApiResult<AnswerEntry>> => ({
    ok: true,
    value: { id: "existing-1", questionPatterns: [], answer: "", type: "text", category: "custom" },
  })),
});

const captureOk: CaptureJdResponse = {
  jd: "We are hiring a senior engineer to build reliable backend services.",
  source: "jsonld",
  metaCompany: "Acme",
  metaTitle: "Backend Engineer",
  url: scanOk.url,
  structuredTitle: "Backend Engineer",
  structuredCompany: "Acme",
};

const okAttach = async (): Promise<AttachFileResponse> => ({ ok: true });

const renderPanel = (
  over: {
    scan?: () => Promise<ScanResponse>;
    fill?: (v: FillValue[]) => Promise<FillResponse>;
    capture?: () => Promise<CaptureJdResponse>;
    attachFile?: (
      fieldId: string,
      file: { fileName: string; mimeType: string; bytesBase64: string },
    ) => Promise<AttachFileResponse>;
    scrollToField?: (fieldId: string) => Promise<unknown>;
    scanRetryTries?: number;
    scanRetryDelayMs?: number;
    api?: FillApi;
    openWebApp?: () => void;
    openApplication?: (id: string) => void;
    webReachable?: boolean;
    tabUrl?: string;
    getBoundHandoff?: () => Promise<string | null>;
    navigateTab?: (url: string) => Promise<void>;
  } = {},
) => {
  const fill = over.fill ?? vi.fn(async (v: FillValue[]) => okFill(v));
  const capture = over.capture ?? vi.fn(async () => captureOk);
  const attachFile = over.attachFile ?? vi.fn(okAttach);
  const api = over.api ?? emptyApi();
  const openWebApp = over.openWebApp ?? vi.fn();
  const openApplication = over.openApplication ?? vi.fn();
  render(
    <FillPanel
      scan={over.scan ?? (async () => scanOk)}
      fill={fill}
      capture={capture}
      attachFile={attachFile}
      scrollToField={over.scrollToField}
      scanRetryTries={over.scanRetryTries}
      scanRetryDelayMs={over.scanRetryDelayMs}
      api={api}
      rescanNonce={0}
      openWebApp={openWebApp}
      openApplication={openApplication}
      webReachable={over.webReachable ?? true}
      tabUrl={over.tabUrl ?? scanOk.url}
      getBoundHandoff={over.getBoundHandoff}
      navigateTab={over.navigateTab}
    />,
  );
  return { fill, capture, attachFile, api, openWebApp, openApplication };
};

describe("FillPanel", () => {
  it("shows the scanning skeleton while the scan is in flight", () => {
    renderPanel({ scan: () => new Promise(() => {}) });
    expect(screen.getByTestId("scan-skeleton")).toBeInTheDocument();
    expect(screen.getByText("Scanning this page…")).toBeInTheDocument();
  });

  it("keeps probing while the content script is still injecting, then renders the scan", async () => {
    let calls = 0;
    const scan = vi.fn(async (): Promise<ScanResponse> => {
      calls += 1;
      if (calls < 3) throw new Error("Could not establish connection. Receiving end does not exist.");
      return scanOk;
    });
    renderPanel({ scan, scanRetryTries: 5, scanRetryDelayMs: 10 });
    expect(await screen.findByText("Acme · Engineer")).toBeInTheDocument();
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("shows a readable state after the probe budget runs out, then keeps a slow heartbeat", async () => {
    let calls = 0;
    const scan = vi.fn(async (): Promise<ScanResponse> => {
      calls += 1;
      if (calls <= 4) throw new Error("Receiving end does not exist.");
      return scanOk;
    });
    renderPanel({ scan, scanRetryTries: 2, scanRetryDelayMs: 10 });
    expect(await screen.findByText("Can't reach this page yet")).toBeInTheDocument();
    // The heartbeat probe (delay × 6) eventually connects and the panel recovers.
    expect(await screen.findByText("Acme · Engineer", undefined, { timeout: 2000 })).toBeInTheDocument();
  });

  it("no_form scan shows a small message", async () => {
    renderPanel({ scan: async () => ({ ok: false, reason: "no_form" }) });
    expect(await screen.findByText("No form detected")).toBeInTheDocument();
  });

  it("no_form scan still renders Add-this-job — a posting page (Lever/Ashby/Workday) with no form yet still has a JD to capture", async () => {
    renderPanel({ scan: async () => ({ ok: false, reason: "no_form" }) });
    await screen.findByText("No form detected");
    expect(await screen.findByRole("button", { name: "Add this job" })).toBeInTheDocument();
  });

  it("no_form scan hides Add-this-job when the web app is unreachable", async () => {
    renderPanel({ scan: async () => ({ ok: false, reason: "no_form" }), webReachable: false });
    await screen.findByText("No form detected");
    expect(screen.queryByRole("button", { name: "Add this job" })).not.toBeInTheDocument();
  });

  it("no_form scan hides Add-this-job while a claimed fill task is active (mid-task interstitial)", async () => {
    const api = emptyApi();
    api.getPending = vi.fn(async () => ({ ok: true as const, value: [ticket] }));
    api.claim = vi.fn(async () => ({ ok: true as const, value: bundle }));
    const props = {
      fill: vi.fn(async (v: FillValue[]) => okFill(v)),
      capture: vi.fn(async () => captureOk),
      attachFile: vi.fn(okAttach),
      api,
      openWebApp: vi.fn(),
      openApplication: vi.fn(),
      webReachable: true,
      tabUrl: scanOk.url,
    };
    const view = render(<FillPanel scan={async () => scanOk} rescanNonce={0} {...props} />);
    // The claim lands on the ok scan; the bundle survives the rescan below.
    await screen.findByText("Engineer · Acme");
    view.rerender(
      <FillPanel scan={async () => ({ ok: false, reason: "no_form" })} rescanNonce={1} {...props} />,
    );
    await screen.findByText("No form detected");
    expect(screen.queryByRole("button", { name: "Add this job" })).not.toBeInTheDocument();
  });

  it("not_supported scan never renders Add-this-job", async () => {
    renderPanel({ scan: async () => ({ ok: false, reason: "not_supported" }) });
    await screen.findByText("Not an application form");
    expect(screen.queryByRole("button", { name: "Add this job" })).not.toBeInTheDocument();
  });

  it("with no claimable task offers the instant-fill entry and opens the web app", async () => {
    const { openWebApp } = renderPanel();
    expect(
      await screen.findByRole("button", { name: "Fill this page with my profile" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open OfferOS" }));
    expect(openWebApp).toHaveBeenCalledTimes(1);
  });

  it("falls back to the workspace hint when the web app is unreachable (no instant entry)", async () => {
    renderPanel({ webReachable: false });
    expect(
      await screen.findByText("No fill task for this page. Start one from the OfferOS workspace."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Fill this page with my profile" }),
    ).not.toBeInTheDocument();
  });

  it("instant fill claims a parked task from the capture and fills immediately", async () => {
    const api = emptyApi();
    api.instantFill = vi.fn(async () => ({ ok: true as const, value: bundle }));
    const fill = vi.fn(async (v: FillValue[]) => okFill(v));
    const { api: usedApi } = renderPanel({ api, fill });
    await userEvent.click(
      await screen.findByRole("button", { name: "Fill this page with my profile" }),
    );
    await waitFor(() => expect(fill).toHaveBeenCalled());
    // Claim request carries the captured (structured-first) job identity.
    expect(api.instantFill).toHaveBeenCalledWith({
      jobTitle: "Backend Engineer",
      companyName: "Acme",
      jobUrl: scanOk.url,
      jdText: captureOk.jd,
    });
    // The claimed bundle's profile drove the fill: the email field got its value.
    expect(fill.mock.calls.flatMap((c) => c[0])).toContainEqual({ fieldId: "f1", value: "a@b.com" });
    // Ordinary task mode took over: cumulative report posted, task chip shown.
    await waitFor(() => expect(usedApi.postReport).toHaveBeenCalled());
    expect(await screen.findByText("Engineer · Acme")).toBeInTheDocument();
  });

  describe("fit signal / field jump / mark applied", () => {
    const claimedApi = () => {
      const api = emptyApi();
      api.getPending = vi.fn(async () => ({ ok: true as const, value: [ticket] }));
      api.claim = vi.fn(async () => ({ ok: true as const, value: bundle }));
      return api;
    };

    it("shows the stored fit (score + top gaps) when one exists for the claimed application", async () => {
      const api = claimedApi();
      api.getFit = vi.fn(async () => ({ ok: true as const, value: FIT }));
      renderPanel({ api });
      expect(await screen.findByText("82%")).toBeInTheDocument();
      expect(screen.getByText("Strong match")).toBeInTheDocument();
      expect(screen.getByText("Gaps: Kubernetes · Go")).toBeInTheDocument();
      expect(api.getFit).toHaveBeenCalledWith("a1");
    });

    it("offers on-demand Analyze fit when none is stored, and shows the computed result", async () => {
      const api = claimedApi();
      renderPanel({ api });
      await userEvent.click(await screen.findByRole("button", { name: "Analyze fit" }));
      expect(api.computeFit).toHaveBeenCalledWith("a1");
      expect(await screen.findByText("82%")).toBeInTheDocument();
    });

    it("clicking a field row jumps the page to that field and carries the plan reason as tooltip", async () => {
      const api = claimedApi();
      const scrollToField = vi.fn(async () => ({ ok: true }));
      renderPanel({ api, scrollToField });
      const row = await screen.findByRole("button", { name: /Email/ });
      expect(row.getAttribute("title")).toBeTruthy();
      await userEvent.click(row);
      expect(scrollToField).toHaveBeenCalledWith("f1");
    });

    it("after reporting, 'I've submitted' resolves the fill as applied-manually", async () => {
      const api = claimedApi();
      renderPanel({ api });
      const fillBtn = await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
      await userEvent.click(fillBtn);
      await userEvent.click(
        await screen.findByRole("button", { name: "Done — report to workspace" }),
      );
      await userEvent.click(
        await screen.findByRole("button", { name: "I've submitted — mark as applied" }),
      );
      expect(api.resolveFillAction).toHaveBeenCalledWith("t1", "applied-manually");
      expect(
        await screen.findByText("Marked as submitted — the application is closed in OfferOS."),
      ).toBeInTheDocument();
    });
  });

  describe("in-panel tailor", () => {
    // happy-dom can't fetch blob: URLs into iframes — stub the object-URL so the
    // preview iframe gets an inert src instead of spraying NotSupportedError noise.
    beforeEach(() => {
      vi.spyOn(URL, "createObjectURL").mockReturnValue("about:blank");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const pdfFetched: FileFetchResult = {
      ok: true,
      bytes: new TextEncoder().encode("%PDF-1.4 tailored").buffer as ArrayBuffer,
      fileName: "tailored-resume.pdf",
      mimeType: "application/pdf",
    };

    const claimedApi = () => {
      const api = emptyApi();
      api.getPending = vi.fn(async () => ({ ok: true as const, value: [ticket] }));
      api.claim = vi.fn(async () => ({ ok: true as const, value: bundle }));
      api.fetchArtifactPdf = vi.fn(async (): Promise<FileFetchResult> => pdfFetched);
      return api;
    };

    it("tailors, previews the PDF, and attaches it to the résumé file field with a report update", async () => {
      const api = claimedApi();
      const attachFile = vi.fn(
        async (
          _fieldId: string,
          _file: { fileName: string; mimeType: string; bytesBase64: string },
        ): Promise<AttachFileResponse> => ({ ok: true }),
      );
      renderPanel({ api, attachFile, scan: async () => scanWithResumeFile });
      // Claimed task mode: the tailor entry is offered (bundle has no resumeText).
      await userEvent.click(
        await screen.findByRole("button", { name: "Tailor résumé for this job" }),
      );
      expect(api.tailorResume).toHaveBeenCalledWith("t1");
      // Preview appears from the rendered artifact PDF.
      expect(await screen.findByTitle("Tailored résumé preview")).toBeInTheDocument();
      // Fill first so the report map has a row for the resume field.
      await userEvent.click(screen.getByRole("button", { name: /^Fill \d+ fields?$/ }));
      await waitFor(() => expect(api.postReport).toHaveBeenCalled());
      const callsBefore = (api.postReport as ReturnType<typeof vi.fn>).mock.calls.length;
      await userEvent.click(screen.getByRole("button", { name: "Attach tailored PDF" }));
      await waitFor(() => expect(attachFile).toHaveBeenCalled());
      expect(attachFile.mock.calls[attachFile.mock.calls.length - 1]![0]).toBe("r1");
      expect(await screen.findByText("Attached — review it on the page.")).toBeInTheDocument();
      // The cumulative report was re-sent with the résumé field now filled.
      await waitFor(() =>
        expect((api.postReport as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
          callsBefore,
        ),
      );
      const lastReports = (api.postReport as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as {
        fieldId: string;
        outcome: string;
        value?: string;
      }[];
      const resumeRow = lastReports.find((r) => r.fieldId === "r1");
      expect(resumeRow).toMatchObject({ outcome: "filled", value: "tailored-resume.pdf" });
    });

    it("surfaces a tailor failure without a preview", async () => {
      const api = claimedApi();
      api.tailorResume = vi.fn(async () => ({
        ok: false as const,
        error: "Your AI provider rejected the request — check your API key and model in Settings → AI.",
      }));
      renderPanel({ api, scan: async () => scanWithResumeFile });
      await userEvent.click(
        await screen.findByRole("button", { name: "Tailor résumé for this job" }),
      );
      expect(await screen.findByText(/rejected the request/)).toBeInTheDocument();
      expect(screen.queryByTitle("Tailored résumé preview")).not.toBeInTheDocument();
    });

    it("explains when the page has no résumé upload field", async () => {
      const api = claimedApi();
      renderPanel({ api, scan: async () => scanOk }); // no file descriptor
      await userEvent.click(
        await screen.findByRole("button", { name: "Tailor résumé for this job" }),
      );
      await screen.findByTitle("Tailored résumé preview");
      await userEvent.click(screen.getByRole("button", { name: "Attach tailored PDF" }));
      expect(
        await screen.findByText("No résumé upload field on this page — attach the file manually."),
      ).toBeInTheDocument();
    });

    it("writes a cover letter, previews it, and attaches it to the cover-letter file field", async () => {
      const api = claimedApi();
      const attachFile = vi.fn(
        async (
          _fieldId: string,
          _file: { fileName: string; mimeType: string; bytesBase64: string },
        ): Promise<AttachFileResponse> => ({ ok: true }),
      );
      api.fetchArtifactPdf = vi.fn(
        async (): Promise<FileFetchResult> => ({
          ok: true,
          bytes: new TextEncoder().encode("%PDF cover").buffer as ArrayBuffer,
          fileName: "cover-letter.pdf",
          mimeType: "application/pdf",
        }),
      );
      renderPanel({ api, attachFile, scan: async () => scanWithBothFiles });
      await userEvent.click(await screen.findByRole("button", { name: "Write cover letter" }));
      expect(api.generateCoverLetter).toHaveBeenCalledWith("t1");
      expect(await screen.findByTitle("Cover letter preview")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Attach cover letter PDF" }));
      await waitFor(() => expect(attachFile).toHaveBeenCalled());
      expect(attachFile.mock.calls.at(-1)![0]).toBe("cl1");
      expect(await screen.findByText("Attached — review it on the page.")).toBeInTheDocument();
    });

    it("offers no cover-letter entry when the bundle already carries a confirmed letter", async () => {
      const api = claimedApi();
      api.claim = vi.fn(async () => ({
        ok: true as const,
        value: { ...bundle, coverLetterText: "Dear team…" },
      }));
      renderPanel({ api });
      await screen.findByText("Engineer · Acme");
      expect(screen.queryByRole("button", { name: "Write cover letter" })).not.toBeInTheDocument();
    });

    it("rehydrates a re-claimed session's reports so Done stays available", async () => {
      const api = claimedApi();
      api.claim = vi.fn(async () => ({
        ok: true as const,
        value: {
          ...bundle,
          fieldReports: [
            {
              fieldId: "f1",
              label: "Email",
              classifiedType: "email",
              status: "fillable",
              value: "a@b.com",
              source: "personal" as const,
              reason: "",
              outcome: "filled" as const,
              required: true,
            },
          ],
        },
      }));
      renderPanel({ api });
      await screen.findByText("Engineer · Acme");
      // filledOnce was restored from the bundle's reports — Done is clickable
      // without re-running the fill in this session.
      const done = await screen.findByRole("button", { name: "Done — report to workspace" });
      expect(done).not.toBeDisabled();
      await userEvent.click(done);
      const posted = (api.postReport as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
      expect(posted[2]).toBe(true);
      expect((posted[1] as { fieldId: string }[]).map((r) => r.fieldId)).toContain("f1");
    });

    it("flips field rows to their written state live as the fill lands", async () => {
      const api = claimedApi();
      const fill = vi.fn(async (v: FillValue[]) => okFill(v));
      renderPanel({ api, fill });
      const row = await screen.findByRole("button", { name: /Email/ });
      expect(row.getAttribute("data-written")).toBeNull();
      await userEvent.click(await screen.findByRole("button", { name: /^Fill \d+ fields?$/ }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /Email/ }).getAttribute("data-written")).toBe(
          "true",
        ),
      );
    });

    it("rehydrates written rows only for reports whose page matches the current scan", async () => {
      const api = claimedApi();
      const report = (fieldId: string, page: string) => ({
        fieldId,
        label: "Email",
        classifiedType: "email",
        status: "fillable",
        value: "a@b.com",
        source: "personal" as const,
        reason: "",
        outcome: "filled" as const,
        required: true,
        page,
      });
      api.claim = vi.fn(async () => ({
        ok: true as const,
        value: {
          ...bundle,
          fieldReports: [
            report("f1", "f1|q1"), // matches scanOk's page signature -> paints
            report("q1", "some-older-page-layout"), // stale page -> must NOT paint
          ],
        },
      }));
      // The page still HOLDS the previously written value — only then may the
      // rehydrated report paint the row.
      const scanHoldingValue: ScanResponse = {
        ...scanOk,
        descriptors: [
          { ...scanOk.descriptors[0]!, currentValue: "a@b.com" },
          scanOk.descriptors[1]!,
        ],
      };
      renderPanel({ api, scan: async () => scanHoldingValue });
      await screen.findByText("Engineer · Acme");
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /Email/ }).getAttribute("data-written")).toBe(
          "true",
        ),
      );
      expect(
        screen.getByRole("button", { name: /Why do you want/ }).getAttribute("data-written"),
      ).toBeNull();
    });

    it("treats a value the page already holds as answered, and never overwrites it", async () => {
      // The user (or the browser, or an earlier session) filled the open-ended
      // question. We have no answer for it — but the field IS answered.
      const api = claimedApi();
      const scanWithUserAnswer: ScanResponse = {
        ...scanOk,
        descriptors: [
          scanOk.descriptors[0]!, // Email — fillable from the profile
          { ...scanOk.descriptors[1]!, currentValue: "Typed by hand." },
        ],
      };
      const fill = vi.fn(async (v: FillValue[]) => okFill(v));
      renderPanel({ api, fill, scan: async () => scanWithUserAnswer });

      // Header counts it as done, not outstanding…
      expect(await screen.findByText(/1 ready · 0 unanswered/)).toBeInTheDocument();
      // …the row shows the page's value…
      const row = screen.getByRole("button", { name: /Why do you want/ });
      expect(row.getAttribute("data-written")).toBe("true");
      expect(row.textContent).toContain("Typed by hand.");

      // …and a fill run leaves it alone (no generated answer clobbers it).
      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: /^Fill \d+ fields?$/ }));
      });
      expect(fill).toHaveBeenCalledWith([{ fieldId: "f1", value: "a@b.com" }]);
      expect(api.generateAnswer).not.toHaveBeenCalled();
    });

    it("drops a rehydrated checkmark when the page no longer holds the value (reloaded page)", async () => {
      const api = claimedApi();
      api.claim = vi.fn(async () => ({
        ok: true as const,
        value: {
          ...bundle,
          fieldReports: [
            {
              fieldId: "f1",
              label: "Email",
              classifiedType: "email",
              status: "fillable",
              value: "a@b.com",
              source: "personal" as const,
              reason: "",
              outcome: "filled" as const,
              required: true,
              page: "f1|q1",
            },
          ],
        },
      }));
      // scanOk's descriptors carry no currentValue — the reload wiped the DOM.
      renderPanel({ api });
      await screen.findByText("Engineer · Acme");
      // Claim + rescan settle with the row still unwritten: the report says
      // filled, the page says empty, and the page wins.
      await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
      expect(screen.getByRole("button", { name: /Email/ }).getAttribute("data-written")).toBeNull();
    });

    it("expands the fit strip to the full narrative and every gap", async () => {
      const api = claimedApi();
      api.getFit = vi.fn(async () => ({ ok: true as const, value: FIT }));
      renderPanel({ api });
      await userEvent.click(await screen.findByText("82%"));
      expect(await screen.findByText("Solid overlap with the core stack.")).toBeInTheDocument();
      expect(screen.getByText(/Highlight infra work/)).toBeInTheDocument();
      expect(screen.getByText(/Experience 80% · Skills 85% · Education 75%/)).toBeInTheDocument();
    });

    it("offers no tailor entry when the bundle already carries a tailored résumé", async () => {
      const api = claimedApi();
      api.claim = vi.fn(async () => ({
        ok: true as const,
        value: { ...bundle, resumeText: "already tailored" },
      }));
      renderPanel({ api, scan: async () => scanWithResumeFile });
      await screen.findByText("Engineer · Acme");
      expect(
        screen.queryByRole("button", { name: "Tailor résumé for this job" }),
      ).not.toBeInTheDocument();
    });
  });

  it("instant fill surfaces a refused claim (mid-pipeline application) without entering task mode", async () => {
    const api = emptyApi();
    api.instantFill = vi.fn(async () => ({
      ok: false as const,
      error: "already tracked in OfferOS — open the application workspace",
    }));
    renderPanel({ api });
    await userEvent.click(
      await screen.findByRole("button", { name: "Fill this page with my profile" }),
    );
    expect(
      await screen.findByText("already tracked in OfferOS — open the application workspace"),
    ).toBeInTheDocument();
    // Still no bundle: the instant entry stays available.
    expect(screen.getByRole("button", { name: "Fill this page with my profile" })).toBeInTheDocument();
  });

  it("a tab-bound handoff is claimed directly, beating URL heuristics that would refuse", async () => {
    // The pending ticket points at ANOTHER tenant — heuristics would (rightly)
    // refuse it. The explicit binding says this tab was opened for h9, so h9
    // is claimed without consulting the ticket pool at all.
    const boundBundle = { ...bundle, handoffId: "h9" };
    const api: FillApi = {
      ...emptyApi(),
      getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({
        ok: true,
        value: [{ ...ticket, id: "other", applyLink: "https://jobs.ashbyhq.com/other-co/1" }],
      })),
      claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: boundBundle })),
    };
    renderPanel({
      api,
      getBoundHandoff: async () => "h9",
      tabUrl: "https://jobs.ashbyhq.com/acme/2/application",
    });
    await screen.findByText("Engineer · Acme");
    expect(api.claim).toHaveBeenCalledWith("h9");
    expect(api.getPending).not.toHaveBeenCalled();
  });

  it("a claimNonce bump re-attempts the claim after the first attempt found nothing", async () => {
    // First pass: no pending tickets → the panel latches "claim tried".
    const api: FillApi = {
      ...emptyApi(),
      getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [] })),
      claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
    };
    const props = {
      scan: async () => scanOk,
      fill: vi.fn(async (v: FillValue[]) => okFill(v)),
      capture: vi.fn(async () => captureOk),
      attachFile: vi.fn(okAttach),
      api,
      rescanNonce: 0,
      openWebApp: vi.fn(),
      openApplication: vi.fn(),
      webReachable: true,
      tabUrl: scanOk.url,
    };
    const { rerender } = render(<FillPanel {...props} claimNonce={0} />);
    await screen.findByRole("button", { name: "Fill this page with my profile" });
    expect(api.getPending).toHaveBeenCalledTimes(1);
    expect(api.claim).not.toHaveBeenCalled();

    // Server push: a ticket now exists → nonce bump → re-check + claim.
    api.getPending = vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [ticket] }));
    rerender(<FillPanel {...props} claimNonce={1} />);
    await screen.findByText("Engineer · Acme");
    expect(api.claim).toHaveBeenCalledWith("h1");
  });

  it("an unbound tab still falls back to the URL-heuristic ticket match", async () => {
    const api: FillApi = {
      ...emptyApi(),
      getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [ticket] })),
      claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
    };
    renderPanel({ api, getBoundHandoff: async () => null });
    await screen.findByText("Engineer · Acme");
    expect(api.claim).toHaveBeenCalledWith("h1");
  });

  it("claims a matching handoff, fills the fillable field, generates open-ended answers, and reports", async () => {
    const api: FillApi = {
      ...emptyApi(),
      getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [ticket] })),
      claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
      postReport: vi.fn(async () => ({ ok: true as const, value: {} })),
      generateAnswer: vi.fn(async () => ({ ok: true as const, value: { answer: "Because I build compilers." } })),
    };
    const { fill } = renderPanel({ api });

    // after claim + rescan against the bundle profile, email is fillable
    const fillBtn = await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
    expect(api.claim).toHaveBeenCalledWith("h1");
    expect(await screen.findByText("Engineer · Acme")).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(fillBtn);
    });

    expect(fill).toHaveBeenCalledWith([{ fieldId: "f1", value: "a@b.com" }]);
    expect(api.generateAnswer).toHaveBeenCalledWith("t1", {
      question: "Why do you want to work here?",
      label: "Why do you want to work here?",
      context: undefined,
    });
    expect(api.postReport).toHaveBeenCalledWith("t1", expect.any(Array), false);
    expect(await screen.findByText("AI answers")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Because I build compilers.")).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Done — report to workspace" }));
    });
    expect(api.postReport).toHaveBeenLastCalledWith("t1", expect.any(Array), true);
    expect(await screen.findByText("Reported — check the workspace.")).toBeInTheDocument();
  });

  it("AI answers a required non-sensitive choice group with one of its own options, never a self-ID group", async () => {
    const scanWithGroups: ScanResponse = {
      ...scanOk,
      descriptors: [
        scanOk.descriptors[0]!,
        {
          fieldId: "g1",
          label: "Have you used Python professionally?",
          name: "",
          autocomplete: "",
          type: "radio-group",
          placeholder: "",
          ariaLabel: "",
          required: true,
          options: ["Yes", "No"],
        },
        {
          fieldId: "g2",
          label: "Gender",
          name: "",
          autocomplete: "",
          type: "radio-group",
          placeholder: "",
          ariaLabel: "",
          required: true,
          options: ["Male", "Female", "Decline to self-identify"],
        },
        {
          fieldId: "g3",
          label: "Which office would you prefer?",
          name: "",
          autocomplete: "",
          type: "radio-group",
          placeholder: "",
          ariaLabel: "",
          required: false,
          options: ["Boston", "Remote"],
        },
        {
          // Neutral-sounding question, sensitive OPTIONS — the real-form shape
          // that must never be AI-answered (observed on a live posting).
          fieldId: "g4",
          label: "Which of the following communities do you belong to?",
          name: "",
          autocomplete: "",
          type: "checkbox-group",
          placeholder: "",
          ariaLabel: "",
          required: false,
          options: ["Person with disability", "Veteran", "None of the above", "I prefer not to answer"],
        },
        {
          // Legally-consequential fact — bank-only, never an AI guess.
          fieldId: "g5",
          label: "Will you require visa sponsorship now or in the future?",
          name: "",
          autocomplete: "",
          type: "radio-group",
          placeholder: "",
          ariaLabel: "",
          required: true,
          options: ["Yes", "No"],
        },
      ],
    };
    const api: FillApi = {
      ...emptyApi(),
      getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [ticket] })),
      claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
      generateAnswer: vi.fn(async () => ({ ok: true as const, value: { answer: "Yes" } })),
    };
    const { fill } = renderPanel({ api, scan: async () => scanWithGroups });

    const fillBtn = await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
    await act(async () => {
      await userEvent.click(fillBtn);
    });

    // Two AI calls — the required Python group first, then the OPTIONAL office
    // group. Never AI-answered: the Gender group (sensitive label), the
    // communities group (neutral label, sensitive options), and the visa
    // sponsorship group (truth-required fact, bank-only).
    expect(api.generateAnswer).toHaveBeenCalledTimes(2);
    expect(api.generateAnswer).toHaveBeenNthCalledWith(1, "t1", {
      question: "Have you used Python professionally?",
      label: "Have you used Python professionally?",
      context: undefined,
      options: ["Yes", "No"],
    });
    expect(api.generateAnswer).toHaveBeenNthCalledWith(2, "t1", {
      question: "Which office would you prefer?",
      label: "Which office would you prefer?",
      context: undefined,
      options: ["Boston", "Remote"],
    });
    // The chosen option is written through the normal fill path (group click).
    expect(fill).toHaveBeenCalledWith([{ fieldId: "g1", value: "Yes" }]);
    expect(fill).not.toHaveBeenCalledWith([{ fieldId: "g2", value: expect.anything() }]);

    // Choice answers render as a select over the page's own options.
    expect(await screen.findByText("AI answers")).toBeInTheDocument();
    const select = screen.getByLabelText(
      "Answer: Have you used Python professionally?",
    ) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("Yes");
    expect([...select.options].map((o) => o.value)).toEqual(["Yes", "No"]);
  });

  describe("self-recovery on form-less pages", () => {
    const heldTaskApi = (): FillApi => ({
      ...emptyApi(),
      getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [ticket] })),
      claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
    });

    /** Scan the form once (so a task gets claimed), then the given form-less page. */
    const claimThen = (later: ScanResponse) => {
      let n = 0;
      return async (): Promise<ScanResponse> => {
        n += 1;
        return n === 1 ? scanOk : later;
      };
    };

    const renderWithScan = (
      scan: () => Promise<ScanResponse>,
      api: FillApi,
      navigateTab: (url: string) => Promise<void>,
      rescanNonce = 0,
    ) =>
      render(
        <FillPanel
          scan={scan}
          fill={vi.fn(async (v: FillValue[]) => okFill(v))}
          capture={vi.fn(async () => captureOk)}
          attachFile={vi.fn(okAttach)}
          api={api}
          rescanNonce={rescanNonce}
          openWebApp={vi.fn()}
          openApplication={vi.fn()}
          webReachable
          tabUrl={scanOk.url}
          navigateTab={navigateTab}
        />,
      );

    it("jumps the bound tab to the posting's apply link and ledgers the attempt", async () => {
      const api = heldTaskApi();
      const navigateTab = vi.fn(async () => {});
      const scan = claimThen({
        ok: false,
        reason: "no_form",
        applyHref: "https://boards.greenhouse.io/acme/jobs/1/application",
      });
      const { rerender } = renderWithScan(scan, api, navigateTab);
      await screen.findByText("Engineer · Acme");

      rerender(
        <FillPanel
          scan={scan}
          fill={vi.fn(async (v: FillValue[]) => okFill(v))}
          capture={vi.fn(async () => captureOk)}
          attachFile={vi.fn(okAttach)}
          api={api}
          rescanNonce={1}
          openWebApp={vi.fn()}
          openApplication={vi.fn()}
          webReachable
          tabUrl={scanOk.url}
          navigateTab={navigateTab}
        />,
      );
      await waitFor(() =>
        expect(navigateTab).toHaveBeenCalledWith("https://boards.greenhouse.io/acme/jobs/1/application"),
      );
      expect(api.postRepairEvent).toHaveBeenCalledWith(
        "t1",
        "repair-attempted",
        expect.objectContaining({ failure: "page-not-form", action: "jump-to-apply" }),
      );
      // One attempt per target — a repeated scan of the same page must not loop.
      const calls = navigateTab.mock.calls.length;
      rerender(
        <FillPanel
          scan={scan}
          fill={vi.fn(async (v: FillValue[]) => okFill(v))}
          capture={vi.fn(async () => captureOk)}
          attachFile={vi.fn(okAttach)}
          api={api}
          rescanNonce={2}
          openWebApp={vi.fn()}
          openApplication={vi.fn()}
          webReachable
          tabUrl={scanOk.url}
          navigateTab={navigateTab}
        />,
      );
      await waitFor(() => expect(navigateTab.mock.calls.length).toBe(calls));
    });

    it("never jumps without a held task (a browsing user keeps the JD page)", async () => {
      const navigateTab = vi.fn(async () => {});
      renderPanel({
        api: emptyApi(),
        scan: async () => ({
          ok: false,
          reason: "no_form",
          applyHref: "https://boards.greenhouse.io/acme/jobs/1/application",
        }),
        navigateTab,
      });
      await screen.findByText("No form detected");
      expect(navigateTab).not.toHaveBeenCalled();
    });

    it("on a board page, offers the ranked postings for the held job instead of guessing", async () => {
      const api = heldTaskApi();
      const navigateTab = vi.fn(async () => {});
      // No confident title match for "Engineer" — the human rung renders.
      const scan = claimThen({
        ok: false,
        reason: "no_form",
        postingLinks: [
          { href: "https://boards.greenhouse.io/acme/jobs/11", text: "Engineer, Platform" },
          { href: "https://boards.greenhouse.io/acme/jobs/12", text: "Head of Marketing" },
        ],
      });
      const { rerender } = renderWithScan(scan, api, navigateTab);
      await screen.findByText("Engineer · Acme");
      rerender(
        <FillPanel
          scan={scan}
          fill={vi.fn(async (v: FillValue[]) => okFill(v))}
          capture={vi.fn(async () => captureOk)}
          attachFile={vi.fn(okAttach)}
          api={api}
          rescanNonce={1}
          openWebApp={vi.fn()}
          openApplication={vi.fn()}
          webReachable
          tabUrl={scanOk.url}
          navigateTab={navigateTab}
        />,
      );
      const candidate = await screen.findByRole("button", { name: "Engineer, Platform" });
      expect(navigateTab).not.toHaveBeenCalled(); // no auto-jump on a weak match
      expect(screen.queryByRole("button", { name: "Head of Marketing" })).toBeNull(); // score 0
      await act(async () => {
        await userEvent.click(candidate);
      });
      expect(navigateTab).toHaveBeenCalledWith("https://boards.greenhouse.io/acme/jobs/11");
      expect(api.postRepairEvent).toHaveBeenCalledWith(
        "t1",
        "repair-attempted",
        expect.objectContaining({ action: "user-picked-posting" }),
      );
    });
  });

  describe("submission evidence + undo", () => {
    const claimedThenConfirmation = () => {
      // First scan: the form (claim happens). Later scans: a form-less
      // confirmation page.
      let scans = 0;
      return async (): Promise<ScanResponse> => {
        scans += 1;
        return scans === 1 ? scanOk : { ok: false, reason: "no_form", submittedLikely: true };
      };
    };

    it("suggests mark-as-applied on a confirmation page while a task is held, with undo after", async () => {
      const api: FillApi = {
        ...emptyApi(),
        getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [ticket] })),
        claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
      };
      const scan = claimedThenConfirmation();
      const { rerender } = render(
        <FillPanel
          scan={scan}
          fill={vi.fn(async (v: FillValue[]) => okFill(v))}
          capture={vi.fn(async () => captureOk)}
          attachFile={vi.fn(okAttach)}
          api={api}
          rescanNonce={0}
          openWebApp={vi.fn()}
          openApplication={vi.fn()}
          webReachable
          tabUrl={scanOk.url}
        />,
      );
      await screen.findByText("Engineer · Acme"); // claimed on the form page

      // The page navigates to the confirmation page → rescan.
      rerender(
        <FillPanel
          scan={scan}
          fill={vi.fn(async (v: FillValue[]) => okFill(v))}
          capture={vi.fn(async () => captureOk)}
          attachFile={vi.fn(okAttach)}
          api={api}
          rescanNonce={1}
          openWebApp={vi.fn()}
          openApplication={vi.fn()}
          webReachable
          tabUrl={scanOk.url}
        />,
      );
      expect(await screen.findByText("Looks submitted")).toBeInTheDocument();

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Yes — mark as applied" }));
      });
      expect(api.resolveFillAction).toHaveBeenCalledWith("t1", "applied-manually");
      expect(await screen.findByText("Marked as submitted.")).toBeInTheDocument();

      // Mis-click recovery: Undo reopens the task.
      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Undo" }));
      });
      expect(api.undoSubmission).toHaveBeenCalledWith("t1");
      expect(screen.getByRole("button", { name: "Yes — mark as applied" })).toBeInTheDocument();
    });

    it("never suggests mark-as-applied without a held task, even on a confirmation page", async () => {
      const api = emptyApi();
      renderPanel({
        api,
        scan: async () => ({ ok: false, reason: "no_form", submittedLikely: true }),
      });
      expect(await screen.findByText("No form detected")).toBeInTheDocument();
      expect(screen.queryByText("Looks submitted")).toBeNull();
    });
  });

  describe("AI answer memory (accept → persist, deduped)", () => {
    const answerLabel = "Why do you want to work here?";
    const generatedAnswer = "Because I build compilers.";

    const apiWithGeneratedAnswer = (overrides: Partial<FillApi> = {}): FillApi => ({
      ...emptyApi(),
      getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [ticket] })),
      claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
      postReport: vi.fn(async () => ({ ok: true as const, value: {} })),
      generateAnswer: vi.fn(async () => ({ ok: true as const, value: { answer: generatedAnswer } })),
      ...overrides,
    });

    const fillAndGetTextarea = async () => {
      const fillBtn = await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
      await act(async () => {
        await userEvent.click(fillBtn);
      });
      return screen.getByDisplayValue(generatedAnswer);
    };

    it("accept with no normalized match in the bank creates a new answer entry", async () => {
      const api = apiWithGeneratedAnswer({
        listAnswers: vi.fn(async (): Promise<ApiResult<AnswerEntry[]>> => ({ ok: true, value: [] })),
      });
      renderPanel({ api });
      await fillAndGetTextarea();

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Accept" }));
      });

      expect(api.listAnswers).toHaveBeenCalledTimes(1);
      expect(api.createAnswer).toHaveBeenCalledWith({ question: answerLabel, answer: generatedAnswer });
      expect(api.updateAnswer).not.toHaveBeenCalled();
      expect(await screen.findByText("Saved — reused next time this question appears.")).toBeInTheDocument();
    });

    it("accept when a normalized match exists updates that entry instead of creating one", async () => {
      const existing: AnswerEntry = {
        id: "ans-1",
        questionPatterns: ["Why do you want to work here?!"], // normalizes to the same phrase
        answer: "stale answer",
        type: "text",
        category: "custom",
      };
      const api = apiWithGeneratedAnswer({
        listAnswers: vi.fn(async (): Promise<ApiResult<AnswerEntry[]>> => ({ ok: true, value: [existing] })),
      });
      renderPanel({ api });
      await fillAndGetTextarea();

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Accept" }));
      });

      // Answer-only patch: never send questionPatterns on an update (see the
      // multi-pattern regression test below for why).
      expect(api.updateAnswer).toHaveBeenCalledWith("ans-1", { answer: generatedAnswer });
      expect(api.createAnswer).not.toHaveBeenCalled();
      expect(await screen.findByText("Saved — reused next time this question appears.")).toBeInTheDocument();
    });

    it("a matched curated entry with multiple patterns is never clobbered: update carries no questionPatterns", async () => {
      const existing: AnswerEntry = {
        id: "ans-multi",
        questionPatterns: ["why do you want this role", "Why do you want to work here?"],
        answer: "stale answer",
        type: "text",
        category: "custom",
      };
      const api = apiWithGeneratedAnswer({
        listAnswers: vi.fn(async (): Promise<ApiResult<AnswerEntry[]>> => ({ ok: true, value: [existing] })),
      });
      renderPanel({ api });
      await fillAndGetTextarea();

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Accept" }));
      });

      expect(api.updateAnswer).toHaveBeenCalledTimes(1);
      const [id, payload] = (api.updateAnswer as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(id).toBe("ans-multi");
      expect(payload).toEqual({ answer: generatedAnswer });
      expect(payload).not.toHaveProperty("questionPatterns");
      expect(api.createAnswer).not.toHaveBeenCalled();
    });

    it("edited-then-accepted text is what gets saved, not the original generated text", async () => {
      const api = apiWithGeneratedAnswer({
        listAnswers: vi.fn(async (): Promise<ApiResult<AnswerEntry[]>> => ({ ok: true, value: [] })),
      });
      renderPanel({ api });
      const textarea = await fillAndGetTextarea();

      await userEvent.clear(textarea);
      await userEvent.type(textarea, "Because your mission matches my values.");

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Accept" }));
      });

      expect(api.createAnswer).toHaveBeenCalledWith({
        question: answerLabel,
        answer: "Because your mission matches my values.",
      });
    });

    it("shows no caption when the save fails (silent degrade)", async () => {
      const api = apiWithGeneratedAnswer({
        listAnswers: vi.fn(async (): Promise<ApiResult<AnswerEntry[]>> => ({ ok: true, value: [] })),
        createAnswer: vi.fn(async (): Promise<ApiResult<AnswerEntry>> => ({ ok: false, error: "network error" })),
      });
      renderPanel({ api });
      await fillAndGetTextarea();

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Accept" }));
      });

      expect(api.createAnswer).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Saved — reused next time this question appears.")).not.toBeInTheDocument();
    });

    it("regenerate never calls the answer-bank APIs", async () => {
      const api = apiWithGeneratedAnswer({
        listAnswers: vi.fn(async (): Promise<ApiResult<AnswerEntry[]>> => ({ ok: true, value: [] })),
      });
      renderPanel({ api });
      await fillAndGetTextarea();

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
      });

      expect(api.listAnswers).not.toHaveBeenCalled();
      expect(api.createAnswer).not.toHaveBeenCalled();
      expect(api.updateAnswer).not.toHaveBeenCalled();
    });

    it("generating an answer alone (no accept click) never calls the answer-bank APIs", async () => {
      const api = apiWithGeneratedAnswer({
        listAnswers: vi.fn(async (): Promise<ApiResult<AnswerEntry[]>> => ({ ok: true, value: [] })),
      });
      renderPanel({ api });
      await fillAndGetTextarea();

      expect(api.listAnswers).not.toHaveBeenCalled();
      expect(api.createAnswer).not.toHaveBeenCalled();
      expect(api.updateAnswer).not.toHaveBeenCalled();
    });

    it("emptying the textarea disables Accept and blocks the save (no blank overwrite)", async () => {
      const api = apiWithGeneratedAnswer({
        listAnswers: vi.fn(async (): Promise<ApiResult<AnswerEntry[]>> => ({ ok: true, value: [] })),
      });
      renderPanel({ api });
      const textarea = await fillAndGetTextarea();

      await userEvent.clear(textarea);

      const acceptBtn = screen.getByRole("button", { name: "Accept" });
      expect(acceptBtn).toBeDisabled();

      // A disabled button never fires its click handler — confirm no API calls fired.
      await act(async () => {
        await userEvent.click(acceptBtn);
      });
      expect(api.listAnswers).not.toHaveBeenCalled();
      expect(api.createAnswer).not.toHaveBeenCalled();
      expect(api.updateAnswer).not.toHaveBeenCalled();
    });
  });

  it("attempts a claim only once and stays in the no-task state when nothing matches", async () => {
    const api = emptyApi();
    renderPanel({ api });
    await screen.findByRole("button", { name: "Fill this page with my profile" });
    // one scan → one getPending; claim never fires without a match
    expect(api.getPending).toHaveBeenCalledTimes(1);
    expect(api.claim).not.toHaveBeenCalled();
  });

  it("renders canon idioms: lucide status icons + a black pill primary button, no raw glyphs", async () => {
    const api: FillApi = {
      ...emptyApi(),
      getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [ticket] })),
      claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
      postReport: vi.fn(async () => ({ ok: true as const, value: {} })),
      generateAnswer: vi.fn(async () => ({ ok: true as const, value: { answer: "" } })),
    };
    const { container } = render(
      <FillPanel
        scan={async () => scanOk}
        fill={vi.fn(async (v: FillValue[]) => okFill(v))}
        capture={vi.fn(async () => captureOk)}
        attachFile={vi.fn(okAttach)}
        api={api}
        rescanNonce={0}
        openWebApp={vi.fn()}
        openApplication={vi.fn()}
        webReachable
        tabUrl={scanOk.url}
      />,
    );
    const fillBtn = await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
    expect(fillBtn).toHaveClass("rounded-full", "bg-primary");
    // status glyphs are lucide svg icons, never the old raw ✓/⚠/– characters
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.textContent).not.toMatch(/[✓⚠–]/);
  });

  it("re-attempts the claim when rescanNonce changes (web app reconnect)", async () => {
    // First scan: web app is down (network error) → no claim, stuck in "no task".
    let tickets: ApiResult<FillTicket[]> = { ok: false, error: "network error" };
    const api: FillApi = {
      ...emptyApi(),
      getPending: vi.fn(async () => tickets),
      claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
      postReport: vi.fn(async () => ({ ok: true as const, value: {} })),
      generateAnswer: vi.fn(async () => ({ ok: true as const, value: { answer: "" } })),
    };
    const scan = async () => scanOk;
    const fill = vi.fn(async (v: FillValue[]) => okFill(v));
    const capture = vi.fn(async () => captureOk);
    const { rerender } = render(
      <FillPanel
        scan={scan}
        fill={fill}
        capture={capture}
        attachFile={vi.fn(okAttach)}
        api={api}
        rescanNonce={0}
        openWebApp={vi.fn()}
        openApplication={vi.fn()}
        webReachable
        tabUrl={scanOk.url}
      />,
    );
    await screen.findByRole("button", { name: "Fill this page with my profile" });
    expect(api.claim).not.toHaveBeenCalled();

    // Web app comes back with a matching ticket + App forces a rescan (rescanNonce bump).
    tickets = { ok: true, value: [ticket] };
    rerender(
      <FillPanel
        scan={scan}
        fill={fill}
        capture={capture}
        attachFile={vi.fn(okAttach)}
        api={api}
        rescanNonce={1}
        openWebApp={vi.fn()}
        openApplication={vi.fn()}
        webReachable
        tabUrl={scanOk.url}
      />,
    );
    expect(await screen.findByRole("button", { name: /^Fill \d+ fields?$/ })).toBeInTheDocument();
    expect(api.claim).toHaveBeenCalledWith("h1");
  });

  describe("File attach", () => {
    const pdfBytes = (): FileFetchResult => ({
      ok: true,
      bytes: new Uint8Array([37, 80, 68, 70]).buffer,
      fileName: "Jordan_Rivera_Resume.pdf",
      mimeType: "application/pdf",
    });

    it("attachResume: tailored → fetches the artifacts PDF route and reports filled/resume-file/filename", async () => {
      const api: FillApi = {
        ...emptyApi(),
        getPending: vi.fn(async () => ({ ok: true as const, value: [ticket] })),
        claim: vi.fn(async () => ({ ok: true as const, value: { ...bundle, attachResume: "tailored" as const } })),
        fetchArtifactPdf: vi.fn(async () => pdfBytes()),
      };
      const { attachFile } = renderPanel({ scan: async () => scanWithResumeFile, api });

      const fillBtn = await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
      await act(async () => {
        await userEvent.click(fillBtn);
      });

      expect(api.fetchArtifactPdf).toHaveBeenCalledWith("t1", "resume");
      expect(api.fetchResumeFile).not.toHaveBeenCalled();
      expect(attachFile).toHaveBeenCalledWith("r1", {
        fileName: "Jordan_Rivera_Resume.pdf",
        mimeType: "application/pdf",
        bytesBase64: expect.any(String),
      });
      expect(api.postReport).toHaveBeenCalledWith(
        "t1",
        expect.arrayContaining([
          expect.objectContaining({
            fieldId: "r1",
            outcome: "filled",
            source: "resume-file",
            value: "Jordan_Rivera_Resume.pdf",
          }),
        ]),
        false,
      );
    });

    it("attachResume: original with a resumeId → fetches the stored résumé file route, not the artifacts route", async () => {
      const api: FillApi = {
        ...emptyApi(),
        getPending: vi.fn(async () => ({ ok: true as const, value: [ticket] })),
        claim: vi.fn(async () => ({
          ok: true as const,
          value: { ...bundle, attachResume: "original" as const, resumeId: "res-9" },
        })),
        fetchResumeFile: vi.fn(async () => pdfBytes()),
      };
      renderPanel({ scan: async () => scanWithResumeFile, api });

      const fillBtn = await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
      await act(async () => {
        await userEvent.click(fillBtn);
      });

      expect(api.fetchResumeFile).toHaveBeenCalledWith("res-9");
      expect(api.fetchArtifactPdf).not.toHaveBeenCalled();
    });

    it("attachResume: original with no resumeId → no fetch attempted, reports needs-user with the no-file reason", async () => {
      const api: FillApi = {
        ...emptyApi(),
        getPending: vi.fn(async () => ({ ok: true as const, value: [ticket] })),
        claim: vi.fn(async () => ({
          ok: true as const,
          value: { ...bundle, attachResume: "original" as const, resumeId: undefined },
        })),
      };
      const { attachFile } = renderPanel({ scan: async () => scanWithResumeFile, api });

      const fillBtn = await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
      await act(async () => {
        await userEvent.click(fillBtn);
      });

      expect(api.fetchResumeFile).not.toHaveBeenCalled();
      expect(api.fetchArtifactPdf).not.toHaveBeenCalled();
      expect(attachFile).not.toHaveBeenCalled();
      expect(api.postReport).toHaveBeenCalledWith(
        "t1",
        expect.arrayContaining([
          expect.objectContaining({ fieldId: "r1", outcome: "needs-user", reason: NO_FILE_REASON }),
        ]),
        false,
      );
    });

    it("a 404 (fetch ok:false) reports needs-user with the no-file reason and never calls attachFile", async () => {
      const api: FillApi = {
        ...emptyApi(),
        getPending: vi.fn(async () => ({ ok: true as const, value: [ticket] })),
        claim: vi.fn(async () => ({ ok: true as const, value: { ...bundle, attachResume: "tailored" as const } })),
        fetchArtifactPdf: vi.fn(async (): Promise<FileFetchResult> => ({ ok: false })),
      };
      const { attachFile } = renderPanel({ scan: async () => scanWithResumeFile, api });

      const fillBtn = await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
      await act(async () => {
        await userEvent.click(fillBtn);
      });

      expect(attachFile).not.toHaveBeenCalled();
      expect(api.postReport).toHaveBeenCalledWith(
        "t1",
        expect.arrayContaining([
          expect.objectContaining({ fieldId: "r1", outcome: "needs-user", reason: NO_FILE_REASON }),
        ]),
        false,
      );
    });

    it("a fetched file that fails DOM-verified attach reports needs-user with the custom-uploader reason", async () => {
      const api: FillApi = {
        ...emptyApi(),
        getPending: vi.fn(async () => ({ ok: true as const, value: [ticket] })),
        claim: vi.fn(async () => ({ ok: true as const, value: { ...bundle, attachResume: "tailored" as const } })),
        fetchArtifactPdf: vi.fn(async () => pdfBytes()),
      };
      renderPanel({
        scan: async () => scanWithResumeFile,
        api,
        attachFile: vi.fn(async () => ({ ok: false })),
      });

      const fillBtn = await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
      await act(async () => {
        await userEvent.click(fillBtn);
      });

      expect(api.postReport).toHaveBeenCalledWith(
        "t1",
        expect.arrayContaining([
          expect.objectContaining({ fieldId: "r1", outcome: "needs-user", reason: CUSTOM_UPLOADER_REASON }),
        ]),
        false,
      );
    });

    it("a 400 (artifact exists but failed to render) reports needs-user with the render-failed reason, distinct from a 404", async () => {
      const api: FillApi = {
        ...emptyApi(),
        getPending: vi.fn(async () => ({ ok: true as const, value: [ticket] })),
        claim: vi.fn(async () => ({ ok: true as const, value: { ...bundle, attachResume: "tailored" as const } })),
        fetchArtifactPdf: vi.fn(async (): Promise<FileFetchResult> => ({ ok: false, status: 400 })),
      };
      const { attachFile } = renderPanel({ scan: async () => scanWithResumeFile, api });

      const fillBtn = await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
      await act(async () => {
        await userEvent.click(fillBtn);
      });

      expect(attachFile).not.toHaveBeenCalled();
      expect(api.postReport).toHaveBeenCalledWith(
        "t1",
        expect.arrayContaining([
          expect.objectContaining({ fieldId: "r1", outcome: "needs-user", reason: RENDER_FAILED_REASON }),
        ]),
        false,
      );
    });

    it("a content-script send that rejects (torn-down/invalidated context) reports needs-user with the custom-uploader reason and still posts the report", async () => {
      const api: FillApi = {
        ...emptyApi(),
        getPending: vi.fn(async () => ({ ok: true as const, value: [ticket] })),
        claim: vi.fn(async () => ({ ok: true as const, value: { ...bundle, attachResume: "tailored" as const } })),
        fetchArtifactPdf: vi.fn(async () => pdfBytes()),
      };
      renderPanel({
        scan: async () => scanWithResumeFile,
        api,
        attachFile: vi.fn(async () => {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }),
      });

      const fillBtn = await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
      await act(async () => {
        await userEvent.click(fillBtn);
      });

      expect(api.postReport).toHaveBeenCalledWith(
        "t1",
        expect.arrayContaining([
          expect.objectContaining({ fieldId: "r1", outcome: "needs-user", reason: CUSTOM_UPLOADER_REASON }),
        ]),
        false,
      );
    });

    it("cover-letter file field only attaches when the bundle carries a confirmed cover letter", async () => {
      const api: FillApi = {
        ...emptyApi(),
        getPending: vi.fn(async () => ({ ok: true as const, value: [ticket] })),
        claim: vi.fn(async () => ({
          ok: true as const,
          value: { ...bundle, attachResume: "tailored" as const, coverLetterText: null },
        })),
        fetchArtifactPdf: vi.fn(async () => pdfBytes()),
      };
      const { attachFile } = renderPanel({ scan: async () => scanWithBothFiles, api });

      const fillBtn = await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
      await act(async () => {
        await userEvent.click(fillBtn);
      });

      // résumé attached (tailored), but the cover-letter route/attach never fired.
      expect(api.fetchArtifactPdf).toHaveBeenCalledWith("t1", "resume");
      expect(api.fetchArtifactPdf).not.toHaveBeenCalledWith("t1", "cover-letter");
      expect(attachFile).toHaveBeenCalledTimes(1);
    });

    it("attaches a confirmed cover letter as a cover-letter-file PDF", async () => {
      const api: FillApi = {
        ...emptyApi(),
        getPending: vi.fn(async () => ({ ok: true as const, value: [ticket] })),
        claim: vi.fn(async () => ({
          ok: true as const,
          value: { ...bundle, attachResume: "tailored" as const, coverLetterText: "Dear hiring team," },
        })),
        fetchArtifactPdf: vi.fn(async (_taskId: string, kind: "resume" | "cover-letter") =>
          kind === "cover-letter"
            ? { ok: true as const, bytes: new Uint8Array([1]).buffer, fileName: "Cover_Letter.pdf", mimeType: "application/pdf" }
            : pdfBytes(),
        ),
      };
      renderPanel({ scan: async () => scanWithBothFiles, api });

      const fillBtn = await screen.findByRole("button", { name: /^Fill \d+ fields?$/ });
      await act(async () => {
        await userEvent.click(fillBtn);
      });

      expect(api.fetchArtifactPdf).toHaveBeenCalledWith("t1", "cover-letter");
      expect(api.postReport).toHaveBeenCalledWith(
        "t1",
        expect.arrayContaining([
          expect.objectContaining({
            fieldId: "cl1",
            outcome: "filled",
            source: "cover-letter-file",
            value: "Cover_Letter.pdf",
          }),
        ]),
        false,
      );
    });
  });

  describe("Add this job", () => {
    it("is hidden when the web app is unreachable", async () => {
      renderPanel({ webReachable: false });
      await screen.findByText("No fill task for this page. Start one from the OfferOS workspace.");
      expect(screen.queryByRole("button", { name: "Add this job" })).not.toBeInTheDocument();
    });

    it("captures the JD and shows an editable confirm card pre-filled from structured fields", async () => {
      const { capture } = renderPanel();
      const addBtn = await screen.findByRole("button", { name: "Add this job" });
      await userEvent.click(addBtn);

      expect(capture).toHaveBeenCalledTimes(1);
      expect(await screen.findByLabelText("Job title")).toHaveValue("Backend Engineer");
      expect(screen.getByLabelText("Company")).toHaveValue("Acme");
      expect(screen.getByText(`${captureOk.jd.length} characters captured`)).toBeInTheDocument();

      const titleInput = screen.getByLabelText("Job title");
      await userEvent.clear(titleInput);
      await userEvent.type(titleInput, "Staff Engineer");
      expect(titleInput).toHaveValue("Staff Engineer");
    });

    it("shows the none-state message with no Create button when source is none", async () => {
      renderPanel({ capture: vi.fn(async () => ({ ...captureOk, jd: "", source: "none", structuredTitle: undefined, structuredCompany: undefined })) });
      await userEvent.click(await screen.findByRole("button", { name: "Add this job" }));

      expect(
        await screen.findByText("Couldn't read a posting here — open the job posting page."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();
    });

    it("falls back to the sanitized page-meta guess when there are no structured fields (DOM fallback)", async () => {
      renderPanel({
        capture: vi.fn(async () => ({
          ...captureOk,
          source: "dom",
          structuredTitle: undefined,
          structuredCompany: undefined,
          metaTitle: "Backend Engineer — Acme Careers",
          metaCompany: "Acme Corp",
        })),
      });
      await userEvent.click(await screen.findByRole("button", { name: "Add this job" }));

      expect(await screen.findByLabelText("Job title")).toHaveValue("Backend Engineer — Acme Careers");
      expect(screen.getByLabelText("Company")).toHaveValue("Acme Corp");
    });

    it("leaves the inputs blank when neither structured nor meta fields are present", async () => {
      renderPanel({
        capture: vi.fn(async () => ({
          ...captureOk,
          source: "dom",
          structuredTitle: undefined,
          structuredCompany: undefined,
          metaTitle: "",
          metaCompany: "",
        })),
      });
      await userEvent.click(await screen.findByRole("button", { name: "Add this job" }));

      expect(await screen.findByLabelText("Job title")).toHaveValue("");
      expect(screen.getByLabelText("Company")).toHaveValue("");
    });

    it("dedups by job URL: Create checks first, then renders Open existing + Create anyway", async () => {
      const existing: ApplicationSummary = { id: "existing-1", jobInfo: { jobTitle: "Backend Engineer", companyName: "Acme", applyLink: captureOk.url } };
      const api: FillApi = {
        ...emptyApi(),
        findApplicationsByJobUrl: vi.fn(async () => ({ ok: true as const, value: [existing] })),
      };
      const { openApplication } = renderPanel({ api });
      await userEvent.click(await screen.findByRole("button", { name: "Add this job" }));
      await screen.findByLabelText("Job title");
      await userEvent.click(screen.getByRole("button", { name: "Create" }));

      expect(api.findApplicationsByJobUrl).toHaveBeenCalledWith(captureOk.url);
      expect(await screen.findByText("Already tracked.")).toBeInTheDocument();
      expect(api.createTaskFromJd).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: "Open existing" }));
      expect(openApplication).toHaveBeenCalledWith("existing-1");

      await userEvent.click(screen.getByRole("button", { name: "Create anyway" }));
      expect(api.createTaskFromJd).toHaveBeenCalledTimes(1);
    });

    it("creates with a POST shape carrying edited title/company + captured JD, then offers Open in OfferOS", async () => {
      const api: FillApi = {
        ...emptyApi(),
        createTaskFromJd: vi.fn(async () => ({ ok: true as const, value: { id: "t9", applicationId: "a9" } })),
      };
      const { openApplication } = renderPanel({ api });
      await userEvent.click(await screen.findByRole("button", { name: "Add this job" }));
      const titleInput = await screen.findByLabelText("Job title");
      await userEvent.clear(titleInput);
      await userEvent.type(titleInput, "Staff Engineer");

      await userEvent.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(api.createTaskFromJd).toHaveBeenCalledTimes(1));
      expect(api.createTaskFromJd).toHaveBeenCalledWith({
        jobTitle: "Staff Engineer",
        companyName: "Acme",
        jobUrl: captureOk.url,
        jdText: captureOk.jd,
      });

      const openBtn = await screen.findByRole("button", { name: "Open in OfferOS" });
      await userEvent.click(openBtn);
      expect(openApplication).toHaveBeenCalledWith("a9");
    });

    it("the dedup card's Back control dismisses it back to the initial Add-this-job state", async () => {
      const existing: ApplicationSummary = { id: "existing-1", jobInfo: { jobTitle: "Backend Engineer", companyName: "Acme", applyLink: captureOk.url } };
      const api: FillApi = {
        ...emptyApi(),
        findApplicationsByJobUrl: vi.fn(async () => ({ ok: true as const, value: [existing] })),
      };
      renderPanel({ api });
      await userEvent.click(await screen.findByRole("button", { name: "Add this job" }));
      await screen.findByLabelText("Job title");
      await userEvent.click(screen.getByRole("button", { name: "Create" }));
      await screen.findByText("Already tracked.");

      await userEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(await screen.findByRole("button", { name: "Add this job" })).toBeInTheDocument();
      expect(screen.queryByText("Already tracked.")).not.toBeInTheDocument();
    });

    it("the success card's Done control dismisses it back to the initial Add-this-job state", async () => {
      renderPanel();
      await userEvent.click(await screen.findByRole("button", { name: "Add this job" }));
      await screen.findByLabelText("Job title");
      await userEvent.click(screen.getByRole("button", { name: "Create" }));
      await screen.findByText("Added — tracked in OfferOS.");

      await userEvent.click(screen.getByRole("button", { name: "Done" }));

      expect(await screen.findByRole("button", { name: "Add this job" })).toBeInTheDocument();
      expect(screen.queryByText("Added — tracked in OfferOS.")).not.toBeInTheDocument();
    });

    it("resets to the initial Add-this-job state when the tab navigates to a different job", async () => {
      let scanResp: ScanResponse = scanOk;
      let tabUrl = scanOk.url;
      const scan = async () => scanResp;
      const fill = vi.fn(async (v: FillValue[]) => okFill(v));
      const capture = vi.fn(async () => captureOk);
      const api = emptyApi();
      const renderProps = (nonce: number) => (
        <FillPanel
          scan={scan}
          fill={fill}
          capture={capture}
          attachFile={vi.fn(okAttach)}
          api={api}
          rescanNonce={nonce}
          openWebApp={vi.fn()}
          openApplication={vi.fn()}
          webReachable
          tabUrl={tabUrl}
        />
      );
      const { rerender } = render(renderProps(0));

      // Add job A all the way to the success card.
      await userEvent.click(await screen.findByRole("button", { name: "Add this job" }));
      await screen.findByLabelText("Job title");
      await userEvent.click(screen.getByRole("button", { name: "Create" }));
      await screen.findByText("Added — tracked in OfferOS.");

      // Same tab navigates to a different Greenhouse job (new job id) → rescan.
      tabUrl = "https://boards.greenhouse.io/acme/jobs/2";
      scanResp = { ...scanOk, url: tabUrl, title: "Other Role" };
      rerender(renderProps(1));

      // The stale "Added" card must not survive into the new job.
      expect(await screen.findByRole("button", { name: "Add this job" })).toBeInTheDocument();
      expect(screen.queryByText("Added — tracked in OfferOS.")).not.toBeInTheDocument();
    });
  });
});
