// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FillPanel, type FillApi } from "../../src/sidepanel/fill-panel";
import type { ScanResponse, FillResponse, CaptureJdResponse } from "../../src/lib/autofill/autofill-messaging";
import type { FillValue } from "../../src/lib/autofill/dom-fill";
import type { ApiResult, ApplicationSummary, FillTaskBundle, FillTicket } from "../../src/lib/offeros-api";

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

const bundle: FillTaskBundle = {
  handoffId: "h1",
  taskId: "t1",
  applicationId: "a1",
  job: { title: "Engineer", company: "Acme" },
  fillProfile: { personal: { name: "Jordan Rivera", email: "a@b.com", phone: "", address: "", links: {} }, skills: [], answerBank: [] },
  resumeText: null,
  coverLetterText: null,
  jdSummary: null,
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
});

const captureOk: CaptureJdResponse = {
  jd: "We are hiring a senior engineer to build reliable backend services.",
  source: "jsonld",
  company: "Acme",
  title: "Backend Engineer",
  url: scanOk.url,
  structuredTitle: "Backend Engineer",
  structuredCompany: "Acme",
};

const renderPanel = (
  over: {
    scan?: () => Promise<ScanResponse>;
    fill?: (v: FillValue[]) => Promise<FillResponse>;
    capture?: () => Promise<CaptureJdResponse>;
    api?: FillApi;
    openWebApp?: () => void;
    openApplication?: (id: string) => void;
    webReachable?: boolean;
  } = {},
) => {
  const fill = over.fill ?? vi.fn(async (v: FillValue[]) => okFill(v));
  const capture = over.capture ?? vi.fn(async () => captureOk);
  const api = over.api ?? emptyApi();
  const openWebApp = over.openWebApp ?? vi.fn();
  const openApplication = over.openApplication ?? vi.fn();
  render(
    <FillPanel
      scan={over.scan ?? (async () => scanOk)}
      fill={fill}
      capture={capture}
      api={api}
      rescanNonce={0}
      openWebApp={openWebApp}
      openApplication={openApplication}
      webReachable={over.webReachable ?? true}
    />,
  );
  return { fill, capture, api, openWebApp, openApplication };
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
    expect(screen.getByText("Because I build compilers.")).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Done — report to workspace" }));
    });
    expect(api.postReport).toHaveBeenLastCalledWith("t1", expect.any(Array), true);
    expect(await screen.findByText("Reported — check the workspace.")).toBeInTheDocument();
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
        api={api}
        rescanNonce={0}
        openWebApp={vi.fn()}
        openApplication={vi.fn()}
        webReachable
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
        api={api}
        rescanNonce={0}
        openWebApp={vi.fn()}
        openApplication={vi.fn()}
        webReachable
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
        api={api}
        rescanNonce={1}
        openWebApp={vi.fn()}
        openApplication={vi.fn()}
        webReachable
      />,
    );
    expect(await screen.findByRole("button", { name: "Fill 1 field" })).toBeInTheDocument();
    expect(api.claim).toHaveBeenCalledWith("h1");
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

    it("leaves the inputs blank when there are no structured fields (DOM fallback)", async () => {
      renderPanel({
        capture: vi.fn(async () => ({ ...captureOk, source: "dom", structuredTitle: undefined, structuredCompany: undefined })),
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
  });
});
