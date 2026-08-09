// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useActiveTab } from "../../src/sidepanel/use-active-tab";

// fakeBrowser events expose a `.trigger` the real webext types don't; cast to reach it.
const tabsEvents = browser.tabs as unknown as {
  onActivated: { trigger: (info: unknown) => Promise<void> };
  onUpdated: { trigger: (id: number, ci: unknown, tab: unknown) => Promise<void> };
};

describe("useActiveTab", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the active tab on mount", async () => {
    vi.spyOn(browser.tabs, "query").mockResolvedValue([
      { id: 5, url: "https://boards.greenhouse.io/acme/jobs/1" },
    ] as never);
    const { result } = renderHook(() => useActiveTab());
    await waitFor(() =>
      expect(result.current).toEqual({ id: 5, url: "https://boards.greenhouse.io/acme/jobs/1" }),
    );
  });

  it("re-reads the active tab on tabs.onActivated", async () => {
    const q = vi
      .spyOn(browser.tabs, "query")
      .mockResolvedValue([{ id: 1, url: "https://boards.greenhouse.io/a/jobs/1" }] as never);
    const { result } = renderHook(() => useActiveTab());
    await waitFor(() => expect(result.current?.id).toBe(1));

    q.mockResolvedValue([{ id: 2, url: "https://jobs.lever.co/b/2" }] as never);
    await act(async () => {
      await tabsEvents.onActivated.trigger({ tabId: 2, windowId: 0 });
    });
    await waitFor(() => expect(result.current?.id).toBe(2));
  });

  it("re-reads the active tab when it finishes loading / changes url", async () => {
    const q = vi
      .spyOn(browser.tabs, "query")
      .mockResolvedValue([{ id: 1, url: "https://boards.greenhouse.io/a/jobs/1" }] as never);
    const { result } = renderHook(() => useActiveTab());
    await waitFor(() => expect(result.current?.url).toContain("jobs/1"));

    q.mockResolvedValue([{ id: 1, url: "https://boards.greenhouse.io/a/jobs/2" }] as never);
    await act(async () => {
      await tabsEvents.onUpdated.trigger(
        1,
        { url: "https://boards.greenhouse.io/a/jobs/2" },
        { active: true },
      );
    });
    await waitFor(() => expect(result.current?.url).toContain("jobs/2"));
  });

  it("ignores updates for a non-active tab", async () => {
    vi.spyOn(browser.tabs, "query").mockResolvedValue([
      { id: 1, url: "https://boards.greenhouse.io/a/jobs/1" },
    ] as never);
    const { result } = renderHook(() => useActiveTab());
    await waitFor(() => expect(result.current?.id).toBe(1));
    const before = result.current;
    await act(async () => {
      await tabsEvents.onUpdated.trigger(9, { status: "complete" }, { active: false });
    });
    expect(result.current).toBe(before);
  });
});
