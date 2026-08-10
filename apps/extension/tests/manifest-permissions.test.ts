import { describe, expect, it } from "vitest";
import config from "../wxt.config";

// Fill-evidence screenshots go through tabs.captureVisibleTab, and Chrome
// accepts ONLY "<all_urls>" or a user-gesture-activated "activeTab" for it —
// per-host patterns silently fail with "Either the '<all_urls>' or 'activeTab'
// permission is required." The overlay iframe and web-launched fill tabs never
// receive an extension gesture, so activeTab can never activate there; the
// manifest must carry "<all_urls>" or every evidence capture returns {ok:false}.
describe("manifest permissions for tab capture", () => {
  it("host_permissions include <all_urls> (required by captureVisibleTab)", () => {
    const manifest = config.manifest;
    // wxt.config.ts always passes a plain object; narrow the wider WXT type.
    if (typeof manifest !== "object" || manifest === null || manifest instanceof Promise) {
      throw new Error("expected manifest to be a plain object");
    }
    const hosts = manifest.host_permissions;
    if (!Array.isArray(hosts)) throw new Error("expected host_permissions to be a plain array");
    expect(hosts).toContain("<all_urls>");
  });
});
