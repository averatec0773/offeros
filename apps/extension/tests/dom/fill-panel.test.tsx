// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FillPanel, type FillApi } from "../../src/sidepanel/fill-panel";
import type { ScanResponse, FillResponse } from "../../src/lib/autofill/autofill-messaging";
import type { FillValue } from "../../src/lib/autofill/dom-fill";
import type { ApiResult, FillTaskBundle, FillTicket } from "../../src/lib/offeros-api";

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
});

const renderPanel = (over: { scan?: () => Promise<ScanResponse>; fill?: (v: FillValue[]) => Promise<FillResponse>; api?: FillApi; openWebApp?: () => void } = {}) => {
  const fill = over.fill ?? vi.fn(async (v: FillValue[]) => okFill(v));
  const api = over.api ?? emptyApi();
  const openWebApp = over.openWebApp ?? vi.fn();
  render(
    <FillPanel
      scan={over.scan ?? (async () => scanOk)}
      fill={fill}
      api={api}
      rescanNonce={0}
      openWebApp={openWebApp}
    />,
  );
  return { fill, api, openWebApp };
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
      getPending: vi.fn(async (): Promise<ApiResult<FillTicket[]>> => ({ ok: true, value: [ticket] })),
      claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
      postReport: vi.fn(async () => ({ ok: true as const, value: {} })),
      generateAnswer: vi.fn(async () => ({ ok: true as const, value: { answer: "" } })),
    };
    const { container } = render(
      <FillPanel scan={async () => scanOk} fill={vi.fn(async (v: FillValue[]) => okFill(v))} api={api} rescanNonce={0} openWebApp={vi.fn()} />,
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
      getPending: vi.fn(async () => tickets),
      claim: vi.fn(async (): Promise<ApiResult<FillTaskBundle>> => ({ ok: true, value: bundle })),
      postReport: vi.fn(async () => ({ ok: true as const, value: {} })),
      generateAnswer: vi.fn(async () => ({ ok: true as const, value: { answer: "" } })),
    };
    const scan = async () => scanOk;
    const fill = vi.fn(async (v: FillValue[]) => okFill(v));
    const { rerender } = render(
      <FillPanel scan={scan} fill={fill} api={api} rescanNonce={0} openWebApp={vi.fn()} />,
    );
    await screen.findByText("No fill task for this page. Start one from the OfferOS workspace.");
    expect(api.claim).not.toHaveBeenCalled();

    // Web app comes back with a matching ticket + App forces a rescan (rescanNonce bump).
    tickets = { ok: true, value: [ticket] };
    rerender(<FillPanel scan={scan} fill={fill} api={api} rescanNonce={1} openWebApp={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Fill 1 field" })).toBeInTheDocument();
    expect(api.claim).toHaveBeenCalledWith("h1");
  });
});
