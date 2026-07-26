// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SectionNav } from "../section-nav";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const items = [
  { id: "personal", label: "Personal" },
  { id: "skills", label: "Skills" },
];

describe("SectionNav", () => {
  it("renders a tab per item with the first active by default", () => {
    render(<SectionNav items={items} />);
    expect(screen.getByText("Personal").getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("Skills").getAttribute("aria-current")).toBeNull();
  });

  it("scrolls the target section into view and marks it active on click", () => {
    const scrollIntoView = vi.fn();
    vi.spyOn(document, "getElementById").mockReturnValue({
      scrollIntoView,
    } as unknown as HTMLElement);

    render(<SectionNav items={items} />);
    fireEvent.click(screen.getByText("Skills"));

    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.getByText("Skills").getAttribute("aria-current")).toBe("true");
  });

  it("renders the save-status text for each state", () => {
    const { rerender } = render(<SectionNav items={items} saveStatus="idle" />);
    // idle shows no status text.
    expect(screen.queryByText("Saving…")).toBeNull();
    expect(screen.queryByText("All changes saved")).toBeNull();

    rerender(<SectionNav items={items} saveStatus="saving" />);
    expect(screen.getByText("Saving…")).toBeTruthy();

    rerender(<SectionNav items={items} saveStatus="saved" />);
    expect(screen.getByText("All changes saved")).toBeTruthy();
  });

  it("shows an error message and calls onRetry when the retry affordance is clicked", () => {
    const onRetry = vi.fn();
    render(<SectionNav items={items} saveStatus="error" onRetry={onRetry} />);

    expect(screen.getByText(/couldn't save/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
