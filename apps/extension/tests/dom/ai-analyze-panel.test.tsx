// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FillPanel, type FillApi } from "../../src/sidepanel/fill-panel";
import type {
  ScanResponse,
  FillResponse,
  CaptureJdResponse,
} from "../../src/lib/autofill/autofill-messaging";
import type { FillValue } from "../../src/lib/autofill/dom-fill";
import type {
  AnalyzedField,
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
 * Handing the leftovers to the agent.
 *
 * The lane this replaces asked a model "which canonical field name is this?"
 * and showed it nothing about the applicant. On a real application it placed 8
 * of 72 fields — the honest ceiling of the question it was asked. The agent
 * gets the profile, the résumé, the job description and the saved answers, and
 * what it returns is a suggestion the applicant reads and approves, not a value
 * written behind their back.
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
  job: { title: "Ingenieur", company: "Acme" },
};

const captureOk: CaptureJdResponse = {
  jd: "jd",
  source: "body",
  metaCompany: "Acme",
  metaTitle: "Ingenieur",
  url: "https://ats.example.com/apply",
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
  atsId: "generic",
  url: "https://ats.example.com/apply",
  company: "Acme",
  title: "Ingenieur",
  descriptors: [
    field("f1", "Which of your projects is most relevant to this role?", "textarea"),
    field("f2", "Most recent employer"),
    field("f3", "Are you legally authorized to work in the United States?"),
  ],
};

