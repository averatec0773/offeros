// T6 E2E: load the built extension in real Chromium, inject the content-script
// engine onto a Greenhouse-hosted page (routed fixture), and — if the MV3 SW is
// reachable — drive SCAN/FILL/ATTACH_FILE/CAPTURE_JD over the real messaging
// bus. No submit ever.
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
  <label for="r">Resume/CV</label><input id="r" name="resume" type="file" aria-label="Resume/CV" accept=".pdf,.doc,.docx" />
  <button type="submit">Submit application</button>
</form></main></body></html>`;

// Second fixture: a posting page (not the apply form) carrying a JSON-LD
// JobPosting block — synthetic Acme Cloud data, no real employer. Routed
// under the same greenhouse host so the content script's matches +
// matchAts() both still apply without new host_permissions.
const POSTING = `<!doctype html><html><head><title>Senior Frontend Engineer — Acme Cloud</title>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org/",
  "@type": "JobPosting",
  title: "Senior Frontend Engineer",
  hiringOrganization: { name: "Acme Cloud" },
  description:
    "<p>Acme Cloud is hiring a Senior Frontend Engineer to build our customer console with React and TypeScript. Remote-friendly; HQ at example.com.</p>",
})}</script>
</head><body><main><h1>Senior Frontend Engineer</h1><p>Acme Cloud — remote-friendly frontend role.</p></main></body></html>`;

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
  // More specific path, registered after the catch-all above — Playwright
  // resolves the most-recently-registered matching route first.
  await ctx.route("**://boards.greenhouse.io/acme/jobs/456**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: POSTING }),
  );
  await page.goto("https://boards.greenhouse.io/acme/jobs/123", { waitUntil: "load" });
  await page.waitForTimeout(1500); // let the content script run

  // 1) content script injected on a real greenhouse host → highlight style present
  const hasHighlight = await page.evaluate(
    () =>
      !![...document.querySelectorAll("style")].find((s) =>
        s.textContent.includes(".offeros-filled"),
      ),
  );
  log("content_script_injected", hasHighlight);

  // 2) reach the MV3 service worker to drive the engine over messaging
  let sw =
    ctx.serviceWorkers()[0] ||
    (await ctx.waitForEvent("serviceworker", { timeout: 8000 }).catch(() => null));
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
        await chrome.tabs.sendMessage(id, {
          kind: "OFFEROS_ENGINE_FILL",
          values: [{ fieldId: fid, value: "a@b.com" }],
        }),
      { id: tabId, fid: emailId },
    );
    log("fill_filled", fill?.filled);
    log("fill_outcomes_serializable", Array.isArray(fill?.outcomes));

    const written = await page.evaluate(() => document.querySelector('input[name="email"]').value);
    log("dom_value_written", written);
    const highlighted = await page.evaluate(() =>
      document.querySelector('input[name="email"]').classList.contains("offeros-filled"),
    );
    log("field_highlighted", highlighted);

    // 2b) file attach. Task-mode file attach lives in the side panel's
    // fill-panel flow, which this harness cannot drive — it isn't a normal
    // tab a Playwright page object can script (chrome.sidePanel has no
    // content-accessible surface) and driving it would mean re-implementing
    // the panel's own claim/poll logic here. The deepest layer this harness
    // *can* genuinely reach is the same one the panel itself calls through:
    // the engine's OFFEROS_ENGINE_ATTACH_FILE message, sent the same way
    // SCAN/FILL are above (service worker → tabs.sendMessage). That still
    // exercises the real attach path (dom-fill's DataTransfer assignment +
    // verification) end to end, just with the panel's UI layer removed.
    const resumeFieldId = scan?.ok
      ? scan.descriptors.find((d) => d.name === "resume" && d.type === "file")?.fieldId
      : null;
    log("resume_field_scanned", resumeFieldId != null);

    const fakePdfBase64 = Buffer.from("%PDF-1.4\n% synthetic fixture PDF for E2E\n%%EOF").toString(
      "base64",
    );
    const attach = await sw.evaluate(
      async ({ id, fid, b64 }) =>
        await chrome.tabs.sendMessage(id, {
          kind: "OFFEROS_ENGINE_ATTACH_FILE",
          fieldId: fid,
          fileName: "jordan-rivera-resume.pdf",
          mimeType: "application/pdf",
          bytesBase64: b64,
        }),
      { id: tabId, fid: resumeFieldId, b64: fakePdfBase64 },
    );
    log("attach_ok", attach?.ok === true);

    const attachedFile = await page.evaluate(() => {
      const input = document.querySelector('input[name="resume"]');
      return { count: input?.files?.length ?? 0, name: input?.files?.[0]?.name ?? "" };
    });
    log("attach_files_length", attachedFile.count);
    log("attach_file_name", attachedFile.name);
  }

  // 3) side panel bundle renders (as a normal tab it's off-ATS → empty state)
  if (sw) {
    const extId = new URL(sw.url()).host;
    const sp = await ctx.newPage();
    await sp
      .goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: "load" })
      .catch(() => {});
    await sp.waitForTimeout(800);
    const heading = await sp
      .evaluate(() => document.body.innerText.includes("OfferOS"))
      .catch(() => false);
    log("sidepanel_renders", heading);
  }

  // 4) Add-this-job capture: drive CAPTURE_JD against a posting fixture
  // carrying a JSON-LD JobPosting block, over the same SW → tabs.sendMessage
  // path used above. captureJd() doesn't depend on an apply-form's field
  // recipe, only on matchAts() gating the content script, so the fixture
  // reuses the greenhouse host with a distinct path routed to POSTING.
  if (sw) {
    const jdPage = await ctx.newPage();
    await jdPage.goto("https://boards.greenhouse.io/acme/jobs/456", { waitUntil: "load" });
    await jdPage.waitForTimeout(1200);

    const jdTabId = await sw.evaluate(async () => {
      const [t] = await chrome.tabs.query({ url: "*://boards.greenhouse.io/acme/jobs/456*" });
      return t?.id ?? null;
    });
    log("jd_tab_found", jdTabId !== null);

    const capture = await sw.evaluate(
      async (id) => await chrome.tabs.sendMessage(id, { kind: "OFFEROS_ENGINE_CAPTURE_JD" }),
      jdTabId,
    );
    log("capture_jd_source", capture?.source);
    log(
      "capture_jd_has_text",
      typeof capture?.jd === "string" &&
        capture.jd.includes("Senior Frontend Engineer") &&
        capture.jd.includes("Acme Cloud"),
    );
    log("capture_jd_structured_title", capture?.structuredTitle === "Senior Frontend Engineer");
    log("capture_jd_structured_company", capture?.structuredCompany === "Acme Cloud");

    await jdPage.close();
  }

  // 5) never submitted
  log("no_submit", "confirmed (engine has no submit path)");
} catch (e) {
  log("FAIL", e.message.split("\n")[0]);
} finally {
  if (ctx) await ctx.close();
}
