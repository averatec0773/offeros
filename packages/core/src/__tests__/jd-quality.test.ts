import { describe, it, expect } from "vitest";
import { inspectJdText, looksLikeCapturedCode, SUSPECT_JD_NOTICE } from "../jd-quality";

/**
 * The alarm has to be loud about captured source and completely silent about
 * ordinary postings — including the ones that talk about code, which in this
 * product is most of them. Every "real posting" case below is the kind of text
 * a false positive would insult.
 */

const pad = (s: string, n = 400) => s.repeat(Math.ceil(n / s.length)).slice(0, n);

const CAPTURED_SCRIPT = pad(
  `var app={init:function(){for(var i=0;i<10;i++){document.getElementById('x'+i).value='';}},` +
    `send:function(e){return window.__cfg.post(e);}};`,
);

const REAL_POSTING = `We are hiring a Backend Engineer to own our data ingestion pipeline.
You will design and build services in Go and TypeScript, work closely with the
platform team, and help us move from a nightly batch to a streaming model. We
care about clear writing, small changes, and tests that say what they mean.
Requirements: five years of backend experience, comfort with SQL, and a habit
of leaving code better than you found it. Nice to have: Kubernetes, Kafka.`;

const POSTING_MENTIONING_CODE = `You will write TypeScript and Python every day.
Our stack uses React on the front end (with hooks, not classes) and Postgres
behind an API layer. Experience with functional patterns such as map/filter is
welcome. You might write something like const total = items.reduce(sum, 0) on
any given afternoon, and you will review a lot of other people's diffs. We
value engineers who can explain a design in a paragraph before writing it.`;

describe("captured page source", () => {
  it("is caught", () => {
    expect(looksLikeCapturedCode(CAPTURED_SCRIPT)).toBe(true);
  });

  it("is caught by density plus a construct, not by either alone", () => {
    const q = inspectJdText(CAPTURED_SCRIPT);
    expect(q.syntaxDensity).toBeGreaterThan(0.04);
    expect(q.codeSignals).toBeGreaterThanOrEqual(1);
  });

  it("catches captured markup as well as script", () => {
    const markup = pad(`<div class="crm-row"><span></span><input /></div>`);
    expect(looksLikeCapturedCode(markup)).toBe(true);
  });
});

describe("real postings", () => {
  it.each([
    ["an ordinary description", REAL_POSTING],
    ["one that talks about code all the way through", POSTING_MENTIONING_CODE],
  ])("%s is left alone", (_name, text) => {
    expect(looksLikeCapturedCode(text)).toBe(false);
  });

  it("says nothing about a description too short to judge", () => {
    // A three-line description is a problem the user can already see.
    expect(looksLikeCapturedCode("Backend Engineer. Apply within.")).toBe(false);
    expect(looksLikeCapturedCode("")).toBe(false);
    expect(looksLikeCapturedCode(null)).toBe(false);
  });

  it("tolerates a posting that quotes one line of code", () => {
    const quoted = `${REAL_POSTING}\n\nExample: const greeting = "hello";`;
    expect(looksLikeCapturedCode(quoted)).toBe(false);
  });
});

describe("what the user is told", () => {
  it("offers the two ways out and blames nobody", () => {
    expect(SUSPECT_JD_NOTICE).toMatch(/re-fetch/i);
    expect(SUSPECT_JD_NOTICE).toMatch(/paste/i);
  });
});
