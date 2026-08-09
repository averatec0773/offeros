import { SettingsNav } from "@/components/settings/settings-nav";
import { AgentSettingsSection } from "@/components/settings/agent-settings";

export const dynamic = "force-dynamic";

/** How much the agent may do on its own, including the one irreversible step. */
export default function AgentSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[860px] px-6 py-10">
      <header className="mb-6">
        <h1 className="text-heading font-semibold">Agent</h1>
        <p className="text-body text-muted-foreground">
          What OfferOS may do without stopping to ask you.
        </p>
      </header>
      <SettingsNav />
      <AgentSettingsSection />
    </main>
  );
}
