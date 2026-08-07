import type { ReactNode } from "react";

export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-elevated p-4">
      <h2 className="mb-3 text-body font-semibold tracking-tight text-text-primary">{title}</h2>
      {children}
    </section>
  );
}
