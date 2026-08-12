import { describe, expect, it } from "vitest";
import atsContent from "../entrypoints/ats.content";
import atsDriverContent from "../entrypoints/ats-driver.content";
import config from "../wxt.config";
import { RECIPES, type AtsId } from "../src/lib/autofill/recipes";

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

/**
 * The drift these tests exist to catch.
 *
 * Supporting an ATS takes agreement between four lists that live in four files:
 * the recipe that recognises the site, the engine content script, the MAIN-world
 * combobox driver, and the manifest's host permissions. Miss one and nothing
 * announces it — the site still loads, the scan still finds fields, and only the
 * one capability owned by the missing list quietly stops working. That is exactly
 * how iCIMS ended up in every list but the driver's: its dropdowns had no driver
 * to answer them, so each one failed on a 2500ms timeout that read as an ordinary
 * fill failure.
 *
 * So: name a real URL for every recipe, and make all three injection lists prove
 * they cover it. Adding an ATS without a URL here fails; adding a URL that only
 * some of the lists cover fails.
 */

/** A Chrome match pattern, as a matcher. Host `*.` means "or the bare domain". */
function matchesUrl(pattern: string, url: string): boolean {
  if (pattern === "<all_urls>") return true;
  const m = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!m) throw new Error(`unparseable match pattern: ${pattern}`);
  const [, scheme, host, path] = m;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `*.example.com` means "example.com or any subdomain of it".
  const hostRe = host!.startsWith("*.") ? `(?:[^/]+\\.)?${esc(host!.slice(2))}` : esc(host!);
  const pathRe = esc(path!).replace(/\\\*/g, ".*");
  const re = new RegExp(`^${scheme === "*" ? "https?" : scheme}://${hostRe}${pathRe}$`, "i");
  return re.test(url);
}

const SAMPLE_URL: Record<AtsId, string> = {
  greenhouse: "https://boards.greenhouse.io/acme/jobs/4321",
  lever: "https://jobs.lever.co/acme/1234-5678",
  ashby: "https://jobs.ashbyhq.com/acme/abcd-1234/application",
  icims: "https://careers-acme.icims.com/jobs/4321/login",
  myworkday: "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/Widget-Wrangler",
};

function hostPermissions(): string[] {
  const manifest = config.manifest;
  if (typeof manifest !== "object" || manifest === null || manifest instanceof Promise) {
    throw new Error("expected manifest to be a plain object");
  }
  const hosts = manifest.host_permissions;
  if (!Array.isArray(hosts)) throw new Error("expected host_permissions to be a plain array");
  // <all_urls> is present for tabs.captureVisibleTab and would satisfy every
  // assertion below on its own, which would make this test prove nothing.
  return hosts.filter((h) => h !== "<all_urls>");
}

describe("every supported ATS is reachable by every script that needs it", () => {
  it("names a sample URL for every recipe", () => {
    for (const recipe of RECIPES) {
      expect(SAMPLE_URL[recipe.atsId], `no sample URL for ${recipe.atsId}`).toBeTruthy();
    }
  });

  it.each(RECIPES.map((r) => r.atsId))("%s: the recipe recognises its own sample URL", (atsId) => {
    const recipe = RECIPES.find((r) => r.atsId === atsId)!;
    expect(recipe.urlPatterns.some((p) => p.test(SAMPLE_URL[atsId]))).toBe(true);
  });

  it.each(RECIPES.map((r) => r.atsId))("%s: the engine content script is injected", (atsId) => {
    const url = SAMPLE_URL[atsId];
    expect(
      matchList(atsContent.matches).some((p) => matchesUrl(p, url)),
      url,
    ).toBe(true);
  });

  // The one that was actually broken.
  it.each(RECIPES.map((r) => r.atsId))("%s: the combobox driver is injected", (atsId) => {
    const url = SAMPLE_URL[atsId];
    expect(
      matchList(atsDriverContent.matches).some((p) => matchesUrl(p, url)),
      url,
    ).toBe(true);
  });

  it.each(RECIPES.map((r) => r.atsId))("%s: host permissions cover it", (atsId) => {
    const url = SAMPLE_URL[atsId];
    expect(
      hostPermissions().some((p) => matchesUrl(p, url)),
      url,
    ).toBe(true);
  });

  it("the two content scripts are injected on exactly the same pages", () => {
    expect(matchList(atsDriverContent.matches)).toEqual(matchList(atsContent.matches));
  });
});
