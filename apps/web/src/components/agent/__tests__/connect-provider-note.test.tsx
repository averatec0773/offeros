// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ConnectProviderNote } from "../connect-provider-note";

afterEach(cleanup);

describe("ConnectProviderNote", () => {
  it("renders the given message with a Settings → AI link", () => {
    render(<ConnectProviderNote message="Connect your AI provider to start" />);

    expect(screen.getByText(/Connect your AI provider to start/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Settings → AI" });
    expect(link.getAttribute("href")).toBe("/settings/ai");
  });
});
