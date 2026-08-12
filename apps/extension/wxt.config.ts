import { defineConfig } from "wxt";
import { atsMatches } from "./src/lib/ats-hosts";

const devExtKey = process.env.VITE_CHROME_EXT_KEY ?? "";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    action: {},
    side_panel: { default_path: "sidepanel.html" },
    // `activeTab` + `scripting` are what "Enable OfferOS on this page" runs on:
    // the user presses a button on the page they are looking at, and the engine
    // is injected into that tab for that visit. It is the permission model this
    // feature is supposed to have — see the note on host_permissions below for
    // what actually authorises the injection today.
    permissions: ["storage", "tabs", "sidePanel", "nativeMessaging", "scripting", "activeTab"],
    host_permissions: [
      // tabs.captureVisibleTab (fill-evidence screenshots) accepts ONLY
      // "<all_urls>" or a user-gesture-activated "activeTab" — per-host
      // patterns never satisfy it ("Either the '<all_urls>' or 'activeTab'
      // permission is required."), and the overlay iframe / web-launched fill
      // tabs get no extension gesture, so activeTab can never activate there.
      //
      // NOTE, and it matters: while this is here, the extension already holds
      // permission for every site, and Chrome's install prompt says so ("Read
      // and change all your data on all websites"). The enable button is
      // therefore a UX boundary, not yet a permission boundary — it is the
      // thing that decides where the engine goes, but it is not the thing that
      // authorises it. Any public claim that OfferOS does not ask for full-site
      // access is FALSE until this line is removed, which would mean giving up
      // evidence screenshots on tabs with no extension gesture.
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
