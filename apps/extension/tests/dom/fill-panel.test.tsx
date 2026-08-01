// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
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
    api?: FillApi;
    openWebApp?: () => void;
    openApplication?: (id: string) => void;
    webReachable?: boolean;
    tabUrl?: string;
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
      api={api}
      rescanNonce={0}
      openWebApp={openWebApp}
      openApplication={openApplication}
      webReachable={over.webReachable ?? true}
      tabUrl={over.tabUrl ?? scanOk.url}
    />,
  );
  return { fill, capture, attachFile, api, openWebApp, openApplication };
};

describe("FillPanel", () => {
  it("shows the scanning placeholder while the scan is in flight", () => {
    renderPanel({ scan: () => new Promise(() => {}) });
    expect(screen.getByText("Scanning this page…")).toBeInTheDocument();
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

  it("not_supported scan never renders Add-this-job", async () => {
    renderPanel({ scan: async () => ({ ok: false, reason: "not_supported" }) });
    await screen.findByText("Not an application form");
    expect(screen.queryByRole("button", { name: "Add this job" })).not.toBeInTheDocument();
  });

  it("with no claimable task shows the no-task hint and opens the web app", async () => {
    const { openWebApp } = renderPanel();
    expect(await screen.findByText("No fill task for this page. Start one from the OfferOS workspace.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open OfferOS" }));
    expect(openWebApp).toHaveBeenCalledTimes(1);
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
    const fillBtn = await screen.findByRole("button", { name: "Fill 1 field" });
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
      const fillBtn = await screen.findByRole("button", { name: "Fill 1 field" });
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
    await screen.findByText("No fill task for this page. Start one from the OfferOS workspace.");
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
    const fillBtn = await screen.findByRole("button", { name: "Fill 1 field" });
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
    await screen.findByText("No fill task for this page. Start one from the OfferOS workspace.");
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
    expect(await screen.findByRole("button", { name: "Fill 1 field" })).toBeInTheDocument();
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

      const fillBtn = await screen.findByRole("button", { name: "Fill 1 field" });
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

      const fillBtn = await screen.findByRole("button", { name: "Fill 1 field" });
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

      const fillBtn = await screen.findByRole("button", { name: "Fill 1 field" });
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

      const fillBtn = await screen.findByRole("button", { name: "Fill 1 field" });
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

      const fillBtn = await screen.findByRole("button", { name: "Fill 1 field" });
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

      const fillBtn = await screen.findByRole("button", { name: "Fill 1 field" });
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

      const fillBtn = await screen.findByRole("button", { name: "Fill 1 field" });
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

      const fillBtn = await screen.findByRole("button", { name: "Fill 1 field" });
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

      const fillBtn = await screen.findByRole("button", { name: "Fill 1 field" });
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
