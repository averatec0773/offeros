// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { captureJd } from "../../src/lib/autofill/jd-capture";

beforeEach(() => { document.body.innerHTML = ""; document.head.innerHTML = ""; });

describe("captureJd", () => {
  it("prefers a JSON-LD JobPosting description", () => {
    const ld = {
      "@type": "JobPosting", title: "Backend Engineer",
      hiringOrganization: { name: "Acme" },
      description: "<p>Build <b>distributed</b> systems and own reliability across the stack for our platform team.</p>",
    };
    document.head.innerHTML = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    const r = captureJd(document);
    expect(r.source).toBe("jsonld");
    expect(r.text).toContain("Backend Engineer");
    expect(r.text).toContain("Acme");
    expect(r.text).toContain("Build distributed systems"); // HTML stripped
    expect(r.text).not.toContain("<b>");
  });

  it("falls back to main content text when no JSON-LD", () => {
    document.body.innerHTML = `<main>${"We are hiring a senior engineer to build reliable backend services at scale. ".repeat(4)}</main>`;
    const r = captureJd(document);
    expect(r.source).toBe("dom");
    expect(r.text).toContain("senior engineer");
  });

  it("returns none when there is too little text", () => {
    document.body.innerHTML = `<main>Apply now</main>`;
    expect(captureJd(document).source).toBe("none");
  });

  it("ignores non-JobPosting JSON-LD", () => {
    document.head.innerHTML = `<script type="application/ld+json">${JSON.stringify({ "@type": "Organization", name: "Acme" })}</script>`;
    document.body.innerHTML = `<main>${"Long enough job body about backend engineering work and reliability duties here. ".repeat(3)}</main>`;
    expect(captureJd(document).source).toBe("dom");
  });
});