const suggestions: AnalyzedField[] = [
  {
    fieldId: "f1",
    value: "I led an ingestion rewrite that cut nightly batch latency by 40%.",
    source: "agent",
    reason: "your résumé describes this under your most recent job",
  },
  {
    fieldId: "f2",
    value: "Northwind Systems",
    source: "agent",
    reason: "your most recent job in your profile",
  },
  {
    fieldId: "f3",
    value: null,
    source: "agent",
    needsUser: true,
    reason: "This is a legal statement only you can make.",
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
  analyzeFields: vi.fn(async () => ({
    ok: true as const,
    value: { fields: suggestions, summary: "Looked at 3 fields, answered 2." },
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
  ...over,
});

async function mount(used = api(), fill = vi.fn(async (v: FillValue[]) => okFill(v))) {
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
      tabUrl="https://ats.example.com/apply"
    />,
  );
  await screen.findByText("Ingenieur · Acme");
  return { used, fill };
}

const analyseButton = () => screen.findByRole("button", { name: /AI analyse the remaining/ });

describe("the entry point", () => {
  it("offers to analyse what is left, and says how many", async () => {
    await mount();
    expect(await analyseButton()).toBeTruthy();
    expect(await screen.findByText(/3 fields left for you\./)).toBeTruthy();
  });

  it("marks it as spending the applicant's own credit", async () => {
    await mount();
    expect((await analyseButton()).getAttribute("title")).toContain("your own API key");
  });

  it("sends the outstanding fields with what the page knows about them", async () => {
    const { used } = await mount();
    await act(async () => {
      await userEvent.click(await analyseButton());
    });
    const [taskId, body] = (used.analyzeFields as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0] as [string, { handoffId?: string; fields: { fieldId: string }[] }];
    expect(taskId).toBe("t1");
    expect(body.handoffId).toBe("h1");
    expect(body.fields.map((f) => f.fieldId).sort()).toEqual(["f1", "f2", "f3"]);
  });

  it("never runs on its own", async () => {
    const { used } = await mount();
    expect(used.analyzeFields).not.toHaveBeenCalled();
  });
});

describe("what comes back", () => {
  const analysed = async () => {
    const mounted = await mount();
    await act(async () => {
      await userEvent.click(await analyseButton());
    });
    return mounted;
  };

  it("shows each suggestion with the reason it rests on", async () => {
    await analysed();
    expect(await screen.findByText("Northwind Systems")).toBeTruthy();
    expect(screen.getByText(/your most recent job in your profile/)).toBeTruthy();
    expect(screen.getByText(/your résumé describes this/)).toBeTruthy();
  });

  it("writes nothing until the applicant applies it", async () => {
    const { fill } = await analysed();
    expect(fill).not.toHaveBeenCalled();
  });

  it("applies one suggestion through the ordinary verified write", async () => {
    const { fill, used } = await analysed();
    const row = (await screen.findByText("Northwind Systems")).closest("li")!;
    await act(async () => {
      await userEvent.click(within(row).getByRole("button", { name: "Apply" }));
    });
    expect(fill.mock.calls.flatMap((c) => c[0])).toEqual(
      expect.arrayContaining([{ fieldId: "f2", value: "Northwind Systems" }]),
    );
    expect(used.postReport).toHaveBeenCalled();
  });

  it("records the applied field as the agent's, with its reason", async () => {
    const { used } = await analysed();
    const row = (await screen.findByText("Northwind Systems")).closest("li")!;
    await act(async () => {
      await userEvent.click(within(row).getByRole("button", { name: "Apply" }));
    });
    const calls = (used.postReport as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const reports = calls.at(-1)![1] as FieldReport[];
    const applied = reports.find((r) => r.fieldId === "f2")!;
    expect(applied.source).toBe("agent");
    expect(applied.outcome).toBe("filled");
    expect(applied.reason).toContain("your most recent job");
  });

  it("applies every suggestion at once when asked", async () => {
    const { fill } = await analysed();
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Apply all" }));
    });
    const written = fill.mock.calls.flatMap((c) => c[0]).map((w) => w.fieldId);
    expect(written).toContain("f1");
    expect(written).toContain("f2");
    // The guarded one has no value, so it is not among them.
    expect(written).not.toContain("f3");
  });

  it("forgets every suggestion when the tab moves to a different job", async () => {
    // A suggestion is grounded in ONE job's description, and fieldId is a
    // content hash — two companies on the same ATS template share ids. A
    // suggestion that survived a job change could be applied, verbatim, to
    // the wrong company's form.
    const used = api();
    const fill = vi.fn(async (v: FillValue[]) => okFill(v));
    const props = {
      fill,
      capture: vi.fn(async () => captureOk),
      attachFile: vi.fn(async () => ({ ok: true })),
      api: used,
      openWebApp: vi.fn(),
      openApplication: vi.fn(),
      webReachable: true,
      tabUrl: "https://ats.example.com/apply",
    };
    const view = render(<FillPanel scan={async () => scan} rescanNonce={0} {...props} />);
    await screen.findByText("Ingenieur · Acme");
    await act(async () => {
      await userEvent.click(await analyseButton());
    });
    await screen.findByText("Northwind Systems");
    view.rerender(
      <FillPanel scan={async () => ({ ...scan, company: "Globex" })} rescanNonce={1} {...props} />,
    );
    await waitFor(() => expect(screen.queryByText("Northwind Systems")).toBeNull());
    expect(fill).not.toHaveBeenCalled();
  });

  it("lets a suggestion be ignored without writing it", async () => {
    const { fill } = await analysed();
    const row = (await screen.findByText("Northwind Systems")).closest("li")!;
    await act(async () => {
      await userEvent.click(within(row).getByRole("button", { name: "Ignore" }));
    });
    expect(screen.queryByText("Northwind Systems")).toBeNull();
    expect(fill).not.toHaveBeenCalled();
  });

  it("says plainly which questions are the applicant's, with no Apply", async () => {
    await analysed();
    const row = (await screen.findByText(/only you can make/)).closest("li")!;
    expect(within(row).queryByRole("button", { name: "Apply" })).toBeNull();
    expect(within(row).getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("shows a refusal from the server instead of looking like it worked", async () => {
    await mount(
      api({
        analyzeFields: vi.fn(async () => ({
          ok: false as const,
          error: "No AI provider connected",
        })),
      }),
    );
    await act(async () => {
      await userEvent.click(await analyseButton());
    });
    expect(await screen.findByText("No AI provider connected")).toBeTruthy();
  });
});

/**
 * Drafting one long answer at a time.
 *
 * A free-text question is the one kind worth its own button: it costs real
 * minutes to write by hand, and the applicant usually has something specific
 * they want emphasised. Their instruction is theirs, so it reaches the model
 * without being fenced off as untrusted page text.
 */
describe("drafting one field", () => {
  const runFill = async (used = api()) => mount(used);

  it("offers a draft button beside a long-text question", async () => {
    await runFill();
    expect(await screen.findByText("Written answers")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Draft it/ })).toBeTruthy();
  });

  it("marks it as spending the applicant's own credit", async () => {
    await runFill();
    const btn = await screen.findByRole("button", { name: /Draft it/ });
    expect(btn.getAttribute("title")).toContain("your own API key");
  });

  it("sends only that field, with the applicant's instruction", async () => {
    const used = api();
    await runFill(used);
    const hint = await screen.findByRole("textbox", { name: /What should this answer emphasise/ });
    await act(async () => {
      await userEvent.type(hint, "emphasise my Docker experience");
      await userEvent.click(screen.getByRole("button", { name: /Draft it/ }));
    });
    const [, body] = (used.analyzeFields as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0] as [string, { fields: { fieldId: string }[]; instruction?: string }];
    expect(body.fields.map((f) => f.fieldId)).toEqual(["f1"]);
    expect(body.instruction).toBe("emphasise my Docker experience");
  });

  it("gives a guarded question no AI button at all", async () => {
    // "Only you can answer this" is the whole offer for these.
    await runFill();
    // The work-authorization question is not offered a draft anywhere.
    const drafts = screen
      .getAllByRole("listitem")
      .filter((r) => within(r).queryByRole("button", { name: /Draft it/ }));
    expect(drafts.length).toBeGreaterThan(0);
    for (const row of drafts) {
      expect(row.textContent).not.toContain("Are you legally authorized to work");
    }
  });
});
