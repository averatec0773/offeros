// Real-PDF autofill adaptation check.
//
// Renders every corpus resume to an actual PDF with headless Chromium, then
// extracts text through the real pdfjs path (the same line-reconstruction the
// extension uses, ported below) and verifies each ground-truth fact survives
// extraction as clean, parseable text — the input the LLM parse step receives.
// This is the layer unit tests with synthetic text items cannot cover: real
// glyph positioning, real reading order, real line breaks.
//
// Usage: node scripts/resume-adaptation.mjs
// Output: a per-resume table + aggregate; exits non-zero if aggregate < 90%.

import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(ROOT, ".output/e2e-resumes");
mkdirSync(OUT, { recursive: true });

const CORPUS = JSON.parse(
  readFileSync(join(ROOT, "../../packages/autofill/src/__tests__/adaptation/resume-corpus.json"), "utf8"),
);

// --- Ported line reconstruction (mirror of src/lib/pdf-extract.ts) ----------
function reconstructText(items) {
  const lines = [];
  let cur = "";
  let curEndX = null;
  let prevY = null;
  let prevHeight = 0;
  const flush = () => {
    if (cur.trim() !== "") lines.push(cur);
    cur = "";
    curEndX = null;
    prevY = null;
  };
  for (const it of items) {
    if (it.str === "") {
      if (it.hasEOL) flush();
      continue;
    }
    const lineHeight = it.height || prevHeight || 10;
    if (prevY !== null) {
      const drop = prevY - it.y;
      if (drop > Math.max(2, lineHeight * 0.5)) flush();
    }
    if (cur !== "" && curEndX !== null) {
      const gap = it.x - curEndX;
      if (gap > Math.max(1, lineHeight * 0.2) && !cur.endsWith(" ") && !it.str.startsWith(" ")) {
        cur += " ";
      }
    }
    cur += it.str;
    curEndX = it.x + it.width;
    prevY = it.y;
    if (it.height) prevHeight = it.height;
    if (it.hasEOL) flush();
  }
  flush();
  return lines
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l !== "")
    .join("\n");
}

async function extractPdfText(pdfjs, path) {
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = content.items.flatMap((it) =>
      "str" in it
        ? [{ str: it.str, x: it.transform[4] ?? 0, y: it.transform[5] ?? 0, width: it.width ?? 0, height: it.height ?? 0, hasEOL: it.hasEOL ?? false }]
        : [],
    );
    pages.push(reconstructText(items));
  }
  return pages.join("\n\n").trim();
}

