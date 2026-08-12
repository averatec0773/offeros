// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { ApplicationEvent } from "@offeros/core";
import { TimelineCard } from "../timeline-card";

afterEach(cleanup);

const ALL_KINDS: ApplicationEvent[] = [
  { id: "e1", applicationId: "app-1", kind: "task-started", at: 1000 },
  {
    id: "e2",
    applicationId: "app-1",
    kind: "step-completed",
    at: 2000,
    payload: { step: "tailor-resume" },
  },
  {
    id: "e3",
    applicationId: "app-1",
    kind: "artifact-tweaked",
    at: 3000,
    payload: { kind: "resume", instruction: "Make it punchier" },
  },
  {
    id: "e4",
    applicationId: "app-1",
    kind: "artifact-approved",
    at: 4000,
    payload: { kind: "cover-letter" },
  },
  {
    id: "e5",
    applicationId: "app-1",
    kind: "fill-reported",
    at: 5000,
    payload: { filled: 12, needsAttention: 2 },
  },
  { id: "e6", applicationId: "app-1", kind: "marked-submitted", at: 6000 },
  {
    id: "e7",
    applicationId: "app-1",
    kind: "style-distilled",
    at: 7000,
    payload: { kind: "resume" },
  },
];

describe("TimelineCard", () => {
  it("renders the exact human label for every event kind", () => {
    render(<TimelineCard applicationId="app-1" events={ALL_KINDS} />);
    // Only the newest few show unasked; the labels are what is under test.
    fireEvent.click(screen.getByRole("button", { name: /Show all/i }));

    expect(screen.getByText("Started")).toBeTruthy();
    expect(screen.getByText("Completed: Tailor resume")).toBeTruthy();
    expect(screen.getByText('Tweaked résumé: "Make it punchier"')).toBeTruthy();
    expect(screen.getByText("Approved cover letter")).toBeTruthy();
    expect(screen.getByText("Fill reported: 12 filled · 2 need attention")).toBeTruthy();
    expect(screen.getByText("Marked as submitted")).toBeTruthy();
    expect(screen.getByText("Style preferences updated")).toBeTruthy();
  });

  it("shows only the newest few unasked, newest first", () => {
    render(<TimelineCard applicationId="app-1" events={ALL_KINDS} />);

    // A record should say what just happened; seven lines of history is not
    // that, and it pushed everything below it off the screen.
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(screen.getAllByRole("listitem")[0]!).getByText("Style preferences updated"),
    ).toBeTruthy();
    expect(screen.queryByText("Started")).toBeNull();
  });

  it("shows the whole history on request, oldest last", () => {
    render(<TimelineCard applicationId="app-1" events={ALL_KINDS} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 7" }));

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(7);
    expect(within(items[0]!).getByText("Style preferences updated")).toBeTruthy();
    expect(within(items[items.length - 1]!).getByText("Started")).toBeTruthy();
  });

  it("shows the empty-state copy when there are no events", () => {
    render(<TimelineCard applicationId="app-1" events={[]} />);
    expect(screen.getByText("No history yet — events are recorded from now on.")).toBeTruthy();
  });

  it("folds the history back up again", () => {
    render(<TimelineCard applicationId="app-1" events={ALL_KINDS} />);

    fireEvent.click(screen.getByRole("button", { name: "Show all 7" }));
    expect(screen.getByText("Started")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.queryByText("Started")).toBeNull();
  });

  it("reads an evidence screenshot as an event, so it needs no card of its own", () => {
    render(
      <TimelineCard
        applicationId="app-1"
        events={[
          {
            id: "e-shot",
            applicationId: "app-1",
            kind: "evidence-captured",
            at: 9,
            payload: { label: "Why this company?", file: "/tmp/a.png" },
          },
        ]}
      />,
    );
    expect(screen.getByText("Screenshot kept: Why this company?")).toBeTruthy();
  });

  it("exports the raw event list as JSON with the applicationId in the filename", () => {
    render(<TimelineCard applicationId="app-42" events={ALL_KINDS} />);

    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    let capturedDownload = "";
    const downloadSetter = vi
      .spyOn(HTMLAnchorElement.prototype, "download", "set")
      .mockImplementation(function (this: HTMLAnchorElement, value: string) {
        capturedDownload = value;
      });

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toContain("application/json");
    expect(capturedDownload).toBe("offeros-events-app-42.json");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // The revoke is deferred (setTimeout 0), not synchronous with the click.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    vi.useRealTimers();
    clickSpy.mockRestore();
    downloadSetter.mockRestore();
    vi.unstubAllGlobals();
  });
});
