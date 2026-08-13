// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { profileSchema, type Profile } from "@offeros/core";
import { ProfileClient, normalizeProfile } from "../profile-client";
import { api } from "@/lib/api-client";
import { extractPdfText } from "@offeros/pdf";

vi.mock("@/lib/pdf-worker", () => ({ ensurePdfWorker: vi.fn() }));
vi.mock("@offeros/pdf", () => ({ extractPdfText: vi.fn() }));

// Preserve the real ApiError class and isLlmNotConfigured — onboarding-flow
// (rendered here via the empty-state path) imports isLlmNotConfigured directly.
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      profile: { get: vi.fn(), save: vi.fn(), parseResume: vi.fn() },
      answers: {
        list: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        gaps: vi.fn(async () => ({
          gaps: [],
          notOurs: [],
          total: 0,
          hasUnattributedSightings: false,
        })),
      },
      resumes: { list: vi.fn(), upload: vi.fn(), setPrimary: vi.fn(), remove: vi.fn() },
      settings: { get: vi.fn(), llmKeys: vi.fn() },
    },
  };
});

afterEach(cleanup);
// Several describes below now exercise api.profile.save/api.resumes.upload
// (via the onboarding path); clear call history between tests so `mock.calls[0]`
// always refers to that test's own call, not a leftover from an earlier one.
afterEach(() => vi.clearAllMocks());

beforeEach(() => {
  vi.mocked(api.answers.list).mockResolvedValue([]);
  vi.mocked(api.resumes.list).mockResolvedValue([]);
  // Onboarding's provider pre-check: a key is configured, so its card stays
  // hidden — these tests aren't exercising that behavior.
  vi.mocked(api.settings.get).mockResolvedValue({
    agent: {
      enableCustomizeResume: true,
      enableCustomizeCoverLetter: true,
      useOriginalResume: false,
      autoConfirm: false,
      autoSubmit: false,
    },
    llm: { provider: "anthropic", promptOverrides: {}, modelOverrides: {} },
  });
  vi.mocked(api.settings.llmKeys).mockResolvedValue({ anthropic: "env" });
});

function filledProfile(): Profile {
  return {
    personal: {
      name: "Ada",
      email: "ada@x.io",
      phone: "555",
      address: "", // empty optional — must not persist as ""
      links: {},
    },
    skills: [],
    education: [],
    experience: [],
  };
}

