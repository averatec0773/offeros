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

function mount(
  over: {
    items?: InboxItem[];
    ok?: boolean;
    webReachable?: boolean;
    tabUrl?: string;
    onEnableHere?: () => Promise<{ ok: boolean; error?: string }>;
  } = {},
) {
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
      tabUrl={over.tabUrl}
      onEnableHere={over.onEnableHere}
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
    // Renamed from "Filling works here": filling now works anywhere the user
    // enables it, so this list is about where no button is needed.
    expect(screen.getByText("Always on here")).toBeInTheDocument();
    for (const name of ["Greenhouse", "Lever", "Ashby", "iCIMS", "Workday"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});

/**
 * "Enable OfferOS on this page."
 *
 * The engine reaches a page by being injected, and injection follows the
 * manifest's five-platform match list. Everywhere else the panel had nothing to
 * offer. The button is the answer — but it must only appear where it can
 * actually work, because a button that does nothing reads as a broken
 * extension rather than a restricted one.
 */
describe("enabling OfferOS on an ordinary site", () => {
  const enable = () => vi.fn(async () => ({ ok: true }));

  it("offers the button on an ordinary web page", async () => {
    mount({ tabUrl: "https://careers.example.com/jobs/1", onEnableHere: enable() });
    expect(
      await screen.findByRole("button", { name: /Enable OfferOS on this page/ }),
    ).toBeInTheDocument();
  });

  it("says the grant is for this page and this visit", async () => {
    mount({ tabUrl: "https://careers.example.com/jobs/1", onEnableHere: enable() });
    // The promise the button makes is the whole privacy posture of the feature;
    // it has to be in front of the user at the moment they press it.
    expect(await screen.findByText(/this page, this visit/i)).toBeInTheDocument();
  });

  it("injects on click", async () => {
    const onEnableHere = enable();
    mount({ tabUrl: "https://careers.example.com/jobs/1", onEnableHere });
    await userEvent.click(
      await screen.findByRole("button", { name: /Enable OfferOS on this page/ }),
    );
    expect(onEnableHere).toHaveBeenCalledTimes(1);
  });

  it("shows a refused injection instead of doing nothing", async () => {
    const onEnableHere = vi.fn(async () => ({
      ok: false,
      error: "Couldn't start OfferOS on this page: Cannot access contents of the page",
    }));
    mount({ tabUrl: "https://careers.example.com/jobs/1", onEnableHere });
    await userEvent.click(
      await screen.findByRole("button", { name: /Enable OfferOS on this page/ }),
    );
    expect(await screen.findByText(/Cannot access contents of the page/)).toBeInTheDocument();
  });

  it("explains a browser page instead of offering a button that cannot work", async () => {
    mount({ tabUrl: "chrome://extensions", onEnableHere: enable() });
    expect(await screen.findByText(/ordinary web pages/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enable OfferOS on this page/ })).toBeNull();
  });

  it("explains the Web Store, which Chrome forbids outright", async () => {
    mount({ tabUrl: "https://chromewebstore.google.com/detail/abc", onEnableHere: enable() });
    expect(await screen.findByText(/Web Store/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enable OfferOS on this page/ })).toBeNull();
  });

  it("offers nothing while the tab is still resolving", async () => {
    mount({ onEnableHere: enable() });
    await screen.findByText("Nothing is waiting on you.");
    expect(screen.queryByText(/Use OfferOS on this page/)).toBeNull();
  });
});
