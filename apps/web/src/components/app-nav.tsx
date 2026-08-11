"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Applications" },
  { href: "/agent", label: "Agent" },
  { href: "/profile", label: "Profile" },
  { href: "/settings/templates", label: "Templates" },
  { href: "/settings/ai", label: "Settings" },
];

/** App-wide top nav. Active link is derived from the current path. */
export function AppNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
      <nav className="mx-auto flex h-16 w-full max-w-[1120px] items-center gap-8 px-6">
        <Link href="/" className="text-title font-semibold text-foreground">
          OfferOS
        </Link>
        <div className="flex items-center gap-6">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={cn(
                "text-body-lg font-medium transition-colors",
                isActive(link.href)
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
