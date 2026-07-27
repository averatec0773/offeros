import Link from "next/link";

/** Shared "connect your AI provider" warn card + Settings → AI link, used
 *  wherever a missing LLM key blocks an action (workspace banner, fit card). */
export function ConnectProviderNote({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded-xl bg-warn-bg p-3 text-caption text-foreground">
      {message} —{" "}
      <Link
        href="/settings/ai"
        className="font-semibold underline underline-offset-2 hover:no-underline"
      >
        Settings → AI
      </Link>
    </div>
  );
}
