import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginEnable,
  canEnableUrl,
  enableOnTab,
  hasSiteAccess,
  injectEngine,
  isEnableOnTabRequest,
  originPatternFor,
  requestSiteAccess,
  whyCannotEnable,
  ENABLE_ASK_AGAIN,
  ENABLE_ON_TAB,
  ENABLE_REFUSED,
  ENABLE_TIMED_OUT,
  INJECT_TIMED_OUT,
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

  /**
   * NOTE — a limit these tests cannot cross.
   *
   * `permissions.request` only works inside a user gesture, and a gesture is a
   * property of a real browser's event loop: it does not exist in a fake
   * `permissions` object, and every assertion below would pass just as happily
   * against the arrangement that shipped broken. What CAN be checked here is
   * the thing the gesture rule reduces to — that nothing is awaited before the
   * request — and that is what these check. Whether Chrome then opens the
   * prompt is for a person with a browser to confirm.
   */
  it("asks for exactly the one site, with nothing awaited first", async () => {
    const permissions = {
      contains: vi.fn(async () => false),
      request: vi.fn(async () => true),
    } as unknown as typeof chrome.permissions;

    const pending = requestSiteAccess("https://careers.example.com/apply", permissions);
    // Asserted before a single microtask has run: the request must already be
    // out. An await above it — `contains`, a message to the background, any of
    // it — spends the gesture, and the prompt that never opens never rejects
    // either. The button waits on it forever, which is what a user got.
    expect(permissions.request).toHaveBeenCalledWith({
      origins: ["https://careers.example.com/*"],
    });
    expect(permissions.contains).not.toHaveBeenCalled();
    expect(await pending).toBe(true);
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

/**
 * The precheck, which is what makes the click affordable.
 *
 * It runs on a tab change, where there is no gesture to spend, so it is free to
 * await — and its answer is what lets the click go straight to the prompt.
 */
describe("knowing about the site before anybody clicks", () => {
  const perms = (contains: boolean) =>
    ({
      contains: vi.fn(async () => contains),
      request: vi.fn(async () => true),
    }) as unknown as typeof chrome.permissions;

  it("reports a site we hold", async () => {
    expect(await hasSiteAccess("https://careers.example.com/apply", perms(true))).toBe("granted");
  });

  it("reports a site we do not hold", async () => {
    expect(await hasSiteAccess("https://careers.example.com/apply", perms(false))).toBe("missing");
  });

  it("says it does not know rather than guessing, on a browser without the API", async () => {
    expect(await hasSiteAccess("https://careers.example.com/apply", undefined)).toBe("unknown");
  });

  it("says it does not know for a page that has no origin to ask about", async () => {
    expect(await hasSiteAccess("chrome://extensions", perms(true))).toBe("unknown");
  });
});

describe("the enable button's flow", () => {
  const URL_ = "https://careers.example.com/apply";

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("injects without asking when the site is already granted", async () => {
    const askForSite = vi.fn(async () => true);
    const inject = vi.fn(async () => ({ ok: true }));

    const res = await beginEnable(URL_, { siteAccess: "granted", askForSite, inject });

    expect(res.ok).toBe(true);
    // Someone who has already said yes is not asked a second time.
    expect(askForSite).not.toHaveBeenCalled();
    expect(inject).toHaveBeenCalled();
  });

  it("asks BEFORE anything else when the site is known to be missing", async () => {
    const order: string[] = [];
    const askForSite = vi.fn(() => {
      order.push("ask");
      return Promise.resolve(true);
    });
    const inject = vi.fn(async () => {
      order.push("inject");
      return { ok: true };
    });

    const pending = beginEnable(URL_, { siteAccess: "missing", askForSite, inject });
    // Before a microtask has run. The whole failure was that a message to the
    // background went first and spent the gesture on the way.
    expect(order).toEqual(["ask"]);

    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: true, learned: "granted" });
    expect(order).toEqual(["ask", "inject"]);
  });

  it("says plainly when the user declines, and injects nothing", async () => {
    const inject = vi.fn(async () => ({ ok: true }));
    const pending = beginEnable(URL_, {
      siteAccess: "missing",
      askForSite: async () => false,
      inject,
    });
    await vi.runAllTimersAsync();

    expect(await pending).toMatchObject({ ok: false, error: ENABLE_REFUSED, learned: "missing" });
    expect(inject).not.toHaveBeenCalled();
  });

  it("gives up and hands the button back when the prompt never answers", async () => {
    // The real shape of the fault: `permissions.request` outside a gesture
    // neither resolves nor rejects, so every wait behind it is forever.
    const pending = beginEnable(URL_, {
      siteAccess: "missing",
      askForSite: () => new Promise<boolean>(() => {}),
      inject: async () => ({ ok: true }),
    });

    await vi.advanceTimersByTimeAsync(15_000);
    const res = await pending;
    expect(res.ok).toBe(false);
    // Something to do, not just "something went wrong".
    expect(res.error).toBe(ENABLE_TIMED_OUT);
    expect(res.error).toMatch(/chrome:\/\/extensions/);
  });

  it("blames the injection, not a permission prompt it never opened", async () => {
    // One message used to cover both branches, so an injection that timed out
    // told the user Chrome had not answered a permission request — when none
    // had been made. That wording sent a real diagnosis the wrong way.
    const pending = beginEnable(URL_, {
      siteAccess: "granted",
      askForSite: async () => true,
      inject: () => new Promise(() => {}),
    });
    await vi.advanceTimersByTimeAsync(15_000);
    const res = await pending;
    expect(res).toMatchObject({ ok: false, error: INJECT_TIMED_OUT });
    expect(res.error).not.toBe(ENABLE_TIMED_OUT);
    expect(res.error).not.toMatch(/permission request/i);
  });

  it("learns from a refusal it could not have predicted, and says to press again", async () => {
    // No precheck answer — no permissions API, or the tab changed a moment ago.
    // It tries, and Chrome answers that the permission is what is missing. The
    // gesture is gone by then, so the honest move is to say so and set the next
    // press up to ask first.
    const askForSite = vi.fn(async () => true);
    const pending = beginEnable(URL_, {
      siteAccess: "unknown",
      askForSite,
      inject: async () => ({ ok: false, needsPermission: true, error: "Cannot access contents" }),
    });
    await vi.runAllTimersAsync();

    expect(await pending).toMatchObject({ ok: false, error: ENABLE_ASK_AGAIN, learned: "missing" });
    expect(askForSite).not.toHaveBeenCalled();
  });

  it("passes a real failure through untouched — asking would not fix it", async () => {
    const pending = beginEnable(URL_, {
      siteAccess: "unknown",
      askForSite: async () => true,
      inject: async () => ({
        ok: false,
        error: "Chrome does not let extensions run on the Web Store.",
      }),
    });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({
      ok: false,
      error: "Chrome does not let extensions run on the Web Store.",
    });
  });

  it("a rejected injection ends the wait rather than hanging on it", async () => {
    const pending = beginEnable(URL_, {
      siteAccess: "granted",
      askForSite: async () => true,
      inject: () => Promise.reject(new Error("worker gone")),
    });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: false, error: INJECT_TIMED_OUT });
  });
});
