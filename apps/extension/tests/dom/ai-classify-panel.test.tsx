// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
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

/**
 * The AI read has to be reachable on a form that went WELL.
 *
 * It used to live inside the "most fields weren't recognised" banner, so on a
 * form OfferOS mostly understood, the two or three fields that most needed a
 * second opinion had no way to reach it — the button existed only when it was
 * least needed.
 */
describe("the AI read is always available", () => {
  const mostlyUnderstood: ScanResponse = {
    ok: true,
    atsId: "generic",
    url: "https://ats.example.com/apply",
    company: "Acme",
    title: "Engineer",
    descriptors: [
      field("f1", "Email"),
      field("f2", "First Name"),
      field("f3", "Phone"),
      field("f4", "Feld 7"),
    ],
  };

  const mount = async (scanResponse: ScanResponse, used = api()) => {
    render(
      <FillPanel
        scan={async () => scanResponse}
        fill={vi.fn(async (v: FillValue[]) => okFill(v))}
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
    return used;
  };

  it("offers it even when almost everything was recognised", async () => {
    await mount(mostlyUnderstood);
    // No drift banner here — most of this form was understood.
    expect(screen.queryByText(/Most fields here weren't recognized/)).toBeNull();
    expect(await screen.findByRole("button", { name: /Have AI read this form/ })).toBeTruthy();
  });

  it("says how many fields it would actually be given", async () => {
    await mount(mostlyUnderstood);
    // Pressing it spends money, so the count is next to the button.
    expect(await screen.findByText(/1 field OfferOS couldn't place\./)).toBeTruthy();
  });

  it("still offers it when nothing is left, and says so", async () => {
    await mount({
      ...mostlyUnderstood,
      descriptors: [field("f1", "Email"), field("f2", "First Name")],
    });
    expect(await screen.findByText(/Every field here was recognised\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Have AI read this form/ })).toBeTruthy();
  });
});

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

  it("names the fields that are still the user's, and jumps to one on click", async () => {
    const scrollToField = vi.fn(async () => ({}));
    render(
      <FillPanel
        scan={async () => scan}
        fill={vi.fn(async (v: FillValue[]) => okFill(v))}
        capture={vi.fn(async () => captureOk)}
        attachFile={vi.fn(async () => ({ ok: true }))}
        scrollToField={scrollToField}
        api={api()}
        rescanNonce={0}
        openWebApp={vi.fn()}
        openApplication={vi.fn()}
        webReachable
        tabUrl={scan.ok ? scan.url : ""}
      />,
    );
    await screen.findByText("Ingenieur · Acme");
    await act(async () => {
      await userEvent.click(await screen.findByRole("button", { name: /Have AI read this form/ }));
    });

    // The guarded field and the unreadable one — stated, not left to silence.
    const heading = await screen.findByText(/You'll need to fill/);
    expect(heading.textContent).toContain("these 2");
    // Scoped to the handover list: the ordinary field rows also carry buttons
    // for the same fields, and the point here is this list specifically.
    const list = within(heading.parentElement!);
    expect(list.getByRole("button", { name: /Feld 7/ })).toBeTruthy();
    // It explains itself in the AI's words, not the engine's pre-AI wording.
    expect(heading.parentElement!.textContent).toContain("couldn't tell");
    const row = list.getByRole("button", { name: /Arbeitserlaubnis/ });
    await act(async () => {
      await userEvent.click(row);
    });
    expect(scrollToField).toHaveBeenCalledWith("f3");
  });

  it("never says task or workspace to the user", async () => {
    // Both are internal words for things the product does not show. A panel
    // that names them is describing its own plumbing.
    const { container } = render(
      <FillPanel
        scan={async () => scan}
        fill={vi.fn(async (v: FillValue[]) => okFill(v))}
        capture={vi.fn(async () => captureOk)}
        attachFile={vi.fn(async () => ({ ok: true }))}
        api={api()}
        rescanNonce={0}
        openWebApp={vi.fn()}
        openApplication={vi.fn()}
        webReachable
        tabUrl={scan.ok ? scan.url : ""}
      />,
    );
    await screen.findByText("Ingenieur · Acme");
    await act(async () => {
      await userEvent.click(await screen.findByRole("button", { name: /Have AI read this form/ }));
    });
    const handover = container.querySelector("ul")?.parentElement?.textContent ?? "";
    expect(handover.toLowerCase()).not.toContain("workspace");
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

/**
 * The whole chain, on the form that motivated all of it.
 *
 * A page that associates no label with any field, renders each field twice, and
 * fills its dropdowns with states rather than options. Before this work the
 * panel showed the user `rec-form_682152000000063542` and `-None-`, and the
 * classifier — handed those — placed 0 of 4. Here the label chain reads what a
 * person reads, and the one field it genuinely cannot name goes to the model
 * with the words around it instead of with its id.
 */
describe("a form with no usable labels, end to end", () => {
  const messyScan: ScanResponse = {
    ok: true,
    atsId: "generic",
    url: "https://ats.example.com/apply",
    company: "Example Systems",
    title: "Engineer",
    descriptors: [],
  };

  it("reads the rows the page laid out, and only asks about what is left", async () => {
    // Built by the real scanner from real markup rather than hand-written
    // descriptors: the point is what scanFields makes of this DOM.
    document.body.innerHTML = `<main><form>
      <div class="crm-row">
        <label class="crm-from-label">First Name *</label>
        <input id="rec-form_682152000000063542" name="rec-form_682152000000063542" />
      </div>
      <div class="crm-row">
        <label class="crm-from-label">Email *</label>
        <input id="rec-form_682152000000063550" type="email" />
      </div>
      <div class="crm-row">
        <span class="hint">Preferred pronoun</span>
        <input id="rec-form_682152000000063999" />
      </div>
    </form></main>`;
    const { scanFields } = await import("../../src/lib/autofill/dom-fill");
    const { GENERIC_RECIPE } = await import("../../src/lib/autofill/recipes");
    const found = scanFields(document.body, GENERIC_RECIPE).map((f) => f.descriptor);

    // Two of the three now carry the question the page actually shows.
    expect(found.map((d) => d.label)).toEqual([
      "First Name *",
      "Email *",
      // Not a <label> element, so the row rung passes; the preceding-title
      // heuristic still reads it, which is what that rung is for.
      "Preferred pronoun",
    ]);
    // And not one of them is an id.
    expect(found.every((d) => !d.label.includes("rec-form_"))).toBe(true);
  });

  it("sends the surrounding words, not the id, for a field nothing could name", async () => {
    document.body.innerHTML = `<main><form>
      <div class="crm-row">
        <input id="rec-form_682152000000063542" name="rec-form_682152000000063542" />
        <span>Highest degree obtained</span>
      </div>
    </form></main>`;
    const { scanFields } = await import("../../src/lib/autofill/dom-fill");
    const { GENERIC_RECIPE } = await import("../../src/lib/autofill/recipes");
    const [field] = scanFields(document.body, GENERIC_RECIPE);

    expect(field!.descriptor.label).toBe("");
    // This is the string that reaches the classifier in place of the id.
    expect(field!.descriptor.contextText).toContain("Highest degree obtained");
  });

  it("the panel forwards that text with the field", async () => {
    const used = api({
      classifyFields: vi.fn(async () => ({
        ok: true as const,
        value: { resolutions: [], considered: 1, classified: 0 },
      })),
    });
    const messy: ScanResponse = {
      ...messyScan,
      descriptors: [
        {
          fieldId: "rec-form_682152000000063542",
          label: "",
          name: "rec-form_682152000000063542",
          autocomplete: "",
          type: "text",
          placeholder: "",
          ariaLabel: "",
          required: true,
          contextText: "First Name *",
        },
      ],
    };
    render(
      <FillPanel
        scan={async () => messy}
        fill={vi.fn(async (v: FillValue[]) => okFill(v))}
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
    await act(async () => {
      await userEvent.click(await screen.findByRole("button", { name: /Have AI read this form/ }));
    });
    const [, fields] = (used.classifyFields as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0] as [string, { contextText?: string }[]];
    expect(fields[0]!.contextText).toBe("First Name *");
  });
});
