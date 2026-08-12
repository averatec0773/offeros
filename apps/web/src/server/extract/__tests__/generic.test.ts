import { describe, it, expect } from "vitest";
import { fromMetaTags, readPage } from "../generic";
import { SOURCE_RANK } from "../types";

/**
 * A job description that was one sentence long.
 *
 * `MIN_BODY_CHARS` guarded the rendered-body collector, and nothing guarded the
 * meta collector — which ran FIRST and shared the same source rank, and equal
 * ranks keep whoever arrived first. So a 150-character `og:description` written
 * for a link preview beat a complete rendered description every time, and got
 * stored as the job description.
 */
describe("the page's blurb versus the page's body", () => {
  const BLURB = "Join our team and help build the future of logistics software. Apply today!";
  const BODY = `We are hiring a Backend Engineer to own our ingestion pipeline. ${"You will work across services and own delivery end to end. ".repeat(10)}`;

  const page = (opts: { blurb?: boolean; body?: boolean }) => `<html><head>
    ${opts.blurb ? `<meta property="og:description" content="${BLURB} ${BLURB}" />` : ""}
    <meta property="og:title" content="Backend Engineer" />
    </head><body>${opts.body ? `<main><article>${BODY}</article></main>` : "<div>nav</div>"}</body></html>`;

  it("the real body wins when the page has both", () => {
    const evidence = readPage(page({ blurb: true, body: true }));
    const chosen = evidence.filter((e) => e.fields.jdText);
    // Both are offered, but the body outranks the blurb.
    const body = chosen.find((e) => e.source === "page");
    const blurb = chosen.find((e) => e.source === "page-summary");
    expect(body?.fields.jdText).toContain("ingestion pipeline");
    expect(blurb?.fields.jdText).toContain("logistics software");
    expect(SOURCE_RANK["page"]).toBeGreaterThan(SOURCE_RANK["page-summary"]);
  });

  it("the blurb is still offered when the page has no body a server can read", () => {
    // A posting written entirely by JavaScript: this sentence is all a server
    // can see, and it beats an empty card as long as it says what it is.
    const evidence = readPage(page({ blurb: true, body: false }));
    const blurb = evidence.find((e) => e.source === "page-summary");
    expect(blurb?.fields.jdText).toContain("logistics software");
  });

  it("a one-line tagline is not even a summary", () => {
    const html = `<html><head><meta property="og:description" content="We are hiring!" /></head><body></body></html>`;
    expect(readPage(html).some((e) => e.source === "page-summary")).toBe(false);
  });

  it("the meta collector no longer claims a description at all", () => {
    // Title and company from meta are fine; the description is a separate,
    // lower-ranked piece of evidence now.
    const meta = fromMetaTags(page({ blurb: true, body: true }));
    expect(meta?.fields.title).toBe("Backend Engineer");
    expect(meta?.fields.jdText).toBeUndefined();
  });
});
