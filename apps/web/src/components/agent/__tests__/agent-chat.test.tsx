// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AgentChat } from "../agent-chat";
import { api } from "@/lib/api-client";
import type { AgentStep } from "@/server/agent/loop";

/**
 * What a finished turn LOOKS like.
 *
 * The incident behind these tests: a turn generated a tailored résumé, the
 * answer denied it existed, and the only trace of the work on screen was a
 * collapsed "6 steps · 1 did · 3 failed" — under a warning telling the user to
 * ask something narrower. So the three shapes a turn can end in each get a
 * test: it only talked, it produced something, it produced nothing and was cut
 * off. What the user is told has to match what happened.
 */

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: { agent: { chat: vi.fn(), chatHistory: vi.fn() } },
  };
});

afterEach(cleanup);

const step = (over: Partial<AgentStep>): AgentStep => ({
  tool: "read_application",
  reason: "look at the job",
  ok: true,
  summary: "read it",
  acted: false,
  applicationId: "app-1",
  ...over,
});

/** Seed the persisted thread the chat loads on mount — the same shape the
 *  server stores, so these render paths are the ones a reload goes through. */
function seedThread(answer: string, steps: AgentStep[], ranOutOfSteps = false) {
  vi.mocked(api.agent.chatHistory).mockResolvedValue([
    { id: "m1", role: "user", content: "I want to further fine-tune my resume", at: 1 },
    { id: "m2", role: "assistant", content: answer, steps, ranOutOfSteps, at: 2 },
  ] as unknown as Awaited<ReturnType<typeof api.agent.chatHistory>>);
}

describe("a turn that only answered", () => {
  it("shows the answer and no step trail", async () => {
    seedThread("You have three applications waiting on you.", []);
    render(<AgentChat applicationId="app-1" />);

    expect(await screen.findByText(/three applications waiting/)).toBeTruthy();
    expect(screen.queryByRole("button", { expanded: false })).toBeNull();
    expect(screen.queryByText(/steps/)).toBeNull();
  });
});

describe("a turn that produced something", () => {
  const steps = [
    step({
      tool: "refine_artifact",
      ok: false,
      summary: "there is no tailored résumé to revise yet",
    }),
    step({
      tool: "tailor_resume",
      acted: true,
      summary: "tailored résumé v1",
      artifactKind: "resume",
    }),
  ];

  it("leads with the result, not the step tally", async () => {
    seedThread("I generated a tailored résumé (v1).", steps, true);
    render(<AgentChat applicationId="app-1" />);

    expect(await screen.findByText("Generated a tailored résumé")).toBeTruthy();
    // The machine's effort is not the headline.
    expect(screen.queryByText(/1 did/)).toBeNull();
    expect(screen.queryByText(/2 steps/)).toBeNull();
  });

  it("does not apologise for a truncated turn that still delivered", async () => {
    // ranOutOfSteps is true here: the loop WAS cut off. It produced the thing
    // the user asked for anyway, so "ask something narrower" is wrong.
    seedThread("I generated a tailored résumé (v1).", steps, true);
    render(<AgentChat applicationId="app-1" />);

    await screen.findByText("Generated a tailored résumé");
    expect(screen.queryByText(/Stopped at the step limit/)).toBeNull();
  });

  it("links the produced document to its own workbench, and keeps the counts in the detail", async () => {
    seedThread("I generated a tailored résumé (v1).", steps, true);
    render(<AgentChat applicationId="app-1" />);

    fireEvent.click(await screen.findByRole("button", { expanded: false }));

    const link = screen.getByRole("link", { name: /open in the workbench/i });
    expect(link.getAttribute("href")).toBe("/applications/app-1/doc/resume");
    // Both steps are still shown, failure included, with the tally.
    expect(screen.getByText(/there is no tailored résumé to revise yet/)).toBeTruthy();
    expect(screen.getByText(/2 steps · 1 did · 1 failed/)).toBeTruthy();
  });

  it("names the document a revision touched", async () => {
    seedThread("Shorter now.", [
      step({
        tool: "refine_artifact",
        acted: true,
        summary: "cover letter revised → v2",
        artifactKind: "cover-letter",
      }),
      step({ tool: "read_artifact", summary: "read the letter" }),
    ]);
    render(<AgentChat applicationId="app-1" />);

    expect(await screen.findByText("Revised your cover letter")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("link", { name: /open in the workbench/i }).getAttribute("href")).toBe(
      "/applications/app-1/doc/cover-letter",
    );
  });

  it("a step from before the kind was recorded still points somewhere real", async () => {
    // Threads persisted earlier have no artifactKind. Guessing a document from
    // the tool id would be a second source of truth; the application page is
    // where those links already went.
    seedThread("Done.", [
      step({ tool: "tailor_resume", acted: true, summary: "tailored résumé v1" }),
      step({ tool: "read_artifact", summary: "read it back" }),
    ]);
    render(<AgentChat applicationId="app-1" />);

    fireEvent.click(await screen.findByRole("button", { expanded: false }));
    expect(screen.getByRole("link", { name: /open this application/i }).getAttribute("href")).toBe(
      "/applications/app-1",
    );
  });
});

describe("a turn that produced nothing and ran out of steps", () => {
  it("says so, and reports the steps as counts", async () => {
    // The persisted flag drives the notice, so a reload keeps it.
    seedThread(
      "I could not work out why it stalled.",
      [
        step({ tool: "read_fill_report", ok: false, summary: "no fill yet" }),
        step({ tool: "read_trace", ok: false, summary: "nothing recorded" }),
      ],
      true,
    );
    render(<AgentChat applicationId="app-1" />);

    expect(await screen.findByText(/Stopped at the step limit/)).toBeTruthy();
    // With nothing to show for the turn, the counts ARE the summary.
    expect(screen.getByText(/2 steps/)).toBeTruthy();
    expect(screen.getByText(/2 failed/)).toBeTruthy();
  });
});
