import { redirect } from "next/navigation";

/**
 * Templates moved into Documents, next to the résumés and the generated
 * letters. The old address stays as a redirect rather than a 404: it was in the
 * top nav for weeks, so it is in bookmarks and in the export error message that
 * tells people where to restore a deleted template.
 */
export default function TemplatesPage() {
  redirect("/documents?tab=templates");
}
