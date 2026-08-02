import { StyleSettings } from "@/components/settings/style-settings";
import { SettingsNav } from "@/components/settings/settings-nav";

export default function StyleSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-10">
      <SettingsNav />
      <h1 className="mb-1 text-heading font-semibold text-foreground">Style</h1>
      <p className="mb-6 text-body text-muted-foreground">
        Review and edit what OfferOS has learned about your writing style.
      </p>
      <StyleSettings />
    </main>
  );
}
