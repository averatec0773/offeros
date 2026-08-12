import { defineConfig } from "wxt";
import { atsMatches } from "./src/lib/ats-hosts";

const devExtKey = process.env.VITE_CHROME_EXT_KEY ?? "";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    action: {},
    side_panel: { default_path: "sidepanel.html" },
    permissions: ["storage", "tabs", "sidePanel", "nativeMessaging", "scripting"],
    host_permissions: [
      // tabs.captureVisibleTab (fill-evidence screenshots) accepts ONLY
      // "<all_urls>" or a user-gesture-activated "activeTab" — per-host
      // patterns never satisfy it ("Either the '<all_urls>' or 'activeTab'
      // permission is required."), and the overlay iframe / web-launched fill
      // tabs get no extension gesture, so activeTab can never activate there.
      "<all_urls>",
      "http://localhost/*",
      ...atsMatches(),
    ],
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