// --- Realistic single-column resume document --------------------------------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function resumeHtml(r) {
  const links = Object.values(r.links).map(esc).join("  •  ");
  const contact = [esc(r.email), esc(r.phone), esc(r.address)].filter(Boolean).join("  |  ");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #111; margin: 48px 56px; font-size: 11pt; line-height: 1.4; }
    h1 { font-size: 22pt; margin: 0 0 4px; letter-spacing: .5px; }
    .contact, .links { font-size: 10pt; color: #333; margin: 2px 0; }
    h2 { font-size: 12pt; border-bottom: 1px solid #999; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: 1px; }
    .role { display: flex; justify-content: space-between; font-weight: bold; margin-top: 8px; }
    .sub { font-style: italic; color: #444; }
    ul { margin: 4px 0 0 18px; padding: 0; }
    li { margin: 2px 0; }
    .skills { margin-top: 4px; }
  </style></head><body>
    <h1>${esc(r.fullName)}</h1>
    <div class="contact">${contact}</div>
    <div class="links">${links}</div>

    <h2>Summary</h2>
    <div>Results-driven professional with experience across product, engineering, and analysis. Focused on shipping measurable outcomes and collaborating across teams.</div>

    <h2>Experience</h2>
    <div class="role"><span>Senior Specialist — Northwind Labs</span><span>2021 — Present</span></div>
    <div class="sub">Remote</div>
    <ul><li>Led a cross-functional initiative that improved throughput by 30%.</li>
    <li>Owned reporting pipelines used by 12 stakeholders weekly.</li></ul>
    <div class="role"><span>Analyst — Contoso Group</span><span>2018 — 2021</span></div>
    <div class="sub">On-site</div>
    <ul><li>Built dashboards that reduced manual work by 20 hours per month.</li>
    <li>Mentored two junior teammates on data hygiene.</li></ul>

    <h2>Education</h2>
    <div class="role"><span>B.S., State University</span><span>2014 — 2018</span></div>
    <div class="sub">Computer Science</div>

    <h2>Skills</h2>
    <div class="skills">Python, SQL, TypeScript, React, Data Visualization, Stakeholder Communication</div>
  </body></html>`;
}

// Two-column layout: full-width name header, then a narrow left sidebar
// (contact, links, skills) beside a wider experience column. This is where
// pdf.js reading order is most likely to interleave rows across columns.
function resumeHtmlTwoColumn(r) {
  const links = Object.values(r.links).map((l) => `<div>${esc(l)}</div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: Helvetica, Arial, sans-serif; color: #111; margin: 40px 48px; font-size: 10.5pt; line-height: 1.4; }
    h1 { font-size: 20pt; margin: 0 0 2px; }
    .title { color: #555; font-size: 11pt; margin-bottom: 12px; }
    .cols { display: flex; gap: 28px; }
    .side { width: 34%; }
    .main { width: 66%; }
    h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: 1px; color: #222; border-bottom: 1px solid #bbb; margin: 14px 0 6px; }
    .side div { margin: 2px 0; font-size: 9.5pt; color: #333; word-break: break-word; }
    .role { font-weight: bold; margin-top: 8px; }
    .sub { color: #555; font-style: italic; }
    ul { margin: 4px 0 0 16px; padding: 0; }
    li { margin: 2px 0; }
  </style></head><body>
    <h1>${esc(r.fullName)}</h1>
    <div class="title">Senior Specialist</div>
    <div class="cols">
      <div class="side">
        <h2>Contact</h2>
        <div>${esc(r.email)}</div>
        <div>${esc(r.phone)}</div>
        <div>${esc(r.address)}</div>
        <h2>Links</h2>
        ${links}
        <h2>Skills</h2>
        <div>Python</div><div>SQL</div><div>TypeScript</div><div>React</div>
        <h2>Education</h2>
        <div>B.S. Computer Science</div><div>State University, 2018</div>
      </div>
      <div class="main">
        <h2>Summary</h2>
        <div>Results-driven professional with experience across product, engineering, and analysis.</div>
        <h2>Experience</h2>
        <div class="role">Senior Specialist — Northwind Labs</div>
        <div class="sub">2021 — Present</div>
        <ul><li>Led a cross-functional initiative that improved throughput by 30%.</li>
        <li>Owned reporting pipelines used by 12 stakeholders weekly.</li></ul>
        <div class="role">Analyst — Contoso Group</div>
        <div class="sub">2018 — 2021</div>
        <ul><li>Built dashboards that reduced manual work by 20 hours per month.</li></ul>
      </div>
    </div>
  </body></html>`;
}

const LAYOUTS = [
  { id: "1col", html: resumeHtml },
  { id: "2col", html: resumeHtmlTwoColumn },
];

// --- Scoring ----------------------------------------------------------------
const digits = (s) => s.replace(/\D/g, "");

function scoreExtract(r, text) {
  const checks = [];
  const add = (name, ok) => checks.push({ name, ok });

  // full name present as a contiguous string
  add("fullName", text.includes(r.fullName));
  // name isolated on its own line (parseable header)
  const lines = text.split("\n");
  add("name-line", lines.some((l) => l.trim() === r.fullName.trim()));

  add("email", text.includes(r.email));
  // phone digit-run survives (spacing/format may reflow, digits must not)
  add("phone", digits(text).includes(digits(r.phone)));

  // address: the leading locality token
  const city = r.address.split(",")[0].trim();
  if (city) add("address", text.includes(city));

  for (const [kind, url] of Object.entries(r.links)) {
    add(`link:${kind}`, text.includes(url));
  }

  const passed = checks.filter((c) => c.ok).length;
  return { checks, passed, total: checks.length, percent: Math.round((passed / checks.length) * 1000) / 10 };
}

// --- Run --------------------------------------------------------------------
const pdfjs = await import(pathToFileURL(join(ROOT, "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);

const browser = await chromium.launch();
const page = await browser.newPage();

const results = [];
for (const r of CORPUS) {
  for (const layout of LAYOUTS) {
    const pdfPath = join(OUT, `${r.id}.${layout.id}.pdf`);
    await page.setContent(layout.html(r), { waitUntil: "load" });
    await page.pdf({ path: pdfPath, format: "Letter", printBackground: true });
    const text = await extractPdfText(pdfjs, pdfPath);
    results.push({ r, layout: layout.id, score: scoreExtract(r, text), text });
  }
}
await browser.close();

const byLayout = new Map(LAYOUTS.map((l) => [l.id, { passed: 0, total: 0 }]));
let totalPassed = 0;
let totalChecks = 0;
console.log(`\nReal-PDF extraction adaptation (${CORPUS.length} resumes × ${LAYOUTS.length} layouts, rendered → pdfjs):\n`);
for (const { r, layout, score } of results) {
  totalPassed += score.passed;
  totalChecks += score.total;
  const agg = byLayout.get(layout);
  agg.passed += score.passed;
  agg.total += score.total;
  const fails = score.checks.filter((c) => !c.ok).map((c) => c.name);
  const tag = fails.length ? `  MISS: ${fails.join(", ")}` : "";
  console.log(`  ${r.id.padEnd(18)} ${layout.padEnd(5)} ${String(score.percent).padStart(5)}%  (${score.passed}/${score.total})${tag}`);
}
console.log("");
for (const [id, agg] of byLayout) {
  const pct = Math.round((agg.passed / agg.total) * 1000) / 10;
  console.log(`  ${("LAYOUT " + id).padEnd(24)} ${String(pct).padStart(5)}%  (${agg.passed}/${agg.total})`);
}
const aggregate = Math.round((totalPassed / totalChecks) * 1000) / 10;
console.log(`  ${"AGGREGATE".padEnd(24)} ${String(aggregate).padStart(5)}%  (${totalPassed}/${totalChecks})\n`);
console.log(`PDFs written to ${OUT}`);

if (aggregate < 90) {
  console.error(`FAIL: aggregate ${aggregate}% below 90% threshold`);
  process.exit(1);
}
