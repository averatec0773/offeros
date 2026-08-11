import { SettingsNav } from "@/components/settings/settings-nav";
import { AgentSettingsSection } from "@/components/settings/agent-settings";

export const dynamic = "force-dynamic";

/** How much the agent may do on its own, including the one irreversible step. */
export default function AgentSettingsPage() {
  return (
    // Nav FIRST, then the header — identical to every other settings page, so
    // the pill nav sits at the same spot and switching tabs doesn't jump.
    <main className="mx-auto w-full max-w-[720px] px-6 py-10">
      <SettingsNav />
      <h1 className="mb-1 text-heading font-semibold text-foreground">Agent</h1>
      <p className="mb-6 text-body text-muted-foreground">
        What OfferOS may do without stopping to ask you.
      </p>
      <AgentSettingsSection />
    </main>
  );
}
