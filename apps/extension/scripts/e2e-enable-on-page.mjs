// E2E: "Enable OfferOS on this page", in two halves.
//
// Since `<all_urls>` was removed the enable path has a permission boundary in
// front of it, so this measures both sides of that boundary:
//
//   A. A host the extension holds nothing for. Injection must be REFUSED, with
//      the message the panel turns into a one-site permission prompt. This is
//      the new boundary, and it has to be real.
//   B. A host the extension does hold — localhost, which is in host_permissions
//      but NOT in the ATS content-script matches, so nothing auto-injects
//      there. That is precisely the shape of an enabled site: permission
//      granted, engine absent until asked. Inject on request, then drive the
//      whole chain.
//
// What is NOT covered here, deliberately rather than by omission: the
// permission PROMPT itself. `chrome.permissions.request` needs a user gesture
// and Chrome renders the prompt as browser UI, neither of which automation can
// supply. Part A proves the refusal that triggers it; a human has to see the
// prompt itself.
//
// Everything is routed to local fixtures on synthetic hosts. Nothing is ever
// submitted.
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
  <div role="region" aria-label="Educational Details">
    <div id="edu-rows"></div>
    <button type="button" id="edu-add"
      aria-label="Add an entry to the Educational Details tabular section. 0 of 10 entries added currently.">+ Add</button>
  </div>
  <div class="lyte-fileupload" cx-prop-label="Upload CV">
    <button type="button">Choose file</button>
    <input type="file" id="" name="rec-form_9001_file" style="display:none" />
  </div>
  <span id="cq">Country</span>
  <div id="cb" role="combobox" aria-labelledby="cq" aria-expanded="false" tabindex="0">Select one</div>
  <button type="submit">Submit application</button>
</form>
<script>
  // A custom dropdown built the way most of them are: ARIA roles, and a
  // listbox portalled to the end of <body>. No framework, no adapter — this
  // is what the generic driver has to cope with.
  // A tabular repeater: rows exist only after the Add button is pressed.
  var eduRows = document.getElementById("edu-rows");
  document.getElementById("edu-add").addEventListener("click", function () {
    if (eduRows.querySelectorAll("input").length / 2 >= 10) return;
    var row = document.createElement("div");
    row.innerHTML = '<input name="school" /><input name="degree" />';
    eduRows.appendChild(row);
  });

  var cb = document.getElementById("cb");
  cb.addEventListener("click", function () {
    if (document.getElementById("lb")) return;
    var lb = document.createElement("div");
    lb.id = "lb";
    lb.setAttribute("role", "listbox");
    ["United States", "Canada", "Germany"].forEach(function (name) {
      var o = document.createElement("div");
      o.setAttribute("role", "option");
      o.setAttribute("aria-selected", "false");
      o.textContent = name;
      o.addEventListener("click", function () {
        cb.textContent = name;
        cb.setAttribute("aria-expanded", "false");
        lb.remove();
      });
      lb.appendChild(o);
    });
    document.body.appendChild(lb);
    cb.setAttribute("aria-expanded", "true");
  });
