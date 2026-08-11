import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PromptEditor } from "@/components/settings/prompt-editor";

/** The per-task prompt studio. Nested under AI & Agent rather than given a tab
 *  of its own: it is the rare, advanced page, reached deliberately. */
export default function PromptsSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[880px] px-6 py-10">
      <Link
        href="/settings/ai"
        className="mb-6 inline-flex items-center gap-1 text-caption font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft aria-hidden className="size-3.5" />
        AI &amp; Agent
      </Link>
      <h1 className="mb-1 text-heading font-semibold text-foreground">System prompts</h1>
      <p className="mb-6 text-body text-muted-foreground">
        Override the prompt and model OfferOS uses for each generation task. Leave a field blank to
        keep the built-in default.
      </p>
      <PromptEditor />
    </main>
  );
}
