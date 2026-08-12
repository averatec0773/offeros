import Link from "next/link";
import { cn } from "@/lib/utils";

export const DOCUMENT_TABS = [
  { id: "generated", label: "Generated" },
  { id: "resumes", label: "Base résumés" },
  { id: "templates", label: "Templates" },
] as const;

export type DocumentTab = (typeof DOCUMENT_TABS)[number]["id"];

/** The tab the URL asks for, or the default. Unknown values fall back rather
 *  than 404 — a stale bookmark should still open the page. */
export function resolveTab(raw: string | undefined): DocumentTab {
  return DOCUMENT_TABS.some((t) => t.id === raw) ? (raw as DocumentTab) : "generated";
}

/**
 * Tabs for the Documents page, as links rather than client state.
 *
 * Same pill vocabulary as the settings sub-nav, and the same reason for using
 * real links: the tab is in the URL, so it survives a reload and can be sent to
 * yourself — which is what `/templates` now redirects into.
 */
export function DocumentsNav({ active }: { active: DocumentTab }) {
  return (
    <nav className="mb-6 flex items-center gap-2">
      {DOCUMENT_TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={`/documents?tab=${tab.id}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1.5 text-caption font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-secondary",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
