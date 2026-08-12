// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "../../entrypoints/sidepanel/App";
import type { ScanResponse } from "../../src/lib/autofill/autofill-messaging";

const scanResp: ScanResponse = {
  ok: true,
  atsId: "greenhouse",
  url: "https://boards.greenhouse.io/acme/jobs/1",
  company: "Acme",
  title: "Engineer",
  descriptors: [
    {
      fieldId: "f1",
      label: "Email",
      name: "email",
      autocomplete: "email",
      type: "email",
      placeholder: "",
      ariaLabel: "",
    },
  ],
};

describe("Side panel App", () => {
  beforeEach(() => {
    // No web app in tests → every offeros-api call is a network error.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("net");
      }),
    );
    vi.spyOn(browser.tabs, "query").mockResolvedValue([{ id: 7, url: scanResp.url }] as never);
    (browser.tabs as unknown as { sendMessage: unknown }).sendMessage = vi.fn(
      async (_id: number, msg: { kind: string; values?: { fieldId: string }[] }) => {
        if (msg.kind === "OFFEROS_ENGINE_SCAN") return scanResp;
        if (msg.kind === "OFFEROS_ENGINE_FILL")
          return {
            ok: true,
            filled: msg.values!.length,
            outcomes: msg.values!.map((v) => [v.fieldId, "filled"]),
          };
        return undefined;
      },
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the OfferOS heading and the never-submit footer", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "OfferOS" })).toBeInTheDocument();
    expect(screen.getByText("You submit — OfferOS never does.")).toBeInTheDocument();
  });

  it("unsupported tab shows the dashboard — a way into the web app, and where filling works", async () => {
    (
      browser.tabs.query as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue([{ id: 7, url: "https://example.com/careers" }]);
    render(<App />);
    // The panel opens anywhere now, so this state is a dashboard rather than
    // the old "you're on the wrong page" apology.
    expect(await screen.findByText("Needs you")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your applications" })).toBeInTheDocument();
    // Orientation is kept, demoted below the dashboard.
    for (const name of ["Greenhouse", "Lever", "Ashby", "Workday"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("supported ATS tab mounts the fill panel, scans over tabs.sendMessage, and warns the web app is down", async () => {
    render(<App />);
    // scanned fields render (engine-side, independent of the web app)
    expect(await screen.findByText("Email")).toBeInTheDocument();
    // web app unreachable → banner
    expect(await screen.findByText("OfferOS web app not running.")).toBeInTheDocument();
    // the one-click native-host launcher is offered next to Retry
    expect(screen.getByRole("button", { name: "Start OfferOS" })).toBeInTheDocument();
  });
});
