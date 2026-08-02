// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { StyleSettings } from "../style-settings";
import { api } from "@/lib/api-client";
import type { StyleMemorySetting } from "@/server/repositories/style-memory-repo";

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return {
    ...actual,
    api: {
      settings: {
        style: {
          list: vi.fn(),
          update: vi.fn(),
        },
      },
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseSettings: StyleMemorySetting[] = [
  {
    kind: "resume",
    notes: "- Prefers active voice.",
    enabled: true,
    sourceCount: 4,
    updatedAt: new Date("2026-07-01T00:00:00Z").getTime(),
  },
  { kind: "cover-letter", notes: "", enabled: true, sourceCount: 0, updatedAt: null },
];

function mockLoad(settings: StyleMemorySetting[] = baseSettings) {
  vi.mocked(api.settings.style.list).mockResolvedValue(settings);
}

function sectionFor(kindLabel: string): HTMLElement {
  return screen.getByRole("group", { name: kindLabel });
}

describe("StyleSettings", () => {
  it("renders each kind's notes, enabled state and learned-from caption", async () => {
    mockLoad();
    render(<StyleSettings />);

    expect(await screen.findByDisplayValue("- Prefers active voice.")).toBeTruthy();
    expect(screen.getByText(/Learned from 4 approvals/)).toBeTruthy();
  });

  it("omits the learned-from caption for a kind that has never been saved", async () => {
    mockLoad();
    render(<StyleSettings />);
    await screen.findByDisplayValue("- Prefers active voice.");

    expect(screen.queryByText(/Learned from 0 approvals/)).toBeNull();
  });

  it("shows the privacy explainer", async () => {
    mockLoad();
    render(<StyleSettings />);
    await screen.findByDisplayValue("- Prefers active voice.");

    expect(
      screen.getByText(
        "OfferOS learns your style preferences from your tweaks — never companies, titles, or facts. Edit or clear anytime.",
      ),
    ).toBeTruthy();
  });

  it("shows a live character count that updates as notes are edited", async () => {
    mockLoad();
    render(<StyleSettings />);
    const textarea = await screen.findByDisplayValue("- Prefers active voice.");

    expect(screen.getByText("23/2000")).toBeTruthy();
    fireEvent.change(textarea, { target: { value: "short" } });
    expect(screen.getByText("5/2000")).toBeTruthy();
  });

  it("enforces the 2000-char cap client-side on the textarea", async () => {
    mockLoad();
    render(<StyleSettings />);
    const textarea = (await screen.findByDisplayValue(
      "- Prefers active voice.",
    )) as HTMLTextAreaElement;

    expect(textarea.maxLength).toBe(2000);
  });

  it("saves edited notes via api.settings.style.update", async () => {
    mockLoad();
    vi.mocked(api.settings.style.update).mockResolvedValue([
      { ...baseSettings[0]!, notes: "- Keep it short." },
      baseSettings[1]!,
    ]);
    render(<StyleSettings />);
    const textarea = await screen.findByDisplayValue("- Prefers active voice.");

    fireEvent.change(textarea, { target: { value: "- Keep it short." } });
    const resumeSection = sectionFor("Résumé");
    fireEvent.click(within(resumeSection).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.settings.style.update).toHaveBeenCalledWith("resume", {
        notes: "- Keep it short.",
      }),
    );
  });

  it("toggles enabled immediately via api.settings.style.update", async () => {
    mockLoad();
    vi.mocked(api.settings.style.update).mockResolvedValue([
      { ...baseSettings[0]!, enabled: false },
      baseSettings[1]!,
    ]);
    render(<StyleSettings />);
    await screen.findByDisplayValue("- Prefers active voice.");

    const resumeSection = sectionFor("Résumé");
    const toggle = within(resumeSection).getByRole("checkbox");
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(api.settings.style.update).toHaveBeenCalledWith("resume", { enabled: false }),
    );
  });

  it("clears notes via the Clear button", async () => {
    mockLoad();
    vi.mocked(api.settings.style.update).mockResolvedValue([
      { ...baseSettings[0]!, notes: "" },
      baseSettings[1]!,
    ]);
    render(<StyleSettings />);
    await screen.findByDisplayValue("- Prefers active voice.");

    const resumeSection = sectionFor("Résumé");
    fireEvent.click(within(resumeSection).getByRole("button", { name: "Clear" }));

    await waitFor(() =>
      expect(api.settings.style.update).toHaveBeenCalledWith("resume", { notes: "" }),
    );
    await waitFor(() => {
      const ta = within(resumeSection).getByRole("textbox") as HTMLTextAreaElement;
      expect(ta.value).toBe("");
    });
  });
});
