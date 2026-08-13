import { startDevReload } from "../src/lib/dev-reload";
import { reasonOf, respondWith, type SendResponse } from "../src/lib/respond";
import { matchAts } from "../src/lib/autofill/recipes";
import { isStartWebAppRequest, startWebAppViaHost } from "../src/lib/web-launcher";
import { captureTab, isCaptureTabRequest } from "../src/lib/tab-capture";
import { enableOnTab, injectEngine, isEnableOnTabRequest } from "../src/lib/site-enable";
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
        // Same pair the enable button injects — one definition, so a third
        // script can never be added to one path and forgotten in the other.
        await injectEngine(tab.id, chrome.scripting).catch(() => {});
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
  //
  // Every branch answers through `respondWith`, which returns `true` and
  // guarantees exactly one `sendResponse` — on success, on rejection, and on
  // work that never finishes. These listeners used to return promises instead,
  // which is the polyfill idiom and not what Chrome documents; this extension
  // ships no polyfill, so the native rules are the rules. A message that goes
  // unanswered produces no error anywhere and leaves the caller waiting, so the
  // shape of the answer is not a style question.
  //
  // A message we do not recognise falls through returning `undefined`: no
  // response and no claim on the channel, so another listener may answer it.
  browser.runtime.onMessage.addListener(
    (msg: unknown, sender: { tab?: { id?: number } }, sendResponse: SendResponse) => {
      if (isStartWebAppRequest(msg)) {
        return respondWith(startWebAppViaHost(), sendResponse, (error) => ({
          ok: false as const,
          error: reasonOf(error),
        }));
      }
      if (isCaptureTabRequest(msg)) {
        return respondWith(captureTab(msg.tabId ?? sender.tab?.id), sendResponse, (error) => ({
          ok: false as const,
          error: reasonOf(error),
        }));
      }
      if (isOpenFillTabRequest(msg)) {
        return respondWith(openFillTab(msg.handoffId, msg.url), sendResponse, () => ({
          ok: false as const,
        }));
      }
      if (isGetFillBindingRequest(msg)) {
        return respondWith(
          getFillBindingFor(msg.tabId ?? sender.tab?.id),
          sendResponse,
          // A failure is not the same as "no binding", and the caller is told
          // which: it falls back to guessing from the URL on one and not the
          // other.
          (error) => ({ handoffId: null, error: reasonOf(error) }),
        );
      }
      // "Enable OfferOS on this page": the user asked for this tab, so the
      // engine goes into this tab. The URL is read from the tab itself rather
      // than taken from the panel's message — the panel's copy could be stale
      // by a navigation, and the check that decides whether a page may be
      // injected has to run against the page actually being injected.
      if (isEnableOnTabRequest(msg)) {
        const { tabId } = msg;
        return respondWith(
          browser.tabs
            .get(tabId)
            .then((tab) => enableOnTab(tabId, tab.url ?? "", chrome.scripting)),
          sendResponse,
          () => ({ ok: false as const, error: "That tab is gone — open the page again." }),
        );
      }
      return undefined;
    },
  );

  // Dev builds only (inert without a build stamp / with an update_url): reload
  // the whole extension when a fresh build lands in the unpacked directory.
  // Slightly delayed so an open side panel can refresh itself first.
  void startDevReload(() => setTimeout(() => browser.runtime.reload(), 400));
});
