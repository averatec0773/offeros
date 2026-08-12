// E2E: "Enable OfferOS on this page" against a site the manifest does NOT list.
//
// The question this answers, which no unit test can: does injecting the engine
// on request actually work on an arbitrary host, including the MAIN-world
// driver? A synthetic host (ats.example.com) is routed to a local fixture, so
// nothing here touches a real employer and nothing is ever submitted.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.output/chrome-mv3");

// An application form on a site nobody has written an adapter for: no
// greenhouse/lever/ashby/icims/workday anywhere, plain HTML, plus an ARIA
// combobox of the kind the generic driver has to handle.
const FORM = `<!doctype html><html><head><title>Apply — Example Systems</title></head>
<body><main><h1>Backend Engineer</h1>
<form id="app">
  <label for="e">Email *</label><input id="e" name="email" type="email" autocomplete="email" required />
  <label for="n">Full name *</label><input id="n" name="name" type="text" required />
  <label for="p">Phone</label><input id="p" name="phone" type="tel" />
  <label for="r">Resume/CV</label><input id="r" name="resume" type="file" aria-label="Resume/CV" />
  <button type="submit">Submit application</button>
</form></main></body></html>`;

const log = (k, v) => console.log(`E2E ${k}: ${v}`);
let ctx;
let failures = 0;
const check = (name, actual, expected) => {
  const pass = actual === expected;
  if (!pass) failures++;
  log(name, `${actual}${pass ? "" : ` (expected ${expected})`}`);
};

try {
  ctx = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"],
  });
  const page = await ctx.newPage();
  await ctx.route("**://ats.example.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: FORM }),
  );
  await page.goto("https://ats.example.com/apply", { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const sw =
    ctx.serviceWorkers()[0] ||
    (await ctx.waitForEvent("serviceworker", { timeout: 8000 }).catch(() => null));
  log("service_worker", !!sw);
  if (!sw) throw new Error("no service worker — cannot drive the extension");

  const tabId = await sw.evaluate(async () => {
    const [t] = await chrome.tabs.query({ url: "*://ats.example.com/*" });
    return t?.id ?? null;
  });
  log("tab_found", tabId !== null);

  // 1) The premise: with no manifest match, nothing is there. A SCAN must fail
  //    to reach anyone. If this ever passes, the host list has grown and the
  //    rest of this script proves nothing.
  const before = await sw.evaluate(
    async (id) =>
      await chrome.tabs
        .sendMessage(id, { kind: "OFFEROS_ENGINE_SCAN" })
        .then(() => "answered")
        .catch(() => "no-listener"),
    tabId,
  );
  check("engine_absent_before_enable", before, "no-listener");

  // 2) The enable button's own work: inject both scripts, driver in MAIN.
  //    Mirrors src/lib/site-enable.ts injectEngine exactly.
  const injected = await sw.evaluate(async (id) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: id },
        files: ["content-scripts/ats.js"],
      });
      await chrome.scripting.executeScript({
        target: { tabId: id },
        files: ["content-scripts/ats-driver.js"],
        world: "MAIN",
      });
      return "ok";
    } catch (e) {
      return String(e?.message ?? e);
    }
  }, tabId);
  check("injection_on_request", injected, "ok");
  await page.waitForTimeout(600);

  // 3) The engine answers now, on a host it was never listed for.
  const scan = await sw.evaluate(
    async (id) => await chrome.tabs.sendMessage(id, { kind: "OFFEROS_ENGINE_SCAN" }),
    tabId,
  );
  check("scan_ok_after_enable", scan?.ok === true, true);
  log("scan_ats_id", scan?.ok ? scan.atsId : "-");
  log("scan_descriptors", scan?.ok ? scan.descriptors.map((d) => d.name).join(",") : "-");
  check(
    "scan_found_email",
    scan?.ok ? scan.descriptors.some((d) => d.name === "email") : false,
    true,
  );

  // 4) And a fill actually lands in the page's DOM.
  const emailId = scan?.ok ? scan.descriptors.find((d) => d.name === "email")?.fieldId : null;
  if (emailId) {
    const fill = await sw.evaluate(
      async ({ id, fid }) =>
        await chrome.tabs.sendMessage(id, {
          kind: "OFFEROS_ENGINE_FILL",
          values: [{ fieldId: fid, value: "jordan@example.com" }],
        }),
      { id: tabId, fid: emailId },
    );
    log("fill_filled", fill?.filled);
    const written = await page.evaluate(() => document.querySelector('input[name="email"]').value);
    check("dom_value_written", written, "jordan@example.com");
  }

  // 5) MAIN-world driver present in the page's own world — the half that
  //    cannot be verified from an isolated content script.
  const driverInMain = await page.evaluate(
    () =>
      new Promise((resolve) => {
        // Constants from src/lib/autofill/combobox-protocol.ts. The driver
        // answers even when the field does not exist (ok:false) — an answer at
        // all is what proves it is listening in the page's own world.
        const t = setTimeout(() => resolve(false), 5000);
        window.addEventListener("message", (ev) => {
          if (ev.data?.kind === "offeros:combobox-result") {
            clearTimeout(t);
            resolve(true);
          }
        });
        window.postMessage(
          { kind: "offeros:combobox-fill", fieldId: "no-such-field", value: "x" },
          "*",
        );
      }),
  );
  check("main_world_driver_listening", driverInMain, true);

  // Nothing is ever submitted.
  const stillOnForm = await page.evaluate(() => !!document.querySelector("#app"));
  check("never_submitted", stillOnForm, true);
} catch (err) {
  failures++;
  log("error", err?.message ?? String(err));
} finally {
  await ctx?.close();
}
log("failures", failures);
process.exit(failures === 0 ? 0 : 1);
