// Workday Skills probe (Playwright, real Chromium).
//
// Proves the OfferOS skills capability against a faithful Workday shadow-DOM
// skills widget (scripts/fixtures/workday-skills.html) in a REAL browser — beyond
// the happy-dom unit tests. It:
//   1. shows the NAIVE approach (top-level [role="option"]) finds nothing,
//      because Workday's ui5 skill picker keeps its options in shadow roots;
//   2. bundles the REAL src/lib/autofill/skills-fill.ts with esbuild, injects
//      it, and shows it types + verifies + tags each resume skill, skipping the
//      one the closed taxonomy has no option for.
//
// Why a fixture, not the live Intel page: Workday's /apply form sits behind a
// Create-Account/Sign-In wall, so the widget can't be reached without a
// candidate account. The fixture reproduces the exact shadow-DOM contract.
//
// Usage: node scripts/workday-skills-probe.mjs
// Exit 0 = capability confirmed. Exit 1 = behavior regressed.

import { chromium } from "playwright";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURE = pathToFileURL(resolve(ROOT, "scripts/fixtures/workday-skills.html")).href;
const RESUME_SKILLS = ["C", "C++", "Linux", "CUDA", "Floating-point arithmetic"];
const log = (...a) => console.log("[probe]", ...a);

// Bundle the real fillSkills (with deep-query + skill-match) into an IIFE.
const bundled = await build({
  entryPoints: [resolve(ROOT, "src/lib/autofill/skills-fill.ts")],
  bundle: true,
  format: "iife",
  globalName: "OfferOSSkills",
  write: false,
  logLevel: "silent",
});
const skillsJs = bundled.outputFiles[0].text;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(FIXTURE);

// 1) Naive: what a top-level option query sees (the old approach).
const naiveOptionCount = await page.evaluate(async () => {
  const host = document.querySelector("ui5-input-xweb-skill-profiler");
  const input = host.shadowRoot.querySelector("input");
  input.value = "C";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  return document.querySelectorAll('[role="option"]').length; // light-DOM only
});

// reset the widget
await page.goto(FIXTURE);
await page.addScriptTag({ content: skillsJs });

// 2) Real fillSkills through shadow DOM.
const result = await page.evaluate(async (skills) => {
  const host = document.querySelector("ui5-input-xweb-skill-profiler");
  const res = await window.OfferOSSkills.fillSkills(host, skills);
  return { res, chips: window.__offerosSelectedSkills() };
}, RESUME_SKILLS);

log(
  `Naive top-level [role="option"] query saw: ${naiveOptionCount} options (shadow DOM hides them)`,
);
log(`Real fillSkills → filled: [${result.res.filled.join(", ")}]`);
log(`Real fillSkills → skipped: [${result.res.skipped.join(", ")}]`);
log(`Chips actually tagged in the widget: [${result.chips.join(", ")}]`);

await browser.close();

const expectFilled = ["C", "C++", "Linux", "CUDA"];
const problems = [];
if (naiveOptionCount !== 0)
  problems.push(`naive query should see 0 options, saw ${naiveOptionCount}`);
if (JSON.stringify(result.chips.sort()) !== JSON.stringify([...expectFilled].sort())) {
  problems.push(`expected chips ${expectFilled} but widget has ${result.chips}`);
}
if (!result.res.skipped.includes("Floating-point arithmetic")) {
  problems.push("expected 'Floating-point arithmetic' to be skipped (closed taxonomy)");
}

if (problems.length) {
  log("");
  log("REGRESSION — review this probe:");
  for (const p of problems) log("  - " + p);
  process.exit(1);
}

log("");
log("CAPABILITY CONFIRMED: shadow-piercing + verified per-skill selection tagged");
log(
  `${result.chips.length}/${RESUME_SKILLS.length} skills; the taxonomy miss was reported, not silently dropped.`,
);
process.exit(0);
