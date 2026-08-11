import { TemplatesClient } from "@/components/settings/templates-client";

/**
 * Cover-letter templates, as a top-level page rather than a settings tab.
 *
 * It used to live under /settings, which put it behind the same tab strip as
 * the AI keys — so the top nav's "Templates" and "Settings" opened what looked
 * like the same screen. Managing the documents you send is work, not
 * configuration; it gets its own place.
 */
export default function TemplatesPage() {
  return (
    <main className="mx-auto w-full max-w-[880px] px-6 py-10">
      <h1 className="mb-1 text-heading font-semibold text-foreground">Cover letter templates</h1>
      <p className="mb-6 text-body text-muted-foreground">
        Manage the cover-letter templates OfferOS renders into. The default template&apos;s scaffold
        hints (salutation, closing, paragraph count) guide generation.
      </p>
      <TemplatesClient />
    </main>
  );
}
