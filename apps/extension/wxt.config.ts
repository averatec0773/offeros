import { defineConfig } from "wxt";
import { atsMatches } from "./src/lib/ats-hosts";

const devExtKey = process.env.VITE_CHROME_EXT_KEY ?? "";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    action: {},
    side_panel: { default_path: "sidepanel.html" },
    permissions: ["storage", "tabs", "sidePanel", "nativeMessaging", "scripting", "activeTab"],
    /**
     * What the install prompt asks for: the five application platforms, and the
     * local web app. Nothing else.
     *
     * `<all_urls>` used to be here for `tabs.captureVisibleTab`, which meant
     * Chrome told every user OfferOS could "read and change all your data on
     * all websites" — for a product whose whole claim is that it only runs
     * where you asked. It is gone. What that costs is measured, not assumed:
     *
     *   - `captureVisibleTab` refuses a per-host permission. Verified in real
     *     Chromium on a host this list covers: "Either the '<all_urls>' or
     *     'activeTab' permission is required." So evidence screenshots now
     *     depend on `activeTab`, and skip when it is not active. They were
     *     always best-effort; now they are honestly so.
     *   - injecting into a site the user enabled by hand also needs more than
     *     this list: "Cannot access contents of url ... Extension manifest must
     *     request permission to access this host." That is what
     *     `optional_host_permissions` below is for.
     */
    host_permissions: ["http://localhost/*", ...atsMatches()],
    /**
     * Permission the user grants one site at a time, when they ask for it.
     *
     * Optional permissions are NOT part of the install prompt — Chrome asks at
     * the moment of the request, naming the one site. So "Enable OfferOS on
     * this page" is a real permission boundary now and not just a UX one: the
     * button asks Chrome, Chrome asks the user, and the answer is about that
     * site alone.
     */
    optional_host_permissions: ["*://*/*"],
    // The in-page overlay embeds sidepanel.html in an iframe on apply pages;
    // the page can only load extension resources that are declared here.
    web_accessible_resources: [
      {
        resources: ["sidepanel.html", "chunks/*", "assets/*", "icon/*"],
        matches: atsMatches(),
      },
    ],
    ...(devExtKey ? { key: devExtKey } : {}),
  },
});
