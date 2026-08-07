import { startDevReload } from "../src/lib/dev-reload";
import { matchAts } from "../src/lib/autofill/recipes";
import { isStartWebAppRequest, startWebAppViaHost } from "../src/lib/web-launcher";

export default defineBackground(() => {
  // The toolbar action opens the side panel (Chrome only); with
  // openPanelOnActionClick, action.onClicked never fires. No message routing:
  // the content script owns the engine handlers, the side panel calls the web
  // API directly.
  if (chrome.sidePanel?.setPanelBehavior) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }

  // The panel only lives on supported ATS tabs: per-tab enablement means an
  // open panel closes itself when the user switches to an unrelated tab and
  // comes back on its own when they return to an apply page — instead of a
  // stale panel following them around the whole browser.
  const updatePanelForTab = (tabId: number, url: string | undefined) => {
    if (!chrome.sidePanel?.setOptions) return;
    const enabled = !!url && matchAts(url) !== null;
    void chrome.sidePanel
      .setOptions({ tabId, path: "sidepanel.html", enabled })
      .catch(() => {});
  };
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError) updatePanelForTab(tabId, tab?.url);
    });
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url !== undefined || changeInfo.status === "complete") {
      updatePanelForTab(tabId, tab.url);
    }
  });
  // Initial sweep so existing tabs are correct right after install/reload
  // (the dev auto-reload restarts this worker on every build).
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) if (tab.id !== undefined) updatePanelForTab(tab.id, tab.url);
  });

  // Panel → native host bridge: only the background may talk to the native
  // messaging host, so the panel's "Start OfferOS" routes through here.
  browser.runtime.onMessage.addListener((msg: unknown): Promise<unknown> | undefined => {
    if (isStartWebAppRequest(msg)) return startWebAppViaHost();
    return undefined;
  });

  // Dev builds only (inert without a build stamp / with an update_url): reload
  // the whole extension when a fresh build lands in the unpacked directory.
  // Slightly delayed so an open side panel can refresh itself first.
  void startDevReload(() => setTimeout(() => browser.runtime.reload(), 400));
});
