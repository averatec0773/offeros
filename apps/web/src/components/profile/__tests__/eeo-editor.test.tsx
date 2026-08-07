// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { EeoEditor, EEO_PRESETS } from "../eeo-editor";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({
  api: { answers: { list: vi.fn(), create: vi.fn(), update: vi.fn() } },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EEO_PRESETS", () => {
  it("uses the 10 standard Equal Employment questions", () => {
    expect(EEO_PRESETS.map((p) => p.label)).toEqual([
      "Are you authorized to work in the US? (Yes/No)",
      "Do you have a disability?",
      "What is your gender?",
      "Will you now or in the future require sponsorship for employment visa status? (Yes/No)",
      "Do you identify as LGBTQ+? (Yes/No)",
      "Are you a veteran?",
      "How would you identify your race?",
      "Are you Hispanic or Latino? (Yes/No)",
      "Sexual orientation (mark all that apply)",
      "What are your pronouns?",
    ]);
  });

  it("gives gender the standard EEOC self-identification categories", () => {
    const gender = EEO_PRESETS.find((p) => p.pattern === "What is your gender?")!;
    expect(gender.type).toBe("enum");
    expect(gender.options).toEqual(["Male", "Female", "Non-binary", "Decline to self-identify"]);
  });

  it("gives race the standard EEOC race/ethnicity categories instead of a bare text field", () => {
    const race = EEO_PRESETS.find((p) => p.pattern === "How would you identify your race?")!;
    expect(race.type).toBe("enum");
    expect(race.options).toEqual([
      "American Indian or Alaska Native",
      "Asian",
      "Black or African American",
      "Hispanic or Latino",
      "Native Hawaiian or Other Pacific Islander",
      "White",
      "Two or More Races",
      "Decline to self-identify",
    ]);
  });

  it("gives veteran status the standard OFCCP self-ID wording", () => {
    const veteran = EEO_PRESETS.find((p) => p.pattern === "Are you a veteran?")!;
    expect(veteran.type).toBe("enum");
    expect(veteran.options).toEqual([
      "I am not a protected veteran",
      "I identify as one or more of the classifications of a protected veteran",
      "I don't wish to answer",
    ]);
  });

  it("gives disability status the standard OFCCP self-ID wording", () => {
    const disability = EEO_PRESETS.find((p) => p.pattern === "Do you have a disability?")!;
    expect(disability.type).toBe("enum");
    expect(disability.options).toEqual([
      "Yes, I have a disability, or have had one in the past",
      "No, I do not have a disability and have not had one in the past",
      "I do not want to answer",
    ]);
  });
});

