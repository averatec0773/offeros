import { useEffect, useState } from "react";
import { ArrowUpRight, Inbox } from "lucide-react";
import { Button } from "../components/ui/button";
import type { ApiResult, InboxItem } from "../lib/offeros-api";

/**
 * What the panel shows when the page is NOT a supported application form.
 *
 * The panel used to be unopenable here at all, so this state had nothing to be
 * but an apology ("open a job application page") plus a list of hosts. Now that
 * the toolbar icon works everywhere, the honest thing to put in front of the
 * user is the same question the web app's home answers: what is waiting on you,
 * and one way to get there.
 *
 * Deliberately a READ. The extension stays hands-only — nothing here creates or
 * changes a record, it surfaces the web app's own inbox and hands off to it.
 */

/** Supported ATS shown to orient the user. Data, not UI copy. */
const PLATFORMS = [
  { name: "Greenhouse", host: "boards.greenhouse.io" },
  { name: "Lever", host: "jobs.lever.co" },
  { name: "Ashby", host: "jobs.ashbyhq.com" },
  { name: "iCIMS", host: "careers-*.icims.com" },
  { name: "Workday", host: "*.myworkdayjobs.com" },
] as const;

/** How many inbox rows the panel shows before deferring to the web app. It is
 *  a narrow column, and a list you have to scroll is not a summary. */
const SHOWN = 5;

export interface HomePanelApi {
  getInbox: () => Promise<ApiResult<InboxItem[]>>;
}

export function HomePanel({
  api,
  webReachable,
  openWebApp,
  openApplication,
}: {
  api: HomePanelApi;
  /** False while the web app is down — the App-level banner already explains
   *  that, so this only decides whether to attempt the read at all. */
  webReachable: boolean;
  openWebApp: () => void;
  openApplication: (applicationId: string) => void;
}) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!webReachable) return;
    let live = true;
    void api.getInbox().then((res) => {
      if (!live) return;
      if (res.ok) {
        setItems(res.value);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
    return () => {
      live = false;
    };
  }, [api, webReachable]);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border-subtle bg-bg-elevated p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-body font-semibold text-text-primary">Needs you</p>
            <p className="mt-1 text-caption leading-relaxed text-text-secondary">
              {!webReachable || failed
                ? "Can't reach the OfferOS web app."
                : items === null
                  ? "Checking…"
                  : items.length === 0
                    ? "Nothing is waiting on you."
                    : `${items.length} thing${items.length === 1 ? "" : "s"} waiting on you.`}
            </p>
          </div>
          <Button variant="primary" className="shrink-0 rounded-full" onClick={openWebApp}>
            Open OfferOS
          </Button>
        </div>

        {items !== null && items.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {items.slice(0, SHOWN).map((item) => (
              <li key={item.applicationId}>
                <button
                  type="button"
                  onClick={() => openApplication(item.applicationId)}
                  className="flex w-full items-center gap-2 rounded-xl bg-bg-base px-3 py-2 text-left transition-colors hover:bg-bg-base/70"
                >
                  <Inbox aria-hidden className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption font-medium text-text-primary">
                      {item.headline}
                    </span>
                    <span className="block truncate text-caption text-text-tertiary">
                      {item.jobTitle} at {item.companyName}
                    </span>
                  </span>
                  <ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {items !== null && items.length > SHOWN && (
          <button
            type="button"
            onClick={openWebApp}
            className="mt-2 px-1 text-caption text-text-tertiary underline-offset-2 hover:underline"
          >
            {items.length - SHOWN} more in the web app
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-border-subtle bg-bg-elevated p-4">
        <p className="text-body font-semibold text-text-primary">Filling works here</p>
        <p className="mt-1 text-caption leading-relaxed text-text-secondary">
          Open an application form on one of these and this panel takes over.
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
    </div>
  );
}
