import { describe, expect, it, vi } from "vitest";
import {
  canEnableUrl,
  enableOnTab,
  injectEngine,
  isEnableOnTabRequest,
  originPatternFor,
  requestSiteAccess,
  whyCannotEnable,
  ENABLE_ON_TAB,
} from "../src/lib/site-enable";

/**
 * Turning OfferOS on for one page.
 *
 * Two properties carry the whole feature. The button must only appear where it
 * can actually work — a button that does nothing reads as a broken extension,
 * not a restricted one — and a failed injection must say what happened, because
 * the alternative is the same silence the feature exists to end.
 */

const scripting = (impl?: () => Promise<unknown>) =>
  ({
    executeScript: vi.fn(impl ?? (async () => [])),
  }) as unknown as typeof chrome.scripting;

describe("which pages can be enabled", () => {
  it("ordinary web pages can", () => {
    for (const url of [
      "https://careers.example.com/jobs/1",
      "http://ats.example.com/apply",
      "https://ats.example.com/apply?token=1234567#form",
    ]) {
      expect(whyCannotEnable(url), url).toBeNull();
      expect(canEnableUrl(url), url).toBe(true);
    }
  });

  it("browser and local pages cannot, and are told why", () => {
    for (const url of [
      "chrome://extensions",
      "edge://settings",
      "about:blank",
      "file:///Users/someone/form.html",
      "view-source:https://ats.example.com",
      "chrome-extension://abcdef/sidepanel.html",
    ]) {
      const why = whyCannotEnable(url);
      expect(why, url).toBeTruthy();
      expect(canEnableUrl(url), url).toBe(false);
      expect(why!.toLowerCase()).toContain("ordinary web pages");
    }
  });

  it("the Web Store cannot — Chrome forbids it, and saying so beats a dead button", () => {
    for (const url of [
      "https://chrome.google.com/webstore/category/extensions",
      "https://chromewebstore.google.com/detail/abc",
    ]) {
      expect(whyCannotEnable(url), url).toContain("Web Store");
    }
    // A lookalike host is not the Web Store.
    expect(whyCannotEnable("https://chromewebstore.google.com.example.com/x")).toBeNull();
  });

  it("a tab with no URL yet is not offered a button", () => {
    expect(canEnableUrl("")).toBe(false);
    expect(canEnableUrl("not a url")).toBe(false);
  });
});

describe("the message contract", () => {
  it("recognises its own request and nothing else", () => {
    expect(isEnableOnTabRequest({ kind: ENABLE_ON_TAB, tabId: 7 })).toBe(true);
    expect(isEnableOnTabRequest({ kind: ENABLE_ON_TAB })).toBe(false);
    expect(isEnableOnTabRequest({ kind: ENABLE_ON_TAB, tabId: "7" })).toBe(false);
    expect(isEnableOnTabRequest({ kind: "OFFEROS_START_WEB_APP" })).toBe(false);
    expect(isEnableOnTabRequest(null)).toBe(false);
  });
});

