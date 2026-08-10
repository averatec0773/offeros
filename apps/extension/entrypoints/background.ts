import { startDevReload } from "../src/lib/dev-reload";
import { matchAts } from "../src/lib/autofill/recipes";
import { isStartWebAppRequest, startWebAppViaHost } from "../src/lib/web-launcher";
import { captureTab, isCaptureTabRequest } from "../src/lib/tab-capture";
import {
  isOpenFillTabRequest,
  isGetFillBindingRequest,
  isOpenableFillUrl,
  type OpenFillTabResponse,
  type GetFillBindingResponse,
} from "../src/lib/fill-binding";

export default defineBackground(() => {
  // The toolbar action opens the side panel (Chrome only); with
  // openPanelOnActionClick, action.onClicked never fires. No message routing:
  // the content script owns the engine handlers, the side panel calls the web
  // API directly.
  if (chrome.sidePanel?.setPanelBehavior) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }

  // Per-tab sidePanel enablement does NOT survive a browser restart, and
  // without a startup-time event the worker stays dormant until a tab switch
  // or navigation — first click of the day would hit a disabled panel and do
  // nothing. Registering onStartup guarantees this whole body (behavior +
  // enable sweep + orphan reinjection) runs when Chrome launches.
  chrome.runtime.onStartup?.addListener(() => {});

  // The panel only lives on supported ATS tabs. Chrome quirk: with a global
  // default_path, a user-opened panel is "global" and per-tab enabled:false
  // does NOT close it — the documented recipe is to disable the panel
  // globally first, then enable it per-tab, which makes every opened panel
  // inherently tab-bound (closes on unrelated tabs, returns on apply pages).
  if (chrome.sidePanel?.setOptions) {
    void chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
  }
  const updatePanelForTab = (tabId: number, url: string | undefined) => {
    if (!chrome.sidePanel?.setOptions) return;
    const enabled = !!url && matchAts(url) !== null;
    void chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled }).catch(() => {});
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

  // Orphan recovery: reloading the extension invalidates every injected
  // content script, and Chrome never reinjects into already-open tabs — the
  // panel then probes a dead tab forever ("Can't reach this page") until the
  // user manually refreshes it. Ping each ATS tab; where nobody answers,
  // inject the engine (ISOLATED) and the combobox driver (MAIN) again.
  const reinjectOrphanedTabs = async () => {
    if (!chrome.scripting?.executeScript) return;
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id === undefined || !tab.url || matchAts(tab.url) === null) continue;
      try {
        await browser.tabs.sendMessage(tab.id, { kind: "OFFEROS_ENGINE_PING" });
      } catch {
        await chrome.scripting
          .executeScript({ target: { tabId: tab.id }, files: ["content-scripts/ats.js"] })
          .catch(() => {});
        await chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            files: ["content-scripts/ats-driver.js"],
            world: "MAIN",
          })
          .catch(() => {});
      }
    }
  };
  void reinjectOrphanedTabs();

  // Self-healing click: with openPanelOnActionClick, onClicked only fires
  // when the panel could NOT open — i.e. the tab's enablement got lost (fresh
  // session, missed event). Re-enable and open inside the user gesture on
  // apply pages; on unsupported pages a silent click is the designed behavior.
  chrome.action?.onClicked?.addListener((tab) => {
    if (tab.id === undefined || !tab.url || matchAts(tab.url) === null) return;
    const tabId = tab.id;
    void chrome.sidePanel
      .setOptions({ tabId, path: "sidepanel.html", enabled: true })
      .then(() => chrome.sidePanel.open({ tabId }))
      .catch(() => {});
  });

  // Explicit fill-tab bindings: tabId → handoffId, written when the web app
  // asks us to open an apply page and read by the panel to claim the exact
  // handoff (no URL guessing). storage.session survives worker restarts but
  // not browser restarts — correct lifetime, since tab ids reset with the
  // browser anyway.
  const bindingKey = (tabId: number) => `fillBinding:${tabId}`;
  const openFillTab = async (handoffId: string, url: string): Promise<OpenFillTabResponse> => {
    if (!isOpenableFillUrl(url)) return { ok: false };
    try {
      const tab = await browser.tabs.create({ url, active: true });
      if (tab.id === undefined) return { ok: false };
      await chrome.storage.session.set({ [bindingKey(tab.id)]: handoffId });
      return { ok: true, tabId: tab.id };
    } catch {
      return { ok: false };
    }
  };
  const getFillBindingFor = async (tabId: number | undefined): Promise<GetFillBindingResponse> => {
    if (tabId === undefined) return { handoffId: null };
    const key = bindingKey(tabId);
    const stored = await chrome.storage.session.get(key);
    const v = stored[key];
    return { handoffId: typeof v === "string" && v !== "" ? v : null };
  };
  chrome.tabs.onRemoved.addListener((tabId) => {
    void chrome.storage.session.remove(bindingKey(tabId));
  });

  // Panel → native host bridge + fill-binding queries: only the background
  // may talk to the native messaging host or the binding store.
  browser.runtime.onMessage.addListener(
    (msg: unknown, sender: { tab?: { id?: number } }): Promise<unknown> | undefined => {
      if (isStartWebAppRequest(msg)) return startWebAppViaHost();
      if (isCaptureTabRequest(msg)) return captureTab(msg.tabId ?? sender.tab?.id);
      if (isOpenFillTabRequest(msg)) return openFillTab(msg.handoffId, msg.url);
      if (isGetFillBindingRequest(msg)) {
        return getFillBindingFor(msg.tabId ?? sender.tab?.id);
      }
      return undefined;
    },
  );

  // Dev builds only (inert without a build stamp / with an update_url): reload
  // the whole extension when a fresh build lands in the unpacked directory.
  // Slightly delayed so an open side panel can refresh itself first.
  void startDevReload(() => setTimeout(() => browser.runtime.reload(), 400));
});
