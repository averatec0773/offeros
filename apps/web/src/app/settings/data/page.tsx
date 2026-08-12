import { BackfillJd } from "@/components/settings/backfill-jd";
import { DataSettings } from "@/components/settings/data-settings";
import { SettingsNav } from "@/components/settings/settings-nav";

export default function DataSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[880px] px-6 py-10">
      <SettingsNav />
      <h1 className="mb-1 text-heading font-semibold text-foreground">Data & backup</h1>
      <p className="mb-6 text-body text-muted-foreground">
        Everything you build in OfferOS lives on your machine. Keep a copy so it survives a new
        laptop or a bad disk.
      </p>
      <DataSettings />

      <div className="mt-6">
        <BackfillJd />
      </div>
    </main>
  );
}
