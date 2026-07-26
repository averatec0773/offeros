export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
      <p className="text-title font-semibold">{title}</p>
      <p className="mt-1 text-body text-muted-foreground">{body}</p>
    </div>
  );
}
