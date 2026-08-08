// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AgentStatusBar } from "../agent-status-bar";

afterEach(cleanup);

describe("AgentStatusBar", () => {
  it("standby-empty: Standby label, zero-jobs message, and a Start button", () => {
    render(<AgentStatusBar state="standby-empty" jobCount={0} />);
    expect(screen.getByText("Standby")).toBeTruthy();
    expect(screen.getByText("0 Jobs Added. Add Jobs To Begin.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Start/ })).toBeTruthy();
  });

  it("standby-queued: interpolates the job count into the message", () => {
    render(<AgentStatusBar state="standby-queued" jobCount={5} />);
    expect(screen.getByText("Standby")).toBeTruthy();
    expect(screen.getByText("5 Jobs Added. Awaiting Application Start.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Start/ })).toBeTruthy();
  });

  it("running: Running label and a Pause button", () => {
    render(<AgentStatusBar state="running" jobCount={3} />);
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText(/Applying/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pause/ })).toBeTruthy();
  });

  it("action-required: Action Required label and the missing-fields message", () => {
    render(<AgentStatusBar state="action-required" jobCount={2} />);
    expect(screen.getByText("Action Required")).toBeTruthy();
    expect(screen.getByText("Fill in Missing Fields")).toBeTruthy();
  });

  it("fires onAction when the primary button is clicked, and disables it when omitted", () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <AgentStatusBar state="standby-empty" jobCount={0} onAction={onAction} />,
    );
    const button = screen.getByRole("button", { name: /Start/ });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);

    rerender(<AgentStatusBar state="standby-empty" jobCount={0} />);
    const inertButton = screen.getByRole("button", { name: /Start/ });
    expect((inertButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("always renders the job list button and a settings link", () => {
    render(<AgentStatusBar state="running" jobCount={1} />);
    expect(screen.getByRole("button", { name: "Job list" })).toBeTruthy();
    expect((screen.getByRole("link", { name: "Settings" }) as HTMLAnchorElement).href).toContain(
      "/settings",
    );
  });

  it("the list button opens a queue popover with every application, current flagged", async () => {
    render(
      <AgentStatusBar
        state="running"
        jobCount={2}
        queue={[
          { id: "a1", title: "Engineer", company: "Acme", status: "applying", current: true },
          { id: "a2", title: "Analyst", company: "Beta", status: "saved" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Job list" }));
    expect(screen.getByText("Engineer")).toBeTruthy();
    expect(screen.getByText("current")).toBeTruthy();
    const analystRow = screen.getByText("Analyst").closest("a") as HTMLAnchorElement;
    expect(analystRow.href).toContain("/applications/a2");
    expect(screen.getByText("saved")).toBeTruthy();
    // Toggles closed again.
    fireEvent.click(screen.getByRole("button", { name: "Job list" }));
    expect(screen.queryByText("Engineer")).toBeNull();
  });

  it("the list button shows an honest empty state with no applications", () => {
    render(<AgentStatusBar state="standby-empty" jobCount={0} queue={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Job list" }));
    expect(screen.getByText(/No applications yet/)).toBeTruthy();
  });
});