describe("injecting the engine", () => {
  it("injects both scripts, the driver in the page's own world", async () => {
    // The combobox driver has to read a React widget's internals, which is only
    // possible from MAIN. If this ever silently becomes ISOLATED, every
    // react-select dropdown on an enabled site fails on a timeout.
    const s = scripting();
    await injectEngine(42, s);
    const calls = (s.executeScript as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toEqual({ target: { tabId: 42 }, files: ["content-scripts/ats.js"] });
    expect(calls[1]![0]).toEqual({
      target: { tabId: 42 },
      files: ["content-scripts/ats-driver.js"],
      world: "MAIN",
    });
  });

  it("reports the page it refuses before touching the browser at all", async () => {
    const s = scripting();
    const res = await enableOnTab(1, "chrome://extensions", s);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ordinary web pages");
    expect(s.executeScript).not.toHaveBeenCalled();
  });

  it("surfaces a real injection failure verbatim", async () => {
    // Enterprise policy, a page whose CSP refuses the world injection, a tab
    // that navigated between the click and the call.
    const s = scripting(async () => {
      throw new Error("Cannot access contents of the page");
    });
    const res = await enableOnTab(1, "https://careers.example.com/apply", s);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Cannot access contents of the page");
  });

  it("says so when the browser has no scripting API rather than appearing to work", async () => {
    const res = await enableOnTab(1, "https://careers.example.com/apply", undefined);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("succeeds quietly when both injections land", async () => {
    const res = await enableOnTab(1, "https://careers.example.com/apply", scripting());
    expect(res).toEqual({ ok: true });
  });
});

/**
 * Life without `<all_urls>`.
 *
 * The extension used to hold every site, for one reason: `captureVisibleTab`.
 * Measured in real Chromium, on a host the manifest DOES cover:
 *
 *   Either the '<all_urls>' or 'activeTab' permission is required.
 *
 * A per-host permission is not enough for it — so screenshots now ride on
 * `activeTab` and skip when it is absent. The same removal turned up a second
 * thing the audit had not predicted: injecting into a site the user enabled by
 * hand was also riding on `<all_urls>`, not on `activeTab` as its own comment
 * claimed. Chrome's answer there:
 *
 *   Cannot access contents of url "…". Extension manifest must request
 *   permission to access this host.
 *
 * That one is answerable, and these tests are about answering it.
 */
describe("asking for one site", () => {
  it("asks for the origin, never a path and never more", () => {
    // Chrome grants per origin; a narrower request is not a thing it offers,
    // and a wider one would be the full-site access this whole change removed.
    expect(originPatternFor("https://careers.example.com/jobs/1?x=2#form")).toBe(
      "https://careers.example.com/*",
    );
    expect(originPatternFor("http://ats.example.com:8080/apply")).toBe(
      "http://ats.example.com:8080/*",
    );
  });

  it("has nothing to ask for on a page it could not use anyway", () => {
    for (const url of ["chrome://extensions", "file:///tmp/form.html", "", "not a url"]) {
      expect(originPatternFor(url), url).toBeNull();
    }
  });

  it("does not ask again for a site already granted", () => {
    // Prompting someone who has already said yes is its own kind of rude.
    const permissions = {
      contains: vi.fn(async () => true),
      request: vi.fn(async () => false),
    } as unknown as typeof chrome.permissions;
    return requestSiteAccess("https://careers.example.com/apply", permissions).then((ok) => {
      expect(ok).toBe(true);
      expect(permissions.request).not.toHaveBeenCalled();
    });
  });

  it("asks for exactly the one site when it does not hold it", async () => {
    const permissions = {
      contains: vi.fn(async () => false),
      request: vi.fn(async () => true),
    } as unknown as typeof chrome.permissions;
    expect(await requestSiteAccess("https://careers.example.com/apply", permissions)).toBe(true);
    expect(permissions.request).toHaveBeenCalledWith({
      origins: ["https://careers.example.com/*"],
    });
  });

  it("takes no for an answer", async () => {
    const permissions = {
      contains: vi.fn(async () => false),
      request: vi.fn(async () => false),
    } as unknown as typeof chrome.permissions;
    expect(await requestSiteAccess("https://careers.example.com/apply", permissions)).toBe(false);
  });

  it("survives a browser with no permissions API at all", async () => {
    expect(await requestSiteAccess("https://careers.example.com/apply", undefined)).toBe(false);
  });
});

describe("telling apart the failure that asking can fix", () => {
  const refusing = (message: string) =>
    ({
      executeScript: vi.fn(async () => {
        throw new Error(message);
      }),
    }) as unknown as typeof chrome.scripting;

  it("flags Chrome's missing-permission refusal as answerable", async () => {
    // Verbatim from the probe.
    const res = await enableOnTab(
      1,
      "https://careers.example.com/apply",
      refusing(
        'Cannot access contents of url "https://careers.example.com/apply". Extension manifest must request permission to access this host.',
      ),
    );
    expect(res.ok).toBe(false);
    expect(res.needsPermission).toBe(true);
  });

  it("does NOT flag a failure asking cannot fix", async () => {
    // An enterprise policy or a page whose CSP refuses the world injection is
    // not fixed by a permission prompt, and prompting would be a lie about
    // what would happen next.
    const res = await enableOnTab(
      1,
      "https://careers.example.com/apply",
      refusing("Blocked by administrator policy"),
    );
    expect(res.ok).toBe(false);
    expect(res.needsPermission).toBeUndefined();
    expect(res.error).toContain("Blocked by administrator policy");
  });

  it("does not flag a page it refused before touching the browser", async () => {
    const res = await enableOnTab(1, "chrome://extensions", refusing("unused"));
    expect(res.needsPermission).toBeUndefined();
  });
});