describe("EeoEditor", () => {
  beforeEach(() => {
    vi.mocked(api.answers.list).mockResolvedValue([]);
  });

  it("renders all 10 preset questions", async () => {
    render(<EeoEditor />);
    for (const preset of EEO_PRESETS) {
      expect(await screen.findByText(preset.label)).toBeTruthy();
    }
  });

  it("creates a new eeo answer entry keyed by the bare pattern (no parenthetical) on save", async () => {
    vi.mocked(api.answers.create).mockResolvedValue({
      id: "a1",
      questionPatterns: ["Are you a veteran?"],
      answer: "I am not a protected veteran",
      type: "enum",
      category: "eeo",
    });

    render(<EeoEditor />);
    const select = (await screen.findByLabelText("Are you a veteran?")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "I am not a protected veteran" } });

    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    const veteranIndex = EEO_PRESETS.findIndex((p) => p.label === "Are you a veteran?");
    fireEvent.click(saveButtons[veteranIndex]!);

    await waitFor(() => expect(api.answers.create).toHaveBeenCalled());
    expect(api.answers.create).toHaveBeenCalledWith({
      questionPatterns: ["Are you a veteran?", "veteran"],
      answer: "I am not a protected veteran",
      type: "enum",
      category: "eeo",
    });
    expect(await screen.findByText("Saved.")).toBeTruthy();
  });

  it("hydrates an existing eeo entry by matching pattern and updates instead of creating", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([
      {
        id: "existing1",
        questionPatterns: ["Are you a veteran?"],
        answer: "I don't wish to answer",
        type: "enum",
        category: "eeo",
      },
    ]);
    vi.mocked(api.answers.update).mockResolvedValue({
      id: "existing1",
      questionPatterns: ["Are you a veteran?"],
      answer: "I am not a protected veteran",
      type: "enum",
      category: "eeo",
    });

    render(<EeoEditor />);
    const select = (await screen.findByLabelText("Are you a veteran?")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("I don't wish to answer"));

    fireEvent.change(select, { target: { value: "I am not a protected veteran" } });
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    const veteranIndex = EEO_PRESETS.findIndex((p) => p.label === "Are you a veteran?");
    fireEvent.click(saveButtons[veteranIndex]!);

    await waitFor(() =>
      expect(api.answers.update).toHaveBeenCalledWith("existing1", {
        questionPatterns: ["Are you a veteran?", "veteran"],
        answer: "I am not a protected veteran",
        type: "enum",
        category: "eeo",
      }),
    );
    expect(api.answers.create).not.toHaveBeenCalled();
  });

  it("uses a text control for open-ended questions with no documented options", async () => {
    render(<EeoEditor />);
    const pronouns = await screen.findByLabelText("What are your pronouns?");
    expect(pronouns.tagName).toBe("INPUT");
  });

  it("does not persist a junk entry when Save is clicked on an untouched (empty) row", async () => {
    render(<EeoEditor />);
    const saveButtons = await screen.findAllByRole("button", { name: "Save" });
    const veteranIndex = EEO_PRESETS.findIndex((p) => p.label === "Are you a veteran?");
    fireEvent.click(saveButtons[veteranIndex]!);

    // Give any (incorrect) async save a chance to fire before asserting it didn't.
    await new Promise((r) => setTimeout(r, 0));
    expect(api.answers.create).not.toHaveBeenCalled();
    expect(api.answers.update).not.toHaveBeenCalled();
  });

  it("preserves other patterns on a shared multi-pattern entry when updating one row", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([
      {
        id: "shared1",
        questionPatterns: ["Are you a veteran?", "Have you served in the U.S. military?"],
        answer: "I don't wish to answer",
        type: "enum",
        category: "eeo",
      },
    ]);
    vi.mocked(api.answers.update).mockResolvedValue({
      id: "shared1",
      questionPatterns: ["Are you a veteran?", "Have you served in the U.S. military?"],
      answer: "I am not a protected veteran",
      type: "enum",
      category: "eeo",
    });

    render(<EeoEditor />);
    const select = (await screen.findByLabelText("Are you a veteran?")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("I don't wish to answer"));

    fireEvent.change(select, { target: { value: "I am not a protected veteran" } });
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    const veteranIndex = EEO_PRESETS.findIndex((p) => p.label === "Are you a veteran?");
    fireEvent.click(saveButtons[veteranIndex]!);

    await waitFor(() =>
      expect(api.answers.update).toHaveBeenCalledWith("shared1", {
        questionPatterns: [
          "Are you a veteran?",
          "Have you served in the U.S. military?",
          "veteran",
        ],
        answer: "I am not a protected veteran",
        type: "enum",
        category: "eeo",
      }),
    );
  });

  it("lets the user enter a custom value via 'Other…' for an edge case not in the standard list", async () => {
    vi.mocked(api.answers.create).mockResolvedValue({
      id: "race1",
      questionPatterns: ["How would you identify your race?"],
      answer: "Something else entirely",
      type: "enum",
      category: "eeo",
    });

    render(<EeoEditor />);
    const raceSelect = (await screen.findByLabelText(
      "How would you identify your race?",
    )) as HTMLSelectElement;
    fireEvent.change(raceSelect, { target: { value: "__other__" } });

    const customInput = await screen.findByLabelText("Custom value");
    fireEvent.change(customInput, { target: { value: "Something else entirely" } });

    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    const raceIndex = EEO_PRESETS.findIndex(
      (p) => p.pattern === "How would you identify your race?",
    );
    fireEvent.click(saveButtons[raceIndex]!);

    await waitFor(() => expect(api.answers.create).toHaveBeenCalled());
    expect(api.answers.create).toHaveBeenCalledWith({
      questionPatterns: ["How would you identify your race?", "race", "ethnicity"],
      answer: "Something else entirely",
      type: "enum",
      category: "eeo",
    });
  });

  it("every preset carries short keyword patterns so terse form labels ('Gender') can match", () => {
    // matchAnswer is whole-word containment of the pattern INSIDE the live
    // question — a full-sentence-only pattern can never hit a bare group label.
    for (const preset of EEO_PRESETS) {
      expect(preset.patterns[0]).toBe(preset.pattern);
      expect(preset.patterns.length).toBeGreaterThan(1);
    }
    expect(EEO_PRESETS.find((p) => p.pattern === "What is your gender?")!.patterns).toContain(
      "gender",
    );
    expect(EEO_PRESETS.find((p) => p.pattern === "Are you a veteran?")!.patterns).toContain(
      "veteran",
    );
  });

  it("work authorization and sponsorship never get a privacy default — they need the true answer", () => {
    const auth = EEO_PRESETS.find((p) => p.pattern === "Are you authorized to work in the US?")!;
    const visa = EEO_PRESETS.find((p) => p.pattern.includes("require sponsorship"))!;
    expect(auth.privacyDefault).toBeUndefined();
    expect(visa.privacyDefault).toBeUndefined();
    for (const p of EEO_PRESETS) {
      if (p !== auth && p !== visa) expect(p.privacyDefault).toBeTruthy();
    }
  });

  it("one click applies privacy defaults to every blank voluntary question, skipping existing entries", async () => {
    // Veteran already answered — must not be overwritten.
    vi.mocked(api.answers.list).mockResolvedValue([
      {
        id: "existing1",
        questionPatterns: ["Are you a veteran?"],
        answer: "I am not a protected veteran",
        type: "enum",
        category: "eeo",
      },
    ]);
    vi.mocked(api.answers.create).mockImplementation(async (input) => ({
      id: `new-${Math.random()}`,
      questionPatterns: input.questionPatterns,
      answer: input.answer,
      type: input.type,
      category: "eeo",
    }));

    render(<EeoEditor />);
    const veteranSelect = (await screen.findByLabelText("Are you a veteran?")) as HTMLSelectElement;
    await waitFor(() => expect(veteranSelect.value).toBe("I am not a protected veteran"));

    fireEvent.click(screen.getByRole("button", { name: "Apply privacy-preserving defaults" }));

    // 8 presets carry a privacyDefault; veteran already has an entry → 7 creates.
    await waitFor(() => expect(api.answers.create).toHaveBeenCalledTimes(7));
    expect(api.answers.update).not.toHaveBeenCalled();
    const created = vi.mocked(api.answers.create).mock.calls.map((c) => c[0]);
    // Never invents work-auth / sponsorship answers.
    expect(
      created.some((c) =>
        c.questionPatterns.some((p: string) => /authorized|sponsorship/i.test(p)),
      ),
    ).toBe(false);
    // Broadened patterns ride along on every seeded entry.
    const gender = created.find((c) => c.questionPatterns.includes("gender"))!;
    expect(gender.answer).toBe("Decline to self-identify");
    expect(await screen.findByText("Saved 7.")).toBeTruthy();
  });

  it("round-trips a previously saved custom value: hydrates into Other… mode with the text preserved", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([
      {
        id: "race1",
        questionPatterns: ["How would you identify your race?"],
        answer: "Something else entirely",
        type: "enum",
        category: "eeo",
      },
    ]);

    render(<EeoEditor />);
    const raceSelect = (await screen.findByLabelText(
      "How would you identify your race?",
    )) as HTMLSelectElement;
    await waitFor(() => expect(raceSelect.value).toBe("__other__"));

    const customInput = await screen.findByLabelText("Custom value");
    expect((customInput as HTMLInputElement).value).toBe("Something else entirely");
  });
});
