import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FillPanel } from "../../src/sidepanel/fill-panel";
import { HomePanel } from "../../src/sidepanel/home-panel";
import { useActiveTab } from "../../src/sidepanel/use-active-tab";
import { Button } from "../../src/components/ui/button";
import { matchAts } from "../../src/lib/autofill/recipes";
import {
  isEnginePageChanged,
  sendEngineAttachFile,
  sendEngineCaptureJd,
  sendEngineFill,
  sendEngineScan,
  sendEngineScrollToField,
  sendEngineExpandRepeaters,
} from "../../src/lib/autofill/autofill-messaging";
import {
  claim,
  computeFit,
  analyzeFields,
  createAnswer,
  createTaskFromJd,
  fetchArtifactPdf,
  fetchResumeFile,
  findApplicationsByJobUrl,
  generateAnswer,
  generateCoverLetter,
  getFit,
  getInbox,
  getPending,
  instantFill,
  listAnswers,
  postEvidence,
  postReport,
  postRepairEvent,
  saveJdFromPage,
  resolveFillAction,
  tailorResume,
  undoSubmission,
  updateAnswer,
} from "../../src/lib/offeros-api";
import { requestTabCapture } from "../../src/lib/tab-capture";
import { settings } from "../../src/lib/settings";
import { requestStartWebApp } from "../../src/lib/web-launcher";
import {
  beginEnable,
  hasSiteAccess,
  requestEnableOnTab,
  requestSiteAccess,
  type SiteAccess,
} from "../../src/lib/site-enable";
import { getFillBindingResult } from "../../src/lib/fill-binding";
import { subscribeAgentEvents } from "../../src/lib/agent-events";
import { ExternalLink, PlugZap } from "lucide-react";

// The web-app fill API, bound to the real fetch. Tests inject fakes into FillPanel directly.
const api = {
  getPending: () => getPending(),
  claim,
  postReport,
  postEvidence,
  generateAnswer,
  analyzeFields,
  findApplicationsByJobUrl,
  createTaskFromJd,
  instantFill,
  tailorResume,
  generateCoverLetter,
  getFit,
  computeFit,
  resolveFillAction,
  undoSubmission,
  postRepairEvent,
  saveJdFromPage,
  fetchResumeFile,
  fetchArtifactPdf,
  listAnswers,
  createAnswer,
  updateAnswer,
};

// The reads the off-ATS dashboard needs, kept separate so HomePanel's surface
// stays the one call it actually makes.
const homeApi = { getInbox: () => getInbox() };

