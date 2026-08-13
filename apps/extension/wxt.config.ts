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
     * Every site, because the job is on every site.
     *
     * This was a five-platform allowlist plus an optional per-site grant the
     * user could give from the panel. The intent was honest — ask for the
     * narrowest thing that works — but the result was not: application forms
     * live on thousands of company careers pages, so the common case was the
     * one that needed a grant, and the grant machinery produced days of
     * failures (a panel stuck on "Starting…", a timeout message blaming a
     * permission prompt that had never opened) while never once delivering
     * what it promised. The owner never saw a permission prompt at all.
     *
     * So the trade is made explicitly rather than pretended away: OfferOS asks
     * for access to all sites, and Chrome says so at install. What that access
     * is used for has not changed and is bounded elsewhere — the engine is
     * injected into the five platforms automatically and into any other page
     * only while its panel is open on it, everything it reads stays on this
     * machine, and it never submits a form. `.github/SECURITY.md` states this
     * in the same terms; if this line changes, that file changes with it.
     */
    host_permissions: ["<all_urls>"],
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
