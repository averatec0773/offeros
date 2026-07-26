import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FillPanel } from "../../src/sidepanel/fill-panel";
import { useActiveTab } from "../../src/sidepanel/use-active-tab";
import { Button } from "../../src/components/ui/button";
import { matchAts } from "../../src/lib/autofill/recipes";
import {
  isEnginePageChanged,
  sendEngineFill,
  sendEngineScan,
} from "../../src/lib/autofill/autofill-messaging";
import { claim, generateAnswer, getPending, postReport } from "../../src/lib/offeros-api";
import { settings } from "../../src/lib/settings";
import { PlugZap } from "lucide-react";

// Supported ATS shown to orient the user on an unsupported page. Data, not UI copy.
const PLATFORMS = [
  { name: "Greenhouse", host: "boards.greenhouse.io" },
  { name: "Lever", host: "jobs.lever.co" },
  { name: "Ashby", host: "jobs.ashbyhq.com" },
  { name: "iCIMS", host: "careers-*.icims.com" },
  { name: "Workday", host: "*.myworkdayjobs.com" },
] as const;

// The web-app fill API, bound to the real fetch. Tests inject fakes into FillPanel directly.
const api = { getPending: () => getPending(), claim, postReport, generateAnswer };

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

  const tabId = activeTab?.id ?? -1;
  const scan = useCallback(() => sendEngineScan(tabId), [tabId]);
  const fill = useCallback((values: Parameters<typeof sendEngineFill>[1]) => sendEngineFill(tabId, values), [tabId]);
  const openWebApp = useMemo(() => () => void browser.tabs.create({ url: apiBase || undefined }), [apiBase]);

  return (
    <div className="flex min-h-screen flex-col bg-bg-base p-3 font-sans text-text-primary">
      <header className="mb-3 flex items-center gap-2 px-1">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-brand" />
        <h1 className="text-body font-semibold">OfferOS</h1>
        <span className="text-caption text-text-tertiary">Side panel</span>
      </header>

      {!webReachable && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-warn-bg p-4">
          <div className="flex min-w-0 items-center gap-2">
            <PlugZap aria-hidden className="h-4 w-4 shrink-0 text-warning" />
            <span className="min-w-0 flex-1 text-caption text-text-secondary">
              OfferOS web app not running — start it at {apiBase}
            </span>
          </div>
          <Button className="shrink-0 rounded-full" onClick={() => void ping()}>
            Retry
          </Button>
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
      </label>

      <div className="flex-1">
        {supported ? (
          <FillPanel scan={scan} fill={fill} api={api} rescanNonce={rescanNonce} openWebApp={openWebApp} />
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

      <p className="mt-3 px-1 text-caption text-text-tertiary">
        Review and submit yourself — OfferOS never submits for you.
      </p>
    </div>
  );
}
