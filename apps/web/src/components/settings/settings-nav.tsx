"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/settings/ai", label: "AI" },
  { href: "/settings/style", label: "Style" },
  { href: "/settings/prompts", label: "Prompts" },
  { href: "/settings/templates", label: "Templates" },
];

/** Sub-nav shared by the three settings pages. Active link is derived from the current path. */
export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex items-center gap-2">
      {LINKS.map((link) => {
        const active = pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1.5 text-caption font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-secondary",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
