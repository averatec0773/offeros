import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FillPanel } from "../../src/sidepanel/fill-panel";
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
} from "../../src/lib/autofill/autofill-messaging";
import {
  claim,
  computeFit,
  createAnswer,
  createTaskFromJd,
  fetchArtifactPdf,
  fetchResumeFile,
  findApplicationsByJobUrl,
  generateAnswer,
  generateCoverLetter,
  getFit,
  getPending,
  instantFill,
  listAnswers,
  postReport,
  resolveFillAction,
  tailorResume,
  undoSubmission,
  updateAnswer,
} from "../../src/lib/offeros-api";
import { settings } from "../../src/lib/settings";
import { requestStartWebApp } from "../../src/lib/web-launcher";
import { getFillBinding } from "../../src/lib/fill-binding";
import { subscribeAgentEvents } from "../../src/lib/agent-events";
import { ExternalLink, PlugZap } from "lucide-react";

// Supported ATS shown to orient the user on an unsupported page. Data, not UI copy.
const PLATFORMS = [
  { name: "Greenhouse", host: "boards.greenhouse.io" },
  { name: "Lever", host: "jobs.lever.co" },
  { name: "Ashby", host: "jobs.ashbyhq.com" },
  { name: "iCIMS", host: "careers-*.icims.com" },
  { name: "Workday", host: "*.myworkdayjobs.com" },
] as const;

// The web-app fill API, bound to the real fetch. Tests inject fakes into FillPanel directly.
const api = {
  getPending: () => getPending(),
  claim,
  postReport,
  generateAnswer,
  findApplicationsByJobUrl,
  createTaskFromJd,
  instantFill,
  tailorResume,
  generateCoverLetter,
  getFit,
  computeFit,
  resolveFillAction,
  undoSubmission,
  fetchResumeFile,
  fetchArtifactPdf,
  listAnswers,
  createAnswer,
  updateAnswer,
};

export default function App() {
  const activeTab = useActiveTab();
  const supported = activeTab !== null && matchAts(activeTab.url) !== null;

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
      const res = await requestStartWebApp();
      if (!res.ok) {
        setStartError(res.error ?? "couldn't start");
        return;
      }
      for (let i = 0; i < 60 && !wasReachableRef.current; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        await ping();
      }
      if (!wasReachableRef.current) setStartError("Started, but it isn't answering yet — Retry in a moment.");
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
  const fill = useCallback((values: Parameters<typeof sendEngineFill>[1]) => sendEngineFill(tabId, values), [tabId]);
  const capture = useCallback(() => sendEngineCaptureJd(tabId), [tabId]);
  const attachFile = useCallback(
    (fieldId: string, file: { fileName: string; mimeType: string; bytesBase64: string }) =>
      sendEngineAttachFile(tabId, fieldId, file.fileName, file.mimeType, file.bytesBase64),
    [tabId],
  );
  const scrollToField = useCallback(
    (fieldId: string) => sendEngineScrollToField(tabId, fieldId),
    [tabId],
  );
  const getBoundHandoff = useCallback(
    () => (tabId >= 0 ? getFillBinding(tabId) : Promise.resolve(null)),
    [tabId],
  );
  const openWebApp = useMemo(() => () => void browser.tabs.create({ url: apiBase || undefined }), [apiBase]);
  const openApplication = useCallback(
    (applicationId: string) => void browser.tabs.create({ url: `${apiBase}/applications/${applicationId}` }),
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
            api={api}
            rescanNonce={rescanNonce}
            openWebApp={openWebApp}
            openApplication={openApplication}
            webReachable={webReachable}
            tabUrl={activeTab?.url ?? ""}
            getBoundHandoff={getBoundHandoff}
            claimNonce={claimNonce}
          />
        ) : (
          <div className="rounded-2xl border border-border-subtle bg-bg-elevated p-4">
            <p className="text-body font-semibold text-text-primary">Open a job application page</p>
            <p className="mt-1 text-caption leading-relaxed text-text-secondary">
              OfferOS fills applications on these platforms:
            </p>
            <ul className="mt-3 space-y-1.5">
              {PLATFORMS.map((p) => (
                <li
                  key={p.name}
                  className="flex items-center justify-between rounded-xl bg-bg-base px-3 py-2 text-caption"
                >
                  <span className="font-medium text-text-primary">{p.name}</span>
                  <span className="text-text-tertiary">{p.host}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="mt-3 px-1 text-caption text-text-tertiary">You submit — OfferOS never does.</p>
    </div>
  );
}
