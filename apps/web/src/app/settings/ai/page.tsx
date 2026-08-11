import { AiSettings } from "@/components/settings/ai-settings";
import { SettingsNav } from "@/components/settings/settings-nav";

export default function AiSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[880px] px-6 py-10">
      <SettingsNav />
      <h1 className="mb-1 text-heading font-semibold text-foreground">AI provider</h1>
      <p className="mb-6 text-body text-muted-foreground">
        Choose a provider and model, and manage the API key OfferOS uses to generate content.
      </p>
      <AiSettings />
    </main>
  );
}
