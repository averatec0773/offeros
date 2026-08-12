import { describe, it, expect } from "vitest";
import { isSameJobUrl, jobIdentity, normalizeJobUrl } from "../job-url";

/**
 * The regression this file exists for: a board's embedded application form
 * puts the job's identity in the QUERY STRING, and the old normalisation threw
 * the query string away. Every posting on that board collapsed into one, so
 * adding a new job was reported as a duplicate and the user was sent to an
 * unrelated job they had saved earlier — believing they had just added one.
 *
 * All fixtures below are synthetic.
 */

const embed = (board: string, id: string) =>
  `https://job-boards.greenhouse.io/embed/job_app?for=${board}&token=${id}`;

describe("the regression", () => {
  it("two different jobs on the same board are two different jobs", () => {
    const a = embed("acme", "1234567");
    const b = embed("acme", "7654321");
    expect(isSameJobUrl(a, b)).toBe(false);
    // …and the normalisation alone no longer collapses them either.
    expect(normalizeJobUrl(a)).not.toBe(normalizeJobUrl(b));
  });

  it("two boards are two different jobs even at the same id", () => {
    expect(isSameJobUrl(embed("acme", "1234567"), embed("globex", "1234567"))).toBe(false);
  });

  it("a job is still the same job as itself", () => {
    expect(isSameJobUrl(embed("acme", "1234567"), embed("acme", "1234567"))).toBe(true);
  });
});

describe("tracking parameters are noise", () => {
  const plain = "https://boards.greenhouse.io/acme/jobs/1234567";

  it("ignores the utm_ family", () => {
    for (const param of ["utm_source=x", "utm_medium=y", "utm_campaign=z", "utm_content=q"]) {
      expect(isSameJobUrl(plain, `${plain}?${param}`)).toBe(true);
    }
  });

  it("ignores the other known trackers", () => {
    for (const param of [
      "gh_src=abc",
      "ref=someplace",
      "referrer=someplace",
      "source=someplace",
      "fbclid=1",
      "gclid=2",
      "mc_cid=3",
      "mc_eid=4",
    ]) {
      expect(isSameJobUrl(plain, `${plain}?${param}`)).toBe(true);
    }
  });

  it("ignores several at once, in any order", () => {
    expect(isSameJobUrl(plain, `${plain}?utm_source=x&gh_src=y&ref=z`)).toBe(true);
  });

  it("strips them from an embed link without touching its identity", () => {
    const withTracking = `${embed("acme", "1234567")}&utm_source=x&gh_src=y`;
    expect(isSameJobUrl(embed("acme", "1234567"), withTracking)).toBe(true);
    expect(isSameJobUrl(withTracking, embed("acme", "7654321"))).toBe(false);
  });
});

describe("parameter order does not change a link's meaning", () => {
  it("matches the same parameters written in a different order", () => {
    const a = "https://careers.example.com/apply?jobId=42&loc=austin";
    const b = "https://careers.example.com/apply?loc=austin&jobId=42";
    expect(isSameJobUrl(a, b)).toBe(true);
  });

  it("still distinguishes different values", () => {
    const a = "https://careers.example.com/apply?jobId=42";
    const b = "https://careers.example.com/apply?jobId=99";
    expect(isSameJobUrl(a, b)).toBe(false);
  });
});

describe("unknown parameters are kept, because they are probably identity", () => {
  it("keeps a board's own embedded job id on a company's own site", () => {
    // A company career page embedding a board uses ?gh_jid=<id>. Nothing here
    // has to know that: preserve-by-default covers the whole class.
    const a = "https://acme.com/careers?gh_jid=1234567";
    const b = "https://acme.com/careers?gh_jid=7654321";
    expect(isSameJobUrl(a, b)).toBe(false);
    expect(isSameJobUrl(a, `${a}&utm_source=x`)).toBe(true);
  });

  it("keeps an arbitrary id-looking parameter", () => {
    expect(isSameJobUrl("https://x.example/j?posting=1", "https://x.example/j?posting=2")).toBe(
      false,
    );
  });
});

describe("job identity across a posting's two shapes", () => {
  it("recognises the path form and the embed form as one job", () => {
    expect(
      isSameJobUrl("https://boards.greenhouse.io/acme/jobs/1234567", embed("acme", "1234567")),
    ).toBe(true);
  });

  it("does the same for a company-subdomain board", () => {
    expect(isSameJobUrl("https://acme.greenhouse.io/jobs/1234567", embed("acme", "1234567"))).toBe(
      true,
    );
  });

  it("is case-insensitive about the board name", () => {
    expect(isSameJobUrl(embed("Acme", "1234567"), embed("acme", "1234567"))).toBe(true);
  });

  it("reads nothing out of a link it does not recognise", () => {
    expect(jobIdentity("https://careers.example.com/apply?jobId=42")).toBeNull();
    expect(jobIdentity("not a url")).toBeNull();
  });
});

describe("links we cannot parse", () => {
  it("compare exactly, and never throw", () => {
    expect(isSameJobUrl("not a url", "not a url")).toBe(true);
    expect(isSameJobUrl("not a url", "also not a url")).toBe(false);
    expect(normalizeJobUrl("not a url")).toBe("not a url");
  });

  it("ignore a trailing slash, a hash, and host casing", () => {
    expect(
      isSameJobUrl("https://Boards.Greenhouse.io/acme/jobs/1234567/", embed("acme", "1234567")),
    ).toBe(true);
    expect(
      isSameJobUrl("https://careers.example.com/apply/#top", "https://careers.example.com/apply"),
    ).toBe(true);
  });
});

describe("the board's other embed shape", () => {
  /** Verified against the extension's own jobIdFromUrl, which already reads
   *  both: `token` on the application form, `gh_jid` on the board embed. */
  it("reads identity out of a board embed too", () => {
    expect(
      jobIdentity("https://boards.greenhouse.io/embed/job_board?for=acme&gh_jid=1234567"),
    ).toEqual({ vendor: "greenhouse", board: "acme", jobId: "1234567" });
  });

  it("matches it to the same posting's path form", () => {
    expect(
      isSameJobUrl(
        "https://boards.greenhouse.io/embed/job_board?for=acme&gh_jid=1234567",
        "https://boards.greenhouse.io/acme/jobs/1234567",
      ),
    ).toBe(true);
  });

  it("keeps two board-embed jobs apart", () => {
    expect(
      isSameJobUrl(
        "https://boards.greenhouse.io/embed/job_board?for=acme&gh_jid=1234567",
        "https://boards.greenhouse.io/embed/job_board?for=acme&gh_jid=7654321",
      ),
    ).toBe(false);
  });

  it("reads no board identity off a company's own site, and still tells the jobs apart", () => {
    // Without the board name we cannot claim an identity — but gh_jid survives
    // normalisation, so the two postings still compare as different.
    expect(jobIdentity("https://acme.com/careers?gh_jid=1234567")).toBeNull();
    expect(
      isSameJobUrl(
        "https://acme.com/careers?gh_jid=1234567",
        "https://acme.com/careers?gh_jid=7654321",
      ),
    ).toBe(false);
  });
});
