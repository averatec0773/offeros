import { describe, expect, it } from "vitest";
import atsContent from "../entrypoints/ats.content";
import atsDriverContent from "../entrypoints/ats-driver.content";

// `matches` is typed as `string[] | Record<string, string[]>` (WXT's
// per-browser option) even though every entrypoint here always passes a
// plain array; narrow it before asserting.
function matchList(matches: unknown): string[] {
  if (!Array.isArray(matches)) throw new Error("expected matches to be a plain array");
  return matches;
}

// Boundary tightening: every ATS content-script `matches` pattern must be
// `https://`-only. A bare `*://` scheme also matches `http://` and `ws://`,
// letting a plain-HTTP MITM inject a page our fill engine then trusts.
describe("content-script matches are https-only", () => {
  it("ats.content.tsx matches every start with https://", () => {
    const matches = matchList(atsContent.matches);
    expect(matches.length).toBeGreaterThan(0);
    for (const pattern of matches) {
      expect(pattern.startsWith("https://"), pattern).toBe(true);
    }
  });

  it("ats-driver.content.ts matches every start with https://", () => {
    const matches = matchList(atsDriverContent.matches);
    expect(matches.length).toBeGreaterThan(0);
    for (const pattern of matches) {
      expect(pattern.startsWith("https://"), pattern).toBe(true);
    }
  });
});