export default function App() {
  const activeTab = useActiveTab();

  /**
   * Tabs the user has switched OfferOS on for.
   *
   * Deliberately per-tab, in memory, and never persisted: "I asked for this
   * page" is a statement about a visit, not a preference. A tab that navigates
   * away loses its injected scripts anyway, so remembering the grant would only
   * make the panel claim a reach it no longer has. The tab-URL effect below
   * drops the id the moment the page changes, which puts the button back where
   * an honest panel would put it — in front of the user.
   */
  const [enabledTabs, setEnabledTabs] = useState<Map<number, string>>(new Map());
  const activeTabId = activeTab?.id;
  const activeTabUrl = activeTab?.url ?? "";
  const enabledHere =
    activeTabId !== undefined &&
    enabledTabs.get(activeTabId) === activeTabUrl &&
    activeTabUrl !== "";
  const supported = (activeTab !== null && matchAts(activeTab.url) !== null) || enabledHere;

  // A navigation ends the grant. Chrome tears the injected scripts down with
  // the document; keeping the entry would leave the panel showing a fill view
  // over a page with no engine in it.
  useEffect(() => {
    if (activeTabId === undefined) return;
    setEnabledTabs((prev) => {
      const remembered = prev.get(activeTabId);
      if (remembered === undefined || remembered === activeTabUrl) return prev;
      const next = new Map(prev);
      next.delete(activeTabId);
      return next;
    });
  }, [activeTabId, activeTabUrl]);

  /**
   * Whether this site is already allowed, worked out when the tab changes.
   *
   * Off the click path on purpose. `permissions.contains` needs no user
   * gesture, and knowing the answer in advance is what lets the click reach
   * `permissions.request` with nothing awaited in front of it — which is the
   * whole fix. It also keeps a user who has already granted this site from
   * being asked again.
   */
  const [siteAccess, setSiteAccess] = useState<SiteAccess>("unknown");
  useEffect(() => {
    let cancelled = false;
    setSiteAccess("unknown");
    if (!activeTabUrl) return;
    void hasSiteAccess(activeTabUrl).then((state) => {
      if (!cancelled) setSiteAccess(state);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTabUrl]);

  // NOT async, and it must stay that way: the first thing this does on a site
  // we know we lack permission for is ask Chrome for it, and that call only
  // works on the click's own stack frame. See `requestSiteAccess`.
  const enableHere = useCallback((): Promise<{ ok: boolean; error?: string }> => {
    if (activeTabId === undefined) {
      return Promise.resolve({ ok: false, error: "No page to enable yet." });
    }
    const tabId = activeTabId;
    return beginEnable(activeTabUrl, {
      siteAccess,
      askForSite: requestSiteAccess,
      inject: () => requestEnableOnTab(tabId),
    }).then((res) => {
      // What the attempt learned about the permission, so a second press can
      // go straight to the prompt.
      if (res.learned) setSiteAccess(res.learned);
      if (res.ok) {
        setEnabledTabs((prev) => new Map(prev).set(tabId, activeTabUrl));
        // The engine has only just arrived; the panel's scan loop is idle by now.
        setRescanNonce((n) => n + 1);
      }
      return res;
    });
  }, [activeTabId, activeTabUrl, siteAccess]);

  const [apiBase, setApiBase] = useState("");
  const [webReachable, setWebReachable] = useState(true);
  const [rescanNonce, setRescanNonce] = useState(0);
  const wasReachableRef = useRef(true);

  useEffect(() => {
    void settings.webApiBase.getValue().then(setApiBase);
  }, []);

  // Ping the web app: only a network error means "not running"; other envelope
  // errors still mean the app answered, so the banner stays hidden. When the app
  // comes back after being down (Retry, or a fixed URL), force a rescan so the
  // panel re-attempts the handoff claim it couldn't make while the app was down.
  const ping = useCallback(async () => {
    const res = await getPending();
    const reachable = res.ok || res.error !== "network error";
    setWebReachable(reachable);
    if (reachable && !wasReachableRef.current) setRescanNonce((n) => n + 1);
    wasReachableRef.current = reachable;
  }, []);
  useEffect(() => {
    void ping();
  }, [ping]);

  const onChangeApiBase = async (value: string) => {
    setApiBase(value);
    await settings.webApiBase.setValue(value);
    await ping();
  };

  // One-click start: background → native host spawns the local server
  // (detached), then we poll until it answers. First dev-server compile can
  // take a while — a generous budget with the existing ping doing the work.
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const onStartWebApp = async () => {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    try {
      // Bounded inside requestStartWebApp itself, next to the message it
      // sends — every runtime.sendMessage in this extension now answers or
      // times out, so "Starting…" can always end. (Deliberately NOT applied to
      // the web API: the generation routes wait on a model, and a timeout short
      // enough to help would abandon real work — see progress.md.)
      const res = await requestStartWebApp();
      if (!res.ok) {
        setStartError(res.error ?? "couldn't start");
        return;
      }
      for (let i = 0; i < 60 && !wasReachableRef.current; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        await ping();
      }
      if (!wasReachableRef.current)
        setStartError("Started, but it isn't answering yet — Retry in a moment.");
    } finally {
      setStarting(false);
    }
  };

  // Page-change push: the content script broadcasts OFFEROS_ENGINE_PAGE_CHANGED;
  // when it's from the active tab, bump the nonce so the panel re-scans.
  useEffect(() => {
    if (activeTab === null) return;
    const listener = (msg: unknown, sender: { tab?: { id?: number } }) => {
      if (isEnginePageChanged(msg) && sender.tab?.id === activeTab.id) setRescanNonce((n) => n + 1);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [activeTab]);

  // Navigation-complete push: a page reload destroys the content script and the
  // panel's probe budget can burn out before the new one injects. The browser
  // knows exactly when the page is ready — restart the probe with a full budget
  // the moment the active tab finishes loading.
  useEffect(() => {
    if (activeTab === null) return;
    const onUpdated = (tabId: number, changeInfo: { status?: string }) => {
      if (tabId === activeTab.id && changeInfo.status === "complete") setRescanNonce((n) => n + 1);
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => browser.tabs.onUpdated.removeListener(onUpdated);
  }, [activeTab]);

  // Server push: a new fill ticket created while this panel is already open
  // (workspace "Open & fill" targeting this page) triggers a fresh claim
  // attempt — previously that needed a page change or reload.
  const [claimNonce, setClaimNonce] = useState(0);
  useEffect(() => {
    if (!webReachable || !apiBase) return;
    return subscribeAgentEvents(apiBase, (event) => {
      if (event.kind === "fill-handoff-created") setClaimNonce((n) => n + 1);
    });
  }, [webReachable, apiBase]);

  const tabId = activeTab?.id ?? -1;
  const scan = useCallback(() => sendEngineScan(tabId), [tabId]);
  const fill = useCallback(
    (values: Parameters<typeof sendEngineFill>[1]) => sendEngineFill(tabId, values),
    [tabId],
  );
  const capture = useCallback(() => sendEngineCaptureJd(tabId), [tabId]);
  const attachFile = useCallback(
    (fieldId: string, file: { fileName: string; mimeType: string; bytesBase64: string }) =>
      sendEngineAttachFile(tabId, fieldId, file.fileName, file.mimeType, file.bytesBase64),
    [tabId],
  );
  const expandRepeaters = useCallback(
    (want: { education: number; experience: number; fallback: number }) =>
      sendEngineExpandRepeaters(tabId, want),
    [tabId],
  );
  const scrollToField = useCallback(
    (fieldId: string) => sendEngineScrollToField(tabId, fieldId),
    [tabId],
  );
  const captureTab = useCallback(() => requestTabCapture(tabId), [tabId]);
  const getBoundHandoff = useCallback(async () => {
    if (tabId < 0) return null;
    const res = await getFillBindingResult(tabId);
    // Both answers send the panel down the URL-matching fallback, but they are
    // not the same fact: one is "this tab was opened by hand", the other is
    // "the background did not answer". The fallback used to absorb the second
    // silently, which is how a broken bus looked exactly like normal use.
    if (!res.answered) console.warn("[offeros] fill-binding lookup unanswered:", res.error);
    return res.handoffId;
  }, [tabId]);
  const navigateTab = useCallback(
    async (url: string) => {
      if (tabId >= 0) await browser.tabs.update(tabId, { url });
    },
    [tabId],
  );
  const openWebApp = useMemo(
    () => () => void browser.tabs.create({ url: apiBase || undefined }),
    [apiBase],
  );
  const openApplication = useCallback(
    (applicationId: string) =>
      void browser.tabs.create({ url: `${apiBase}/applications/${applicationId}` }),
    [apiBase],
  );

  return (
    <div className="flex min-h-screen flex-col bg-bg-base p-3 font-sans text-text-primary">
      <header className="mb-3 flex items-center gap-2 px-1">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-brand" />
        <h1 className="text-body font-semibold">OfferOS</h1>
        <span className="text-caption text-text-tertiary">Apply copilot</span>
      </header>

      {!webReachable && (
        <div className="mb-3 rounded-2xl bg-warn-bg p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <PlugZap aria-hidden className="h-4 w-4 shrink-0 text-warning" />
              <span className="min-w-0 flex-1 text-caption text-text-secondary">
                OfferOS web app not running.
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="primary"
                className="rounded-full"
                disabled={starting}
                onClick={() => void onStartWebApp()}
              >
                {starting ? "Starting…" : "Start OfferOS"}
              </Button>
              <Button className="rounded-full" disabled={starting} onClick={() => void ping()}>
                Retry
              </Button>
            </div>
          </div>
          {startError && <p className="mt-2 text-caption text-warning">{startError}</p>}
        </div>
      )}

      <label className="mb-3 flex items-center gap-2 px-1 text-caption text-text-tertiary">
        <span className="shrink-0">Web app</span>
        <input
          className="min-w-0 flex-1 rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-caption text-text-primary focus:outline-none focus:ring-1 focus:ring-brand"
          value={apiBase}
          onChange={(e) => void onChangeApiBase(e.target.value)}
          aria-label="Web app URL"
        />
        <button
          type="button"
          onClick={openWebApp}
          aria-label="Open the web app"
          title="Open the web app"
          className="inline-flex shrink-0 items-center justify-center rounded-xl border border-border-subtle bg-bg-elevated p-2 text-text-secondary transition-colors hover:text-text-primary"
        >
          <ExternalLink aria-hidden className="h-4 w-4" />
        </button>
      </label>

      <div className="flex-1">
        {supported ? (
          <FillPanel
            scan={scan}
            fill={fill}
            capture={capture}
            attachFile={attachFile}
            scrollToField={scrollToField}
            expandRepeaters={expandRepeaters}
            captureTab={captureTab}
            api={api}
            rescanNonce={rescanNonce}
            openWebApp={openWebApp}
            openApplication={openApplication}
            webReachable={webReachable}
            tabUrl={activeTab?.url ?? ""}
            getBoundHandoff={getBoundHandoff}
            claimNonce={claimNonce}
            navigateTab={navigateTab}
          />
        ) : (
          <HomePanel
            api={homeApi}
            webReachable={webReachable}
            openWebApp={openWebApp}
            openApplication={openApplication}
            tabUrl={activeTab?.url}
            onEnableHere={enableHere}
          />
        )}
      </div>

      <p className="mt-3 px-1 text-caption text-text-tertiary">You submit — OfferOS never does.</p>
    </div>
  );
}
