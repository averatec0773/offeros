import { TemplatesClient } from "@/components/settings/templates-client";
import { SettingsNav } from "@/components/settings/settings-nav";

export default function TemplatesSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-10">
      <SettingsNav />
      <h1 className="mb-1 text-heading font-semibold text-foreground">Cover letter templates</h1>
      <p className="mb-6 text-body text-muted-foreground">
        Manage the cover-letter templates OfferOS renders into. The default template's scaffold
        hints (salutation, closing, paragraph count) guide generation.
      </p>
      <TemplatesClient />
    </main>
  );
}
