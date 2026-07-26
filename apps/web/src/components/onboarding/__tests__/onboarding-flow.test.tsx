// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { profileSchema, type Profile, type Settings } from "@offeros/core";
import type { ParsedResume } from "@offeros/llm";
import { OnboardingFlow, mapParsedToProfile } from "../onboarding-flow";
import { api, ApiError } from "@/lib/api-client";
import { extractPdfText } from "@offeros/pdf";

vi.mock("@/lib/pdf-worker", () => ({ ensurePdfWorker: vi.fn() }));

vi.mock("@offeros/pdf", () => ({ extractPdfText: vi.fn() }));

// Preserve the real ApiError class and isLlmNotConfigured so 42000 detection
// works against genuine ApiError instances constructed in these tests.
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      profile: { parseResume: vi.fn(), save: vi.fn() },
      resumes: { upload: vi.fn() },
      settings: { get: vi.fn(), llmKeys: vi.fn() },
    },
  };
});

function settings(provider: "anthropic" | "openai" = "anthropic"): Settings {
  return {
    agent: {
      enableCustomizeResume: true,
      enableCustomizeCoverLetter: true,
      useOriginalResume: false,
      autoConfirm: false,
    },
    llm: { provider, promptOverrides: {}, modelOverrides: {}, apiKeys: {} },
  };
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  // Default: a key is configured, so the pre-check card stays hidden unless a
  // test explicitly overrides these to simulate "none".
  vi.mocked(api.settings.get).mockResolvedValue(settings());
  vi.mocked(api.settings.llmKeys).mockResolvedValue({ anthropic: "env" });
});

function parsed(overrides: Partial<ParsedResume> = {}): ParsedResume {
  return {
    personal: {
      name: "Ada Lovelace",
      email: "ada@x.io",
      phone: "555-0100",
      address: "London",
      linkedin: "linkedin.com/in/ada",
      github: "github.com/ada",
      portfolio: "",
    },
    education: [
      { school: "Cambridge", degree: "BSc", field: "Maths", gpa: "", start: "1830", end: "1834" },
    ],
    experience: [
      {
        company: "Analytical Engine",
        title: "Programmer",
        start: "1840",
        end: "1843",
        bullets: ["Wrote the first algorithm"],
      },
    ],
    skills: ["Analysis", "Poetry"],
    confidence: { personal: 1, education: 1, experience: 1, skills: 1 },
    ...overrides,
  };
}

function pdfFile(name = "resume.pdf", type = "application/pdf"): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
}

/** A PDF File whose reported `size` is over the 10 MB client-side limit,
 *  without actually allocating 10 MB of bytes. */
function oversizePdfFile(name = "huge.pdf"): File {
  const file = new File([new Uint8Array([1, 2, 3, 4])], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: 10 * 1024 * 1024 + 1 });
  return file;
}

function uploadPdf(file = pdfFile()) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("mapParsedToProfile", () => {
  it("synthesises ids for education/experience and nests links under personal", () => {
    const profile = mapParsedToProfile(parsed());

    expect(profile.education[0]!.id).toMatch(/.+/);
    expect(profile.experience[0]!.id).toMatch(/.+/);
    expect(profile.education[0]!.id).not.toBe(profile.experience[0]!.id);
    expect(profile.personal.links).toEqual({
      linkedin: "linkedin.com/in/ada",
      github: "github.com/ada",
    });
    expect(profile.personal.address).toBe("London");
    // Empty portfolio must not create an empty link key.
    expect(profile.personal.links).not.toHaveProperty("portfolio");
    expect(() => profileSchema.parse(profile)).not.toThrow();
  });
});

describe("OnboardingFlow — upload → review", () => {
  beforeEach(() => {
    vi.mocked(extractPdfText).mockResolvedValue("Ada Lovelace\nCambridge");
    vi.mocked(api.profile.parseResume).mockResolvedValue(parsed());
  });

  it("extracts, parses, and lands on an editable review pre-filled from the parse", async () => {
    render(<OnboardingFlow onComplete={vi.fn()} />);
    uploadPdf();

    await waitFor(() => expect(screen.getByText("Review your details")).toBeTruthy());

    // Extraction ran against the file bytes; the parse got the extracted text.
    expect(extractPdfText).toHaveBeenCalledOnce();
    expect(extractPdfText).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(api.profile.parseResume).toHaveBeenCalledWith({
      resumeText: "Ada Lovelace\nCambridge",
    });

    // Pre-filled and editable.
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("Ada Lovelace");
    expect(screen.getByDisplayValue("Cambridge")).toBeTruthy();
  });

  it("rejects a non-PDF file without running the pipeline", () => {
    render(<OnboardingFlow onComplete={vi.fn()} />);
    uploadPdf(pdfFile("notes.txt", "text/plain"));

    expect(screen.getByText(/only pdf/i)).toBeTruthy();
    expect(extractPdfText).not.toHaveBeenCalled();
  });
});

