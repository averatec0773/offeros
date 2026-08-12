import { getDb } from "@/server/db/client";
import { listDocuments } from "@/server/services/document-service";
import { DocumentsNav, resolveTab } from "@/components/documents/documents-nav";
import { GeneratedDocuments } from "@/components/documents/generated-documents";
import { ResumesSection } from "@/components/documents/resumes-section";
import { TemplatesClient } from "@/components/settings/templates-client";

export const dynamic = "force-dynamic";

/**
 * Every document in one place.
 *
 * Three kinds of thing were kept in three unrelated corners: what OfferOS
 * generated (inside one application's workspace, unnamed), the résumés the user
 * uploaded (a section of the Profile page), and the cover-letter templates (a
 * top-level page of their own). They are all the same kind of asset from where
 * the user sits, so they are all here — and the nav went from six items back to
 * five.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: requested } = await searchParams;
  const tab = resolveTab(requested);
  // Only the Generated tab needs server data; the other two panels fetch their
  // own, which is what made them movable at all.
  const documents = tab === "generated" ? listDocuments(getDb()) : [];

  return (
    <main className="mx-auto w-full max-w-[1120px] px-6 py-10">
      <header className="mb-6">
        <h1 className="text-heading font-semibold text-foreground">Documents</h1>
        <p className="mt-1 text-body text-muted-foreground">
          {tab === "generated"
            ? "Everything OfferOS has written for a job, newest first."
            : tab === "resumes"
              ? "The résumés you uploaded. Tailoring starts from the primary one unless an application picks another."
              : "The cover-letter templates OfferOS renders into. The default template’s scaffold hints (salutation, closing, paragraph count) guide generation."}
        </p>
      </header>

      <DocumentsNav active={tab} />

      {tab === "generated" && <GeneratedDocuments initial={documents} />}
      {tab === "resumes" && (
        <section className="rounded-2xl border border-border bg-card p-4">
          <ResumesSection />
        </section>
      )}
      {tab === "templates" && <TemplatesClient />}
    </main>
  );
}
