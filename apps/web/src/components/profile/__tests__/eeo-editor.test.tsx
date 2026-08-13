// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { EeoEditor, EEO_PRESETS } from "../eeo-editor";
import { useAnswerBank } from "../use-answer-bank";
import { api } from "@/lib/api-client";

/** The editor reads the page's one answer bank; the page is what owns it. */
function EeoHost() {
  return <EeoEditor bank={useAnswerBank()} />;
}

vi.mock("@/lib/api-client", () => ({
  api: {
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
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Work authorization and sponsorship must never be auto-answered. That rule is
// enforced by the TRUTH guard class and tested in
// packages/autofill/src/__tests__/invariants-guards.test.ts — it is not this
// component's to keep, and duplicating it here would let one copy rot.
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
      "Sexual orientation",
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
    render(<EeoHost />);
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

    render(<EeoHost />);
    const select = (await screen.findByLabelText("Are you a veteran?")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "I am not a protected veteran" } });

    await waitFor(() => expect(api.answers.create).toHaveBeenCalled());
    expect(api.answers.create).toHaveBeenCalledWith({
      questionPatterns: ["Are you a veteran?", "veteran"],
      answer: "I am not a protected veteran",
      type: "enum",
      category: "eeo",
    });
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("hydrates an existing eeo entry by matching pattern, and saves it as that same question", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([
      {
        id: "existing1",
        questionPatterns: ["Are you a veteran?"],
        answer: "I don't wish to answer",
        type: "enum",
        category: "eeo",
      },
    ]);
    vi.mocked(api.answers.create).mockResolvedValue({
      id: "existing1",
      questionPatterns: ["Are you a veteran?", "veteran"],
      answer: "I am not a protected veteran",
      type: "enum",
      category: "eeo",
    });

    render(<EeoHost />);
    const select = (await screen.findByLabelText("Are you a veteran?")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("I don't wish to answer"));

    fireEvent.change(select, { target: { value: "I am not a protected veteran" } });

    // The row no longer decides create-vs-update. It posts the question and its
    // patterns, and the server updates the entry that already answers it —
    // which is what makes the panel's accept-an-answer path dedupe too, without
    // every surface reimplementing the rule. (See answer-service tests.)
    await waitFor(() =>
      expect(api.answers.create).toHaveBeenCalledWith({
        questionPatterns: ["Are you a veteran?", "veteran"],
        answer: "I am not a protected veteran",
        type: "enum",
        category: "eeo",
      }),
    );
    expect(api.answers.create).toHaveBeenCalledTimes(1);
  });

  it("offers documented choices for pronouns and orientation rather than a blank box", async () => {
    render(<EeoHost />);
    for (const label of ["What are your pronouns?", "Sexual orientation"]) {
      const control = await screen.findByLabelText(label);
      expect(control.tagName, `${label} should be a select`).toBe("SELECT");
      // Every question keeps an escape hatch for an answer the list omits.
      const values = Array.from((control as HTMLSelectElement).options).map((o) => o.value);
      expect(values).toContain("__other__");
      expect(values).toContain("Prefer not to say");
    }
  });

  it("writes nothing for a row the user never answered", async () => {
    render(<EeoHost />);
    const select = (await screen.findByLabelText("Are you a veteran?")) as HTMLSelectElement;
    // Re-selecting the placeholder is still not an answer.
    fireEvent.change(select, { target: { value: "" } });
    // Autosave means "no button was pressed" no longer proves anything — wait
    // past the typing-settle window before concluding nothing was written.
    await new Promise((r) => setTimeout(r, 900));
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
    vi.mocked(api.answers.create).mockResolvedValue({
      id: "shared1",
      questionPatterns: ["Are you a veteran?", "Have you served in the U.S. military?", "veteran"],
      answer: "I am not a protected veteran",
      type: "enum",
      category: "eeo",
    });

    render(<EeoHost />);
    const select = (await screen.findByLabelText("Are you a veteran?")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("I don't wish to answer"));

    fireEvent.change(select, { target: { value: "I am not a protected veteran" } });

    // A form's own wording, picked up on some earlier application, is kept.
    await waitFor(() =>
      expect(api.answers.create).toHaveBeenCalledWith({
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

    render(<EeoHost />);
    const raceSelect = (await screen.findByLabelText(
      "How would you identify your race?",
    )) as HTMLSelectElement;
    fireEvent.change(raceSelect, { target: { value: "__other__" } });

    const customInput = await screen.findByLabelText("Custom value");
    fireEvent.change(customInput, { target: { value: "Something else entirely" } });

    await waitFor(() => expect(api.answers.create).toHaveBeenCalled(), { timeout: 3000 });
    expect(api.answers.create).toHaveBeenCalledWith({
      questionPatterns: ["How would you identify your race?", "race", "ethnicity"],
      answer: "Something else entirely",
      type: "enum",
      category: "eeo",
    });
  });

  /**
   * The hazard autosave introduces and a Save button did not.
   *
   * Two quick changes to one row both start before either finishes. They must
   * not race: the second write has to leave the row holding the second answer,
   * not whichever request happened to land last.
   */
  it("two fast edits to one row are written in order, last answer winning", async () => {
    type SaveResult = Awaited<ReturnType<typeof api.answers.create>>;
    const saved: string[] = [];
    let resolveFirst!: (v: SaveResult) => void;
    vi.mocked(api.answers.create).mockImplementation(async (input) => {
      saved.push(input.answer);
      if (saved.length === 1) {
        return new Promise<SaveResult>((r) => {
          resolveFirst = r;
        });
      }
      return {
        id: "v1",
        questionPatterns: ["Are you a veteran?", "veteran"],
        answer: input.answer,
        type: "enum",
        category: "eeo",
      };
    });

    render(<EeoHost />);
    const select = (await screen.findByLabelText("Are you a veteran?")) as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "I am not a protected veteran" } });
    // Second change lands while the first write is still in flight.
    fireEvent.change(select, { target: { value: "I don't wish to answer" } });
    // The second write must not have started yet — it is chained behind. (The
    // first is a microtask away, so this waits rather than asserting on the
    // same tick as the click.)
    await waitFor(() => expect(saved).toEqual(["I am not a protected veteran"]));
    resolveFirst({
      id: "v1",
      questionPatterns: ["Are you a veteran?", "veteran"],
      answer: "I am not a protected veteran",
      type: "enum",
      category: "eeo",
    });

    await waitFor(() =>
      expect(saved).toEqual(["I am not a protected veteran", "I don't wish to answer"]),
    );
  });

  /**
   * The one-click defaults action wrote decline answers to every blank
   * voluntary question and was later removed — but the entries it created
   * outlived it, and nothing could take them back: the select refused an empty
   * value, so an answer made in one click was permanent. On a real form that
   * showed up as "Prefer not to answer" ticked for a question the user had
   * never decided.
   */
  it("clears a saved answer when the user chooses to leave it blank", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([
      {
        id: "pronouns-1",
        questionPatterns: ["What are your pronouns?", "pronouns"],
        answer: "Prefer not to say",
        type: "enum",
        category: "eeo",
      },
    ]);
    vi.mocked(api.answers.remove).mockResolvedValue({ id: "pronouns-1" });

    render(<EeoHost />);
    const select = (await screen.findByLabelText("What are your pronouns?")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("Prefer not to say"));

    fireEvent.change(select, { target: { value: "" } });

    await waitFor(() => expect(api.answers.remove).toHaveBeenCalledWith("pronouns-1"));
    // And nothing is re-created in its place.
    expect(api.answers.create).not.toHaveBeenCalled();
    expect(api.answers.update).not.toHaveBeenCalled();
  });

  it("does not call the API to clear a question that was never answered", async () => {
    render(<EeoHost />);
    const select = (await screen.findByLabelText("What are your pronouns?")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "" } });
    await new Promise((r) => setTimeout(r, 900));
    expect(api.answers.remove).not.toHaveBeenCalled();
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

    render(<EeoHost />);
    const raceSelect = (await screen.findByLabelText(
      "How would you identify your race?",
    )) as HTMLSelectElement;
    await waitFor(() => expect(raceSelect.value).toBe("__other__"));

    const customInput = await screen.findByLabelText("Custom value");
    expect((customInput as HTMLInputElement).value).toBe("Something else entirely");
  });
});
