import { describe, expect, it } from "vitest";
import config from "../wxt.config";

/**
 * What the install prompt asks for, and why it asks for that much.
 *
 * This file used to hold the opposite test: `<all_urls>` was forbidden, and the
 * manifest named five platforms plus an optional per-site permission the panel
 * requested when the user pressed "Enable OfferOS on this page".
 *
 * The narrower thing did not survive use. Application forms live on companies'
 * own careers pages, so the case needing a grant was the ordinary case, and the
 * grant machinery produced days of failures — a panel stuck on "Starting…", a
 * timeout message blaming a permission prompt that had never opened — while the
 * owner never once saw the prompt it existed to show. A permission boundary
 * that only ever produces bugs is not protecting anybody.
 *
 * So the ask is broad and stated plainly, here and in `.github/SECURITY.md`,
 * and the limits that actually hold are elsewhere: the engine goes onto a page
 * only while the panel is open on it, everything read stays on this machine,
 * and nothing is ever submitted. If this test changes back, SECURITY.md has to
 * change with it — a public security document that describes a manifest we do
 * not ship is worse than no document.
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
  it("asks for every site, because a job posting can be on any of them", () => {
    expect(hostPermissions()).toEqual(["<all_urls>"]);
  });

  it("no longer carries the machinery for asking one site at a time", () => {
    // Optional permissions were the per-site grant. Nothing requests them now,
    // and a manifest that keeps asking for capabilities nothing uses is a
    // manifest nobody can reason about.
    expect(manifest().optional_host_permissions).toBeUndefined();
  });

  it("asks for nothing it does not use", () => {
    // storage for settings, tabs to follow the active page, sidePanel for the
    // panel itself, scripting for the on-demand injection, nativeMessaging for
    // the one-click local app start. `activeTab` is absent because the one
    // thing that needed it — the post-fill screenshot — has been removed.
    expect(manifest().permissions).toEqual([
      "storage",
      "tabs",
      "sidePanel",
      "nativeMessaging",
      "scripting",
    ]);
  });
});
