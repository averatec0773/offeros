import type { ReactNode } from "react";

export function SectionCard({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-elevated p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-body font-semibold tracking-tight text-text-primary">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