describe("OnboardingFlow — parse failure recovery", () => {
  beforeEach(() => {
    vi.mocked(extractPdfText).mockResolvedValue("some text");
  });

  it("surfaces an inline error with Retry, then recovers on a successful retry", async () => {
    vi.mocked(api.profile.parseResume)
      .mockRejectedValueOnce(new Error("llm down"))
      .mockResolvedValueOnce(parsed());

    render(<OnboardingFlow onComplete={vi.fn()} />);
    uploadPdf();

    await waitFor(() => expect(screen.getByText(/couldn't read that résumé/i)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("Review your details")).toBeTruthy());
    expect(api.profile.parseResume).toHaveBeenCalledTimes(2);
  });

  it("shows provider-connect copy with a Settings → AI link when the parse fails with 42000", async () => {
    vi.mocked(api.profile.parseResume).mockRejectedValue(new ApiError("no key", 42000));

    render(<OnboardingFlow onComplete={vi.fn()} />);
    uploadPdf();

    await waitFor(() => expect(screen.getByText(/AI provider isn't configured/i)).toBeTruthy());
    expect(screen.queryByText(/couldn't read that résumé/i)).toBeNull();
    const link = screen.getByRole("link", { name: "Settings → AI" });
    expect(link.getAttribute("href")).toBe("/settings/ai");
  });

  it("keeps the file-specific copy for a non-42000 parse failure", async () => {
    vi.mocked(api.profile.parseResume).mockRejectedValue(new ApiError("boom", 40000));

    render(<OnboardingFlow onComplete={vi.fn()} />);
    uploadPdf();

    await waitFor(() => expect(screen.getByText(/couldn't read that résumé/i)).toBeTruthy());
    expect(screen.queryByText(/AI provider isn't configured/i)).toBeNull();
  });

  it("offers a fill-in-manually escape that opens an empty review", async () => {
    vi.mocked(api.profile.parseResume).mockRejectedValue(new Error("llm down"));

    render(<OnboardingFlow onComplete={vi.fn()} />);
    uploadPdf();

    await waitFor(() => expect(screen.getByText(/couldn't read that résumé/i)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Fill in manually" }));

    expect(screen.getByText("Review your details")).toBeTruthy();
    // Empty — the parse gave us nothing.
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("");
  });
});

describe("OnboardingFlow — apply", () => {
  beforeEach(() => {
    vi.mocked(extractPdfText).mockResolvedValue("some text");
    vi.mocked(api.profile.parseResume).mockResolvedValue(parsed());
    vi.mocked(api.profile.save).mockImplementation(async (p: Profile) => p);
    vi.mocked(api.resumes.upload).mockResolvedValue({
      id: "r1",
      name: "resume.pdf",
      mimeType: "application/pdf",
      isPrimary: true,
      createdAt: Date.now(),
    });
  });

  it("PUTs the normalized profile and uploads the résumé as primary, then completes", async () => {
    const onComplete = vi.fn();
    render(<OnboardingFlow onComplete={onComplete} />);
    uploadPdf(pdfFile("ada.pdf"));

    await waitFor(() => expect(screen.getByText("Review your details")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(api.profile.save).toHaveBeenCalled());

    const saved = vi.mocked(api.profile.save).mock.calls[0]![0];
    expect(saved.personal.name).toBe("Ada Lovelace");
    // normalizeProfile ran: the empty portfolio link is stripped.
    expect(saved.personal.links).toEqual({
      linkedin: "linkedin.com/in/ada",
      github: "github.com/ada",
    });
    expect(() => profileSchema.parse(saved)).not.toThrow();

    await waitFor(() => expect(api.resumes.upload).toHaveBeenCalled());
    const upload = vi.mocked(api.resumes.upload).mock.calls[0]![0];
    expect(upload.name).toBe("ada.pdf");
    expect(upload.mimeType).toBe("application/pdf");
    expect(upload.isPrimary).toBe(true);
    expect(typeof upload.dataBase64).toBe("string");
    // The text already extracted for the parse step is threaded into the
    // résumé upload too, so tailoring has the real résumé text.
    expect(upload.text).toBe("some text");

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(saved, undefined));
  });

  it("still uploads the file after a manual fallback, editing an empty profile", async () => {
    vi.mocked(api.profile.parseResume).mockRejectedValue(new Error("llm down"));
    render(<OnboardingFlow onComplete={vi.fn()} />);
    uploadPdf(pdfFile("ada.pdf"));

    await waitFor(() => expect(screen.getByText(/couldn't read that résumé/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Fill in manually" }));

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Grace" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "grace@x.io" } });

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(api.resumes.upload).toHaveBeenCalled());
    expect(vi.mocked(api.resumes.upload).mock.calls[0]![0].isPrimary).toBe(true);
    expect(vi.mocked(api.profile.save).mock.calls[0]![0].personal.name).toBe("Grace");
    // Extraction succeeded before the parse failed, so the text is still
    // available to thread into the upload even on the manual-fallback path.
    expect(vi.mocked(api.resumes.upload).mock.calls[0]![0].text).toBe("some text");
  });

  it("rejects an oversize résumé before saving, with no API calls", async () => {
    render(<OnboardingFlow onComplete={vi.fn()} />);
    uploadPdf(oversizePdfFile());

    await waitFor(() => expect(screen.getByText("Review your details")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(screen.getByText(/10 MB limit/i)).toBeTruthy();
    expect(api.profile.save).not.toHaveBeenCalled();
    expect(api.resumes.upload).not.toHaveBeenCalled();
  });

  it("completes onboarding and hands the caller a warning when the profile saves but the upload fails", async () => {
    // This component unmounts the instant onComplete fires (the caller swaps
    // it out for its own view), so the failure can't be surfaced by rendering
    // something locally — it must be handed up through the callback instead.
    vi.mocked(api.resumes.upload).mockRejectedValue(new Error("payload too large"));
    const onComplete = vi.fn();
    render(<OnboardingFlow onComplete={onComplete} />);
    uploadPdf(pdfFile("ada.pdf"));

    await waitFor(() => expect(screen.getByText("Review your details")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(api.profile.save).toHaveBeenCalled());
    await waitFor(() => expect(api.resumes.upload).toHaveBeenCalled());

    // Profile data is never held hostage by the file upload failing.
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const [savedProfile, warning] = onComplete.mock.calls[0]!;
    expect(savedProfile.personal.name).toBe("Ada Lovelace");
    expect(warning).toMatch(/couldn't be stored/i);
  });

  it("guards against a double-click firing apply() twice", async () => {
    let resolveSave: (p: Profile) => void;
    vi.mocked(api.profile.save).mockImplementation(
      () =>
        new Promise<Profile>((resolve) => {
          resolveSave = resolve;
        }),
    );

    render(<OnboardingFlow onComplete={vi.fn()} />);
    uploadPdf(pdfFile("ada.pdf"));

    await waitFor(() => expect(screen.getByText("Review your details")).toBeTruthy());

    const saveButton = screen.getByRole("button", { name: "Save profile" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => expect(api.profile.save).toHaveBeenCalledTimes(1));

    resolveSave!(normalizeSavedProfile());
    await waitFor(() => expect(api.resumes.upload).toHaveBeenCalledTimes(1));
  });
});

describe("OnboardingFlow — provider pre-check", () => {
  it("shows the connect-provider card when the active provider has no key", async () => {
    vi.mocked(api.settings.get).mockResolvedValue(settings("anthropic"));
    vi.mocked(api.settings.llmKeys).mockResolvedValue({ anthropic: "none" });

    render(<OnboardingFlow onComplete={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Connect your AI provider")).toBeTruthy());
    expect(
      screen.getByText(/OfferOS needs an API key to read your résumé and tailor applications/i),
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: "Settings → AI" });
    expect(link.getAttribute("href")).toBe("/settings/ai");
    // Upload stays enabled regardless.
    expect(screen.getByRole("button", { name: "Choose PDF" }).hasAttribute("disabled")).toBe(false);
  });

  it("hides the card when the active provider already has a key", async () => {
    vi.mocked(api.settings.get).mockResolvedValue(settings("anthropic"));
    vi.mocked(api.settings.llmKeys).mockResolvedValue({ anthropic: "saved" });

    render(<OnboardingFlow onComplete={vi.fn()} />);

    await waitFor(() => expect(api.settings.get).toHaveBeenCalled());
    expect(screen.queryByText("Connect your AI provider")).toBeNull();
  });

  it("checks the status of the active provider specifically, not just any provider", async () => {
    vi.mocked(api.settings.get).mockResolvedValue(settings("openai"));
    vi.mocked(api.settings.llmKeys).mockResolvedValue({ anthropic: "saved", openai: "none" });

    render(<OnboardingFlow onComplete={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Connect your AI provider")).toBeTruthy());
  });

  it("fails open (no card, no crash) when the settings fetch fails", async () => {
    vi.mocked(api.settings.get).mockRejectedValue(new Error("offline"));
    vi.mocked(api.settings.llmKeys).mockRejectedValue(new Error("offline"));

    render(<OnboardingFlow onComplete={vi.fn()} />);

    await waitFor(() => expect(api.settings.get).toHaveBeenCalled());
    expect(screen.queryByText("Connect your AI provider")).toBeNull();
    expect(screen.getByText("Upload your résumé")).toBeTruthy();
  });
});

function normalizeSavedProfile(): Profile {
  return {
    personal: {
      name: "Ada Lovelace",
      email: "ada@x.io",
      phone: "555-0100",
      address: "London",
      links: {},
    },
    skills: [],
    education: [],
    experience: [],
  };
}
