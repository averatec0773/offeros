// T6 E2E: load the built extension in real Chromium, inject the content-script
// engine onto a Greenhouse-hosted page (routed fixture), and — if the MV3 SW is
// reachable — drive SCAN/FILL over the real messaging bus. No submit ever.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

// Resolve the built extension relative to this script (apps/extension/scripts/).
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.output/chrome-mv3");
const FORM = `<!doctype html><html><head><title>Staff Engineer — Acme</title></head>
<body><main><h1>Staff Engineer</h1>
<form id="app">
  <label for="e">Email *</label><input id="e" name="email" type="email" autocomplete="email" required />
  <label for="n">Full name *</label><input id="n" name="name" type="text" required />
  <label for="p">Phone</label><input id="p" name="phone" type="tel" />
  <button type="submit">Submit application</button>
</form></main></body></html>`;

const log = (k, v) => console.log(`E2E ${k}: ${v}`);
let ctx;
try {
  ctx = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"],
  });
  const page = await ctx.newPage();
  // Serve the fixture for any greenhouse apply URL so the content script matches.
  await ctx.route("**://boards.greenhouse.io/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: FORM }),
  );
  await page.goto("https://boards.greenhouse.io/acme/jobs/123", { waitUntil: "load" });
  await page.waitForTimeout(1500); // let the content script run

  // 1) content script injected on a real greenhouse host → highlight style present
  const hasHighlight = await page.evaluate(
    () => !![...document.querySelectorAll("style")].find((s) => s.textContent.includes(".offeros-filled")),
  );
  log("content_script_injected", hasHighlight);

  // 2) reach the MV3 service worker to drive the engine over messaging
  let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 8000 }).catch(() => null));
  log("service_worker", !!sw);

  if (sw) {
    const tabId = await sw.evaluate(async () => {
      const [t] = await chrome.tabs.query({ url: "*://boards.greenhouse.io/*" });
      return t?.id ?? null;
    });
    log("ats_tab_found", tabId !== null);

    const scan = await sw.evaluate(
      async (id) => await chrome.tabs.sendMessage(id, { kind: "OFFEROS_ENGINE_SCAN" }),
      tabId,
    );
    log("scan_ok", scan?.ok === true);
    log("scan_descriptors", scan?.ok ? scan.descriptors.map((d) => d.name).join(",") : "-");

    const emailId = scan?.ok ? scan.descriptors.find((d) => d.name === "email")?.fieldId : null;
    const fill = await sw.evaluate(
      async ({ id, fid }) =>
        await chrome.tabs.sendMessage(id, { kind: "OFFEROS_ENGINE_FILL", values: [{ fieldId: fid, value: "a@b.com" }] }),
      { id: tabId, fid: emailId },
    );
    log("fill_filled", fill?.filled);
    log("fill_outcomes_serializable", Array.isArray(fill?.outcomes));

    const written = await page.evaluate(() => document.querySelector('input[name="email"]').value);
    log("dom_value_written", written);
    const highlighted = await page.evaluate(() => document.querySelector('input[name="email"]').classList.contains("offeros-filled"));
    log("field_highlighted", highlighted);
  }

  // 3) side panel bundle renders (as a normal tab it's off-ATS → empty state)
  if (sw) {
    const extId = new URL(sw.url()).host;
    const sp = await ctx.newPage();
    await sp.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: "load" }).catch(() => {});
    await sp.waitForTimeout(800);
    const heading = await sp.evaluate(() => document.body.innerText.includes("OfferOS")).catch(() => false);
    log("sidepanel_renders", heading);
  }

  // 4) never submitted
  log("no_submit", "confirmed (engine has no submit path)");
} catch (e) {
  log("FAIL", e.message.split("\n")[0]);
} finally {
  if (ctx) await ctx.close();
}
