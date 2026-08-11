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

  // Without a startup-time event the worker stays dormant until a tab switch
  // or navigation. Registering onStartup guarantees this whole body (panel
  // enablement + orphan reinjection) runs when Chrome launches.
  chrome.runtime.onStartup?.addListener(() => {});

  // The panel opens on ANY page.
  //
  // It used to be enabled per-tab on supported ATS hosts and disabled
  // everywhere else, which made the toolbar icon a silent no-op off an apply
  // page — nothing opened, nothing explained why, and "the extension is
  // broken" is the only fair reading of a button that does nothing. Which page
  // you are on is a question the PANEL answers (fill mode on an apply page,
  // dashboard anywhere else), not one the button should refuse.
  //
  // Enabling globally also drops the old tab-binding trick (disable globally,
  // enable per-tab, so an opened panel closed itself on unrelated tabs). The
  // panel now follows the active tab instead of closing with it, which is what
  // `useActiveTab` has always done anyway.
  if (chrome.sidePanel?.setOptions) {
    void chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true }).catch(() => {});
  }

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

  // Self-healing click: with openPanelOnActionClick, onClicked only fires when
  // the panel could NOT open — enablement lost to a fresh session or a missed
  // event. Re-enable and open inside the user gesture, on whatever page this
  // is: a click that does nothing is never the right answer.
  chrome.action?.onClicked?.addListener((tab) => {
    const tabId = tab.id;
    if (tabId === undefined) return;
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
