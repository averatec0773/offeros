// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePanel, type HomePanelApi } from "../../src/sidepanel/home-panel";
import type { InboxItem } from "../../src/lib/offeros-api";

/**
 * The off-ATS dashboard. It exists because the toolbar icon now opens the
 * panel on ANY page — this is what the user sees there, so it has to be worth
 * seeing: what needs them, and one way into the web app.
 */

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  applicationId: "a1",
  jobTitle: "ML Engineer",
  companyName: "Acme",
  kind: "missing-fields",
  headline: "3 fields still need you",
  at: 1,
  ...over,
});

function mount(over: { items?: InboxItem[]; ok?: boolean; webReachable?: boolean } = {}) {
  const api: HomePanelApi = {
    getInbox: vi.fn(async () =>
      over.ok === false
        ? ({ ok: false, error: "network error" } as const)
        : ({ ok: true, value: over.items ?? [] } as const),
    ),
  };
  const openWebApp = vi.fn();
  const openApplication = vi.fn();
  render(
    <HomePanel
      api={api}
      webReachable={over.webReachable ?? true}
      openWebApp={openWebApp}
      openApplication={openApplication}
    />,
  );
  return { api, openWebApp, openApplication };
}

describe("HomePanel (the off-ATS dashboard)", () => {
  it("lists what needs the user and opens that application in the web app", async () => {
    const { openApplication } = mount({
      items: [
        item(),
        item({ applicationId: "a2", headline: "Ready to submit", companyName: "Bo" }),
      ],
    });

    expect(await screen.findByText("2 things waiting on you.")).toBeInTheDocument();
    expect(screen.getByText("3 fields still need you")).toBeInTheDocument();
    expect(screen.getByText("ML Engineer at Acme")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Ready to submit"));
    expect(openApplication).toHaveBeenCalledWith("a2");
  });

  it("says so plainly when nothing is waiting", async () => {
    mount({ items: [] });
    expect(await screen.findByText("Nothing is waiting on you.")).toBeInTheDocument();
  });

  it("counts one waiting item in the singular", async () => {
    mount({ items: [item()] });
    expect(await screen.findByText("1 thing waiting on you.")).toBeInTheDocument();
  });

  it("Open OfferOS is always there — the jump to the web app is the point", async () => {
    const { openWebApp } = mount({ items: [] });
    await userEvent.click(screen.getByRole("button", { name: "Open OfferOS" }));
    expect(openWebApp).toHaveBeenCalled();
  });

  it("caps the list and offers the rest in the web app", async () => {
    const { openWebApp } = mount({
      items: Array.from({ length: 8 }, (_, i) =>
        item({ applicationId: `a${i}`, headline: `Item ${i}` }),
      ),
    });

    expect(await screen.findByText("8 things waiting on you.")).toBeInTheDocument();
    expect(screen.getByText("Item 4")).toBeInTheDocument();
    expect(screen.queryByText("Item 5")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("3 more in the web app"));
    expect(openWebApp).toHaveBeenCalled();
  });

  it("does not call the API at all while the web app is known to be down", async () => {
    const { api } = mount({ webReachable: false });
    expect(await screen.findByText("Can't reach the OfferOS web app.")).toBeInTheDocument();
    expect(api.getInbox).not.toHaveBeenCalled();
  });

  it("degrades to an honest line when the read fails", async () => {
    mount({ ok: false });
    expect(await screen.findByText("Can't reach the OfferOS web app.")).toBeInTheDocument();
  });

  it("still says where filling works, so the panel orients as well as reports", () => {
    mount({ items: [] });
    expect(screen.getByText("Filling works here")).toBeInTheDocument();
    for (const name of ["Greenhouse", "Lever", "Ashby", "iCIMS", "Workday"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});
