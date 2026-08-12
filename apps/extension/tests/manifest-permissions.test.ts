import { describe, expect, it } from "vitest";
import config from "../wxt.config";

/**
 * What the install prompt asks for.
 *
 * `<all_urls>` used to be here, for one API: `tabs.captureVisibleTab`. The cost
 * was that Chrome told every user OfferOS could "read and change all your data
 * on all websites" — for a product whose entire claim is that it runs only
 * where you asked it to. It is gone, and this is the test that keeps it gone:
 * the next person who meets a "requires <all_urls> or activeTab" error has to
 * come here and read why before they can put it back.
 *
 * What replaced it, measured in real Chromium rather than read off a doc page:
 *   - a per-host permission does NOT satisfy captureVisibleTab, even on a host
 *     the manifest covers ("Either the '<all_urls>' or 'activeTab' permission
 *     is required"), so evidence screenshots ride on `activeTab` and skip when
 *     it is not active;
 *   - injecting into a user-enabled site needs a permission for that site,
 *     which `optional_host_permissions` lets the panel ask for one origin at a
 *     time, at the moment the user presses the button.
 */
function manifest() {
  const m = config.manifest;
  if (typeof m !== "object" || m === null || m instanceof Promise) {
    throw new Error("expected manifest to be a plain object");
  }
  return m;
}

function hostPermissions(): string[] {
  const hosts = manifest().host_permissions;
  if (!Array.isArray(hosts)) throw new Error("expected host_permissions to be a plain array");
  return hosts;
}

describe("the install prompt", () => {
  it("does not ask for every website", () => {
    expect(hostPermissions()).not.toContain("<all_urls>");
    expect(hostPermissions().some((h) => h.includes("*://*/*"))).toBe(false);
  });

  it("asks only for the platforms OfferOS fills, and the local web app", () => {
    const hosts = hostPermissions();
    expect(hosts).toContain("http://localhost/*");
    for (const host of hosts) {
      const named =
        host === "http://localhost/*" ||
        /greenhouse\.io|lever\.co|ashbyhq\.com|icims\.com|myworkdayjobs\.com/.test(host);
      expect(named, `${host} is not a platform OfferOS fills`).toBe(true);
    }
  });

  it("keeps activeTab, which is what evidence screenshots now depend on", () => {
    const permissions = manifest().permissions;
    expect(Array.isArray(permissions) && permissions.includes("activeTab")).toBe(true);
  });

  it("can ask for one site at a time, which is not part of the install prompt", () => {
    // Optional permissions are requested at the moment of use, naming the one
    // site — that is what makes "Enable OfferOS on this page" a permission
    // boundary and not just a button.
    expect(manifest().optional_host_permissions).toEqual(["*://*/*"]);
  });
});
