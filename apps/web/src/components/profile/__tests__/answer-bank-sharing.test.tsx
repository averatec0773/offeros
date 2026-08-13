// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { AnswerEntry } from "@offeros/core";
import { AnswersEditor } from "../answers-editor";
import { EeoEditor } from "../eeo-editor";
import { useAnswerBank } from "../use-answer-bank";
import { api } from "@/lib/api-client";

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

/**
 * The Profile page, in miniature: two views of one answer bank.
 *
 * They used to fetch their own copies and never speak. So the Answers list
 * showed the Equal Employment questions as well — same storage, second
 * front-end — and a user who deleted them there as duplicates destroyed the
 * only copy while the EEO rows above went on displaying the old values. The
 * next application had nothing to say about work authorization, and nothing on
 * screen had ever stopped looking right.
 */
function ProfileSections() {
  const bank = useAnswerBank();
  return (
    <>
      <div data-testid="answers">
        <AnswersEditor bank={bank} />
      </div>
      <div data-testid="eeo">
        <EeoEditor bank={bank} />
      </div>
    </>
  );
}

const eeoEntry: AnswerEntry = {
  id: "eeo1",
  questionPatterns: ["Are you a veteran?", "veteran"],
  answer: "I am not a protected veteran",
  type: "enum",
  category: "eeo",
};

const customEntry: AnswerEntry = {
  id: "c1",
  questionPatterns: ["Why do you want to work here?"],
  answer: "I love the mission.",
  type: "text",
  category: "custom",
};

describe("one answer bank, two views of it", () => {
  it("keeps Equal Employment answers out of the Answers list", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([eeoEntry, customEntry]);
    render(<ProfileSections />);

    const answers = within(screen.getByTestId("answers"));
    expect(await answers.findByText("Why do you want to work here?")).toBeTruthy();
    // The EEO entry is still in the bank and still fills forms; it is simply
    // not offered here as a second thing to edit and delete.
    expect(answers.queryByText("Are you a veteran?")).toBeNull();
    expect(answers.getByText(/managed in the section below/i)).toBeTruthy();
  });

  it("shows an EEO row as stored, not merely as recently clicked", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([eeoEntry]);
    render(<ProfileSections />);

    const eeo = within(screen.getByTestId("eeo"));
    const select = (await eeo.findByLabelText("Are you a veteran?")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("I am not a protected veteran"));
    expect(eeo.getAllByText("Saved").length).toBeGreaterThan(0);
    // Nine of the ten questions have no answer, and say so rather than nothing.
    expect(eeo.getAllByText("Not set")).toHaveLength(9);
  });

  it("a deletion in one view stops the other from claiming the answer is set", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([eeoEntry, customEntry]);
    vi.mocked(api.answers.remove).mockResolvedValue({ id: "eeo1" });
    render(<ProfileSections />);

    const eeo = within(screen.getByTestId("eeo"));
    const select = (await eeo.findByLabelText("Are you a veteran?")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("I am not a protected veteran"));

    // Clearing it from the EEO side is the deletion the user meant to make.
    fireEvent.change(select, { target: { value: "" } });

    await waitFor(() => expect(api.answers.remove).toHaveBeenCalledWith("eeo1"));
    // The row must not go on showing a value the bank no longer holds.
    await waitFor(() => expect(select.value).toBe(""));
    await waitFor(() => expect(eeo.getAllByText("Not set")).toHaveLength(10));
  });

  it("an answer added in the Answers list appears without a second fetch", async () => {
    vi.mocked(api.answers.list).mockResolvedValue([]);
    vi.mocked(api.answers.create).mockResolvedValue(customEntry);
    render(<ProfileSections />);

    const answers = within(screen.getByTestId("answers"));
    fireEvent.change(await answers.findByLabelText("Which questions will this answer?"), {
      target: { value: "Why do you want to work here?" },
    });
    fireEvent.change(answers.getByLabelText("New answer"), {
      target: { value: "I love the mission." },
    });
    fireEvent.click(answers.getByRole("button", { name: "Add answer" }));

    expect(await answers.findByText("Why do you want to work here?")).toBeTruthy();
    expect(api.answers.list).toHaveBeenCalledTimes(1);
  });
});
