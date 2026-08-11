import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { AiSettings } from "@/components/settings/ai-settings";
import { AgentSettingsSection } from "@/components/settings/agent-settings";
import { StyleSettings } from "@/components/settings/style-settings";
import { SettingsNav } from "@/components/settings/settings-nav";

export const dynamic = "force-dynamic";

/**
 * Everything about the model and what it may do, on one page.
 *
 * These were three tabs (AI / Agent / Style) that each held one card, so the
 * settings area read as more structure than it had. They are one subject —
 * which model runs, how far it may go on its own, and what it has learned
 * about your writing — and they are short enough to read in one scroll.
 *
 * Prompts stays a separate page rather than a fourth section: it is a long,
 * per-task editor that most people never open, and inlining it would bury the
 * three settings above it.
 */
export default function AiSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[880px] px-6 py-10">
      <SettingsNav />
      <h1 className="mb-1 text-heading font-semibold text-foreground">AI &amp; Agent</h1>
      <p className="mb-8 text-body text-muted-foreground">
        Which model OfferOS uses, how much it may do on its own, and what it has learned about how
        you write.
      </p>

      <section className="mb-10">
        <h2 className="mb-1 text-title font-semibold text-foreground">Provider</h2>
        <p className="mb-4 text-body text-muted-foreground">
          Choose a provider and model, and manage the API key OfferOS uses to generate content.
        </p>
        <AiSettings />
      </section>

      <section className="mb-10">
        <h2 className="mb-1 text-title font-semibold text-foreground">Automation</h2>
        <p className="mb-4 text-body text-muted-foreground">
          What OfferOS may do without stopping to ask you.
        </p>
        <AgentSettingsSection />
      </section>

      <section className="mb-10">
        <h2 className="mb-1 text-title font-semibold text-foreground">Writing style</h2>
        <p className="mb-4 text-body text-muted-foreground">
          Review and edit what OfferOS has learned about your writing style.
        </p>
        <StyleSettings />
      </section>

      <section>
        <h2 className="mb-1 text-title font-semibold text-foreground">Advanced</h2>
        <p className="mb-4 text-body text-muted-foreground">
          Override the built-in instructions OfferOS sends the model, per task.
        </p>
        <Link
          href="/settings/ai/prompts"
          className="inline-flex items-center gap-1.5 rounded-2xl border border-border bg-card px-4 py-3 text-body font-medium text-foreground transition-colors hover:bg-muted"
        >
          Custom prompts
          <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
        </Link>
      </section>
    </main>
  );
}