</script>
</main></body></html>`;

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
  await ctx.route("**://localhost/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: FORM }),
  );
  await page.goto("https://ats.example.com/apply", { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const sw =
    ctx.serviceWorkers()[0] ||
    (await ctx.waitForEvent("serviceworker", { timeout: 8000 }).catch(() => null));
  log("service_worker", !!sw);
  if (!sw) throw new Error("no service worker — cannot drive the extension");

  let tabId = await sw.evaluate(async () => {
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
  check("engine_absent_on_unpermitted_host", before, "no-listener");

  // 2) THE BOUNDARY. With no permission for this host, Chrome must refuse —
  //    and refuse in the words site-enable.ts reads to decide whether asking
  //    the user would help.
  const refused = await sw.evaluate(async (id) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: id },
        files: ["content-scripts/ats.js"],
      });
      return "UNEXPECTEDLY ALLOWED";
    } catch (e) {
      return String(e?.message ?? e);
    }
  }, tabId);
  log("unpermitted_host_refusal", refused);
  check(
    "refusal_is_the_askable_kind",
    /must request permission|Cannot access contents of/i.test(refused),
    true,
  );
  log("permission_prompt_coverage", "not automatable — needs a user gesture and browser UI");

  // 3) The permitted-host half. localhost is in host_permissions and NOT in the
  //    ATS matches, so nothing auto-injects: an enabled site's exact shape.
  await page.goto("http://localhost/apply", { waitUntil: "load" });
  await page.waitForTimeout(900);
  tabId = await sw.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t?.id ?? null;
  });

  const beforeLocal = await sw.evaluate(
    async (id) =>
      await chrome.tabs
        .sendMessage(id, { kind: "OFFEROS_ENGINE_SCAN" })
        .then(() => "answered")
        .catch(() => "no-listener"),
    tabId,
  );
  check("engine_absent_before_enable", beforeLocal, "no-listener");

  // 4) The enable button's own work: inject both scripts, driver in MAIN.
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

  // 4b) The generic ARIA driver, on a widget nobody wrote a driver for.
  const comboId = scan?.ok ? scan.descriptors.find((d) => d.type === "listbox")?.fieldId : null;
  check("aria_combobox_scanned_as_listbox", comboId != null, true);
  if (comboId) {
    const comboFill = await sw.evaluate(
      async ({ id, fid }) =>
        await chrome.tabs.sendMessage(id, {
          kind: "OFFEROS_ENGINE_FILL",
          values: [{ fieldId: fid, value: "Canada" }],
        }),
      { id: tabId, fid: comboId },
    );
    log("aria_combobox_filled", comboFill?.filled);
    const shown = await page.evaluate(() => document.getElementById("cb").textContent);
    check("aria_combobox_committed", shown, "Canada");
  }

  // 4c) The repeater: rows that do not exist until asked for.
  const eduBefore = await page.evaluate(() => document.querySelectorAll("#edu-rows input").length);
  const expanded = await sw.evaluate(
    async (id) =>
      await chrome.tabs.sendMessage(id, { kind: "OFFEROS_ENGINE_EXPAND_REPEATERS", wanted: 3 }),
    tabId,
  );
  const eduAfter = await page.evaluate(() => document.querySelectorAll("#edu-rows input").length);
  log("repeater_sections", JSON.stringify(expanded?.sections ?? []));
  check("repeater_rows_added", expanded?.added, 3);
  check("repeater_fields_before", eduBefore, 0);
  check("repeater_fields_after", eduAfter, 6);

  // 4d) The hidden file input behind a custom uploader.
  const rescan = await sw.evaluate(
    async (id) => await chrome.tabs.sendMessage(id, { kind: "OFFEROS_ENGINE_SCAN" }),
    tabId,
  );
  const hidden = rescan?.ok
    ? rescan.descriptors.find((d) => d.type === "file" && d.label === "Upload CV")
    : null;
  check("custom_uploader_scanned", hidden != null, true);
  if (hidden) {
    const attached = await sw.evaluate(
      async ({ id, fid }) =>
        await chrome.tabs.sendMessage(id, {
          kind: "OFFEROS_ENGINE_ATTACH_FILE",
          fieldId: fid,
          fileName: "resume.pdf",
          mimeType: "application/pdf",
          bytesBase64: btoa("%PDF-1.4 synthetic fixture"),
        }),
      { id: tabId, fid: hidden.fieldId },
    );
    check("custom_uploader_attached", attached?.ok, true);
    const shown = await page.evaluate(
      () => document.querySelector('input[name="rec-form_9001_file"]').files[0]?.name ?? "",
    );
    check("custom_uploader_file_on_page", shown, "resume.pdf");
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