describe("ProfileClient — empty state", () => {
  it("renders the onboarding flow when there is no profile", () => {
    render(<ProfileClient initialProfile={null} />);

    // The dropzone, not the section editors.
    expect(screen.getByText("Upload your résumé")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose PDF" })).toBeTruthy();
  });

  it("reveals the review editors via the fill-in-manually escape", () => {
    render(<ProfileClient initialProfile={null} />);

    fireEvent.click(screen.getByRole("button", { name: /fill in manually/i }));

    expect(screen.getByRole("heading", { name: "Personal" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Skills" })).toBeTruthy();
  });

  it("counts completeness against the core profile fields, not the full nav", () => {
    render(<ProfileClient initialProfile={filledProfile()} />);
    // filledProfile has name+email but no education/experience/skills: 1 of 4.
    expect(screen.getByText("1 of 4 sections complete")).toBeTruthy();
  });

  it("renders the onboarding privacy line", () => {
    render(<ProfileClient initialProfile={null} />);
    expect(screen.getByText(/stays on this machine/i)).toBeTruthy();
  });
});

describe("ProfileClient — résumé upload failure surfaces after onboarding completes", () => {
  function pdfFile(name = "ada.pdf"): File {
    return new File([new Uint8Array([1, 2, 3, 4])], name, { type: "application/pdf" });
  }

  function uploadPdf(file = pdfFile()) {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  }

  it("shows the normal editor and a dismissible warning banner when the profile saves but the résumé upload fails", async () => {
    // Real onComplete path (ProfileClient's own setDraft), not a no-op test
    // double — OnboardingFlow unmounts the instant onComplete fires, so this
    // is the only way to prove the warning actually reaches the surviving view.
    vi.mocked(extractPdfText).mockResolvedValue("some text");
    vi.mocked(api.profile.parseResume).mockRejectedValue(new Error("llm down"));
    vi.mocked(api.profile.save).mockImplementation(async (p: Profile) => p);
    vi.mocked(api.resumes.upload).mockRejectedValue(new Error("payload too large"));

    render(<ProfileClient initialProfile={null} />);
    uploadPdf();

    await waitFor(() => expect(screen.getByText(/couldn't read that résumé/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Fill in manually" }));

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Grace" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "grace@x.io" } });

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    // Normal editing mode, not the onboarding review screen.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Profile" })).toBeTruthy());
    expect(screen.queryByText("Review your details")).toBeNull();

    // The warning banner is visible in that surviving view.
    const banner = await screen.findByText(/couldn't be stored/i);
    expect(banner).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/couldn't be stored/i)).toBeNull();
  });
});

describe("ProfileClient — autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.profile.save).mockImplementation(async (p) => p);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("has no per-section Save button for the profile-document sections", () => {
    render(<ProfileClient initialProfile={filledProfile()} />);
    for (const name of ["Personal", "Education", "Work experience", "Skills"]) {
      const section = screen.getByRole("heading", { name }).closest("section")!;
      expect(within(section).queryByRole("button", { name: "Save" })).toBeNull();
    }
  });

  it("PUTs exactly one schema-valid document after the debounce window", async () => {
    render(<ProfileClient initialProfile={filledProfile()} />);

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada Lovelace" } });
    // Nothing before the debounce elapses.
    expect(api.profile.save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(api.profile.save).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(api.profile.save).mock.calls[0]![0];
    expect(saved.personal.name).toBe("Ada Lovelace");
    // normalizeProfile still runs: empty optionals are stripped.
    expect(saved.personal.address).toBeUndefined();
    expect(() => profileSchema.parse(saved)).not.toThrow();

    // The sticky nav reflects the settled state.
    expect(screen.getByText("All changes saved")).toBeTruthy();
  });

  it("coalesces two rapid edits into one PUT carrying the latest value", async () => {
    render(<ProfileClient initialProfile={filledProfile()} />);

    const fullName = screen.getByLabelText("Full name");
    fireEvent.change(fullName, { target: { value: "Ada L" } });
    fireEvent.change(fullName, { target: { value: "Ada Lovelace" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(api.profile.save).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.profile.save).mock.calls[0]![0].personal.name).toBe("Ada Lovelace");
  });

  it("defers an edit made during an in-flight save into one follow-up with the latest draft", async () => {
    let resolveFirst!: (v: Profile) => void;
    const first = new Promise<Profile>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(api.profile.save)
      .mockReturnValueOnce(first)
      .mockImplementation(async (p) => p);

    render(<ProfileClient initialProfile={filledProfile()} />);
    const fullName = screen.getByLabelText("Full name");

    // Edit 1 → debounce fires → first PUT starts and stays in-flight.
    fireEvent.change(fullName, { target: { value: "One" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(api.profile.save).toHaveBeenCalledTimes(1);

    // Edit 2 while the first is still in-flight → its debounce only marks pending.
    fireEvent.change(fullName, { target: { value: "Two" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(api.profile.save).toHaveBeenCalledTimes(1);

    // Resolving the first PUT triggers exactly one follow-up with the latest draft.
    await act(async () => {
      resolveFirst(filledProfile());
      await Promise.resolve();
    });
    expect(api.profile.save).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.profile.save).mock.calls[1]![0].personal.name).toBe("Two");
  });

  it("surfaces an error and keeps the edited value when the PUT rejects", async () => {
    vi.mocked(api.profile.save).mockRejectedValue(new Error("boom"));
    render(<ProfileClient initialProfile={filledProfile()} />);

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Grace" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(api.profile.save).toHaveBeenCalled();
    // Error status + retry affordance are shown.
    expect(screen.getByText(/couldn't save/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    // The user's edit is never lost.
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("Grace");
  });
});

describe("normalizeProfile", () => {
  it("strips empty optional personal fields and empty links/skills/bullets", () => {
    const result = normalizeProfile({
      personal: {
        name: "Ada",
        email: "a@b.c",
        phone: "1",
        city: "",
        country: "US",
        links: { linkedin: "", github: "gh/ada" },
      },
      skills: ["React", "  "],
      education: [],
      experience: [
        { id: "x", company: "Acme", title: "Eng", start: "", end: "", bullets: ["did x", ""] },
      ],
    });

    expect(result.personal.city).toBeUndefined();
    expect(result.personal.country).toBe("US");
    expect(result.personal.links).toEqual({ github: "gh/ada" });
    expect(result.skills).toEqual(["React"]);
    expect(result.experience[0]!.bullets).toEqual(["did x"]);
    expect(() => profileSchema.parse(result)).not.toThrow();
  });

  it("omits an empty gpa key from education entries instead of persisting ''", () => {
    const result = normalizeProfile({
      personal: { name: "Ada", email: "a@b.c", phone: "1", links: {} },
      skills: [],
      education: [
        {
          id: "ed1",
          school: "MIT",
          degree: "BSc",
          field: "CS",
          gpa: "",
          start: "2018",
          end: "2022",
        },
        {
          id: "ed2",
          school: "Cal",
          degree: "MSc",
          field: "CS",
          gpa: "3.9",
          start: "2022",
          end: "2024",
        },
      ],
      experience: [],
    });

    expect(result.education[0]).not.toHaveProperty("gpa");
    expect(result.education[1]!.gpa).toBe("3.9");
    expect(() => profileSchema.parse(result)).not.toThrow();
  });

  it("drops education and experience entries whose meaningful fields are all blank", () => {
    const result = normalizeProfile({
      personal: { name: "Ada", email: "a@b.c", phone: "1", links: {} },
      skills: [],
      education: [
        { id: "blank-ed", school: "", degree: "", field: "", gpa: "", start: "", end: "" },
        { id: "real-ed", school: "MIT", degree: "", field: "", gpa: "", start: "", end: "" },
      ],
      experience: [
        { id: "blank-exp", company: "", title: "", start: "", end: "", bullets: ["  "] },
        { id: "real-exp", company: "Acme", title: "", start: "", end: "", bullets: [] },
      ],
    });

    expect(result.education).toHaveLength(1);
    expect(result.education[0]!.id).toBe("real-ed");
    expect(result.experience).toHaveLength(1);
    expect(result.experience[0]!.id).toBe("real-exp");
    expect(() => profileSchema.parse(result)).not.toThrow();
  });
});
