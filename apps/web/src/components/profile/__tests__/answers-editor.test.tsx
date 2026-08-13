// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { AnswerEntry } from "@offeros/core";
import { AnswersEditor } from "../answers-editor";
import { useAnswerBank } from "../use-answer-bank";
import { api } from "@/lib/api-client";

/** The editor reads the page's one answer bank; the page is what owns it. */
function AnswersHost() {
  return <AnswersEditor bank={useAnswerBank()} />;
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

const entry: AnswerEntry = {
  id: "e1",
  questionPatterns: ["Why do you want to work here?"],
  answer: "I love the mission.",
  type: "text",
  category: "custom",
};

describe("AnswersEditor", () => {
  it("shows an empty-state message when there are no answers yet", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([]);
    render(<AnswersHost />);
    expect(await screen.findByText(/no answers/i)).toBeTruthy();
  });

  it("renders a description of what the answer bank is for", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([]);
    render(<AnswersHost />);
    expect(
      await screen.findByText(/reusable answers to common application questions/i),
    ).toBeTruthy();
  });

  it("renders suggested-question chips headed by Expected salary", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([]);
    render(<AnswersHost />);
    await screen.findByText(/no answers/i);
    const chips = screen.getAllByRole("button", {
      name: /Expected salary|Notice period|Years of experience|Why this company|Work authorization/,
    });
    expect(chips.map((c) => c.textContent)).toEqual([
      "Expected salary",
      "Notice period",
      "Years of experience",
      "Why this company",
      "Work authorization",
    ]);
  });

  it("adds a starter entry with an empty answer when the Expected salary chip is clicked", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([]);
    vi.mocked(api.answers.create).mockResolvedValue({
      id: "salary1",
      questionPatterns: ["Expected salary"],
      answer: "",
      type: "text",
      category: "screening",
    });

    render(<AnswersHost />);
    await screen.findByText(/no answers/i);
    fireEvent.click(screen.getByRole("button", { name: "Expected salary" }));

    await waitFor(() => expect(api.answers.create).toHaveBeenCalled());
    expect(api.answers.create).toHaveBeenCalledWith({
      questionPatterns: ["Expected salary"],
      answer: "",
      type: "text",
      category: "screening",
    });
    expect(await screen.findByText("Expected salary")).toBeTruthy();
  });

  it("hides the chip for a suggested question that already has an entry", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([
      {
        id: "salary1",
        questionPatterns: ["Expected salary"],
        answer: "$150k",
        type: "text",
        category: "screening",
      },
    ]);
    render(<AnswersHost />);
    await screen.findByText("$150k");
    expect(screen.queryByRole("button", { name: "Expected salary" })).toBeNull();
    expect(screen.getByRole("button", { name: "Notice period" })).toBeTruthy();
  });

  it("lists existing answer entries with joined patterns", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([entry]);
    render(<AnswersHost />);
    expect(await screen.findByText("Why do you want to work here?")).toBeTruthy();
    expect(screen.getByText("I love the mission.")).toBeTruthy();
  });

  it("creates a new answer from comma-separated patterns", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([]);
    vi.mocked(api.answers.create).mockResolvedValue({
      id: "new1",
      questionPatterns: ["Salary expectations", "Expected salary"],
      answer: "$150k",
      type: "text",
      category: "custom",
    });

    render(<AnswersHost />);
    await screen.findByText(/no answers/i);

    fireEvent.change(screen.getByLabelText("Which questions will this answer?"), {
      target: { value: "Salary expectations, Expected salary" },
    });
    fireEvent.change(screen.getByLabelText("New answer"), { target: { value: "$150k" } });
    fireEvent.click(screen.getByText("Add answer"));

    await waitFor(() => expect(api.answers.create).toHaveBeenCalled());
    expect(api.answers.create).toHaveBeenCalledWith({
      questionPatterns: ["Salary expectations", "Expected salary"],
      answer: "$150k",
      type: "text",
      category: "custom",
    });
    expect(await screen.findByText("$150k")).toBeTruthy();
  });

  it("edits an existing entry", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([entry]);
    vi.mocked(api.answers.update).mockResolvedValue({ ...entry, answer: "Updated answer" });

    render(<AnswersHost />);
    fireEvent.click(await screen.findByLabelText("Edit answer"));

    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "Updated answer" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(api.answers.update).toHaveBeenCalledWith("e1", {
        questionPatterns: ["Why do you want to work here?"],
        answer: "Updated answer",
        type: "text",
        category: "custom",
      }),
    );
    expect(await screen.findByText("Updated answer")).toBeTruthy();
  });

  it("blocks saving an edit with empty question patterns instead of hitting the server", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([entry]);
    render(<AnswersHost />);
    fireEvent.click(await screen.findByLabelText("Edit answer"));

    fireEvent.change(screen.getByLabelText("Which questions does this answer?"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("Save"));

    await new Promise((r) => setTimeout(r, 0));
    expect(api.answers.update).not.toHaveBeenCalled();
    // Edit mode stays open since the save was a no-op.
    expect(screen.getByLabelText("Which questions does this answer?")).toBeTruthy();
  });

  it("blocks saving an edit with an empty answer instead of hitting the server", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([entry]);
    render(<AnswersHost />);
    fireEvent.click(await screen.findByLabelText("Edit answer"));

    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "   " } });
    fireEvent.click(screen.getByText("Save"));

    await new Promise((r) => setTimeout(r, 0));
    expect(api.answers.update).not.toHaveBeenCalled();
  });

  it("deletes an entry after an inline confirm", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([entry]);
    render(<AnswersHost />);

    fireEvent.click(await screen.findByLabelText("Delete answer"));
    fireEvent.click(screen.getByText("Confirm"));

    await waitFor(() => expect(api.answers.remove).toHaveBeenCalledWith("e1"));
    expect(screen.queryByText("Why do you want to work here?")).toBeNull();
  });
});
