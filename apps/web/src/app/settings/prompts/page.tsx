import { PromptEditor } from "@/components/settings/prompt-editor";

export default function PromptsSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-10">
      <h1 className="mb-1 text-heading font-semibold text-foreground">System prompts</h1>
      <p className="mb-6 text-body text-muted-foreground">
        Override the prompt and model OfferOS uses for each generation task. Leave a field blank to
        keep the built-in default.
      </p>
      <PromptEditor />
    </main>
  );
}
