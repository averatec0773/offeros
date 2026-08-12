"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A company's face, with a floor that can never fail.
 *
 * The floor is letters on a colour derived from the name itself — offline,
 * deterministic, instant, and identical every time you see that company. It is
 * not a placeholder waiting for the real thing; it is the design, and the
 * fetched logo is an upgrade on top of it.
 *
 * The logo, when there is one, is served from this machine. Nothing here ever
 * points an <img> at an employer's server: that would leak which jobs someone
 * is looking at, to the employer, on every page view.
 */

/** FNV-1a over the name. Any stable hash would do — what matters is that the
 *  same company is the same colour forever, without a lookup table. */
function hash(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Hues only, at a fixed saturation and lightness.
 *
 * Picking whole colours from a palette would eventually put white text on
 * yellow. Fixing S and L and varying only the hue keeps every result at the
 * same contrast against the same foreground, so legibility is a property of
 * the scheme rather than of luck.
 */
export function avatarStyle(company: string): { backgroundColor: string; color: string } {
  const hue = hash(company.trim().toLowerCase()) % 360;
  return { backgroundColor: `hsl(${hue} 52% 42%)`, color: "hsl(0 0% 100%)" };
}

/** Up to two initials; falls back to a dash so the shape is never empty. */
export function initials(company: string): string {
  const letters = company
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0] ?? "")
    .join("");
  return letters.toUpperCase() || "—";
}

export function CompanyAvatar({
  company,
  /** Where a cached logo would be, if one was ever fetched. Missing or broken
   *  falls straight back to letters, silently and once. */
  logoUrl,
  size = 40,
  className,
}: {
  company: string;
  logoUrl?: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const dimension = { width: size, height: size };

  if (logoUrl && !failed) {
    return (
      // A plain <img> on purpose: this is a local file route, not a remote
      // host, so next/image would add a loader and a proxy for bytes already
      // on this disk.
      <img
        src={logoUrl}
        alt=""
        aria-hidden
        style={dimension}
        // The ref matters as much as onError. This markup is rendered on the
        // server, so the browser has already tried the image — and possibly
        // already failed — before React attaches any handler. That error is
        // gone by hydration and onError never fires, which left a broken-image
        // icon sitting there for good. A finished load with no pixels is that
        // same failure, observable after the fact.
        ref={(img) => {
          if (img?.complete && img.naturalWidth === 0) setFailed(true);
        }}
        onError={() => setFailed(true)}
        className={cn("shrink-0 rounded-xl bg-muted object-contain", className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={{ ...dimension, ...avatarStyle(company) }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl text-body font-semibold",
        className,
      )}
    >
      {initials(company)}
    </span>
  );
}
