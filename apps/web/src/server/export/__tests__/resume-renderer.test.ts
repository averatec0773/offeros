import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ResumeHeader, StructuredResume } from "@offeros/core";
import { buildResumeHtml, renderResume } from "../resume-renderer";
import type { RenderInput } from "../renderers";

/** True only when the Chromium browser is actually installed — CI runners have
 *  the playwright package but no browser download, so the real-render smoke is
 *  skipped there rather than failing red. */
async function chromiumInstalled(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright");
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}
const HAS_CHROMIUM = await chromiumInstalled();

const HEADER: ResumeHeader = {
  name: "Jordan Rivera",
  email: "jordan@example.com",
  phone: "555-0101",
  location: "Austin, TX",
  links: ["linkedin.com/in/jordanrivera"],
};

const RESUME: StructuredResume = {
  summary: "Senior engineer with a decade of backend experience.",
  experience: [
    {
      company: "Acme Corp",
      title: "Staff Engineer",
      dates: "2020 - Present",
      bullets: ["Led migration to microservices.", "Mentored five engineers."],
    },
  ],
  education: [
    {
      school: "State University",
      degree: "B.S.",
      field: "Computer Science",
      dates: "2012 - 2016",
      details: "",
    },
  ],
  skills: ["TypeScript", "Node.js"],
};

const META: RenderInput["meta"] = { title: "Resume" };

describe("buildResumeHtml", () => {
  it("renders the header, and all non-empty sections with headings", () => {
    const html = buildResumeHtml({
      body: "",
      meta: META,
      resume: { data: RESUME, header: HEADER },
    });
    expect(html).toContain("Jordan Rivera");
    expect(html).toContain("jordan@example.com");
    expect(html).toContain("555-0101");
    expect(html).toContain("Austin, TX");
    expect(html).toContain("linkedin.com/in/jordanrivera");
    expect(html).toMatch(/summary/i);
    expect(html).toContain("Senior engineer with a decade of backend experience.");
    expect(html).toMatch(/experience/i);
    expect(html).toContain("Staff Engineer");
    expect(html).toContain("Acme Corp");
    expect(html).toContain("2020 - Present");
    expect(html).toContain("Led migration to microservices.");
    expect(html).toMatch(/education/i);
    expect(html).toContain("State University");
    expect(html).toMatch(/skills/i);
    expect(html).toContain("TypeScript");
  });

  it("skips empty sections (mirroring serializeResume)", () => {
    const empty: StructuredResume = { summary: "", experience: [], education: [], skills: [] };
    const html = buildResumeHtml({ body: "", meta: META, resume: { data: empty, header: HEADER } });
    expect(html).not.toMatch(/summary/i);
    expect(html).not.toMatch(/experience/i);
    expect(html).not.toMatch(/education/i);
    expect(html).not.toMatch(/skills/i);
    // Header still present.
    expect(html).toContain("Jordan Rivera");
  });

  it("escapes header, summary, bullet, and skill content", () => {
    const hostile: StructuredResume = {
      summary: '<script>alert("s")</script>',
      experience: [
        {
          company: "<b>Evil Co</b>",
          title: "<i>Hacker</i>",
          dates: "2020",
          bullets: ["<img src=x onerror=alert(1)>"],
        },
      ],
      education: [
        {
          school: "<img src=x onerror=alert(2)>",
          degree: "B.S.",
          field: "CS",
          dates: "2016",
          details: "",
        },
      ],
      skills: ["<script>bad</script>"],
    };
    const hostileHeader: ResumeHeader = {
      name: '<script>alert("name")</script>',
      email: "<img src=x onerror=alert(3)>",
      links: ["<script>alert(4)</script>"],
    };
    const html = buildResumeHtml({
      body: "",
      meta: META,
      resume: { data: hostile, header: hostileHeader },
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>Evil Co</b>");
    expect(html).not.toContain("<i>Hacker</i>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(2)&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(3)&gt;");
    expect(html).toContain("&lt;script&gt;alert(4)&lt;/script&gt;");
  });

  it("throws when input.resume is absent", () => {
    expect(() => buildResumeHtml({ body: "", meta: META })).toThrow();
  });

  it("skips an all-blank experience/education entry instead of rendering a bare row", () => {
    const withBlanks: StructuredResume = {
      summary: "",
      experience: [{ company: "", title: "", dates: "", bullets: [] }, ...RESUME.experience],
      education: [
        { school: "", degree: "", field: "", dates: "", details: "" },
        ...RESUME.education,
      ],
      skills: [],
    };
    const html = buildResumeHtml({
      body: "",
      meta: META,
      resume: { data: withBlanks, header: HEADER },
    });
    // The real entries still render, and the bare "title — company" placeholder
    // the blank entries would otherwise produce is absent.
    expect(html).toContain("Staff Engineer");
    expect(html).toContain("State University");
    expect(html.match(/class="entry"/g)).toHaveLength(2);
  });
});

describe.skipIf(!HAS_CHROMIUM)("renderResume (real chromium)", () => {
  it("renders a valid PDF from a structured résumé", async () => {
    const result = await renderResume({
      body: "",
      meta: META,
      resume: { data: RESUME, header: HEADER },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(result.pdf.byteLength).toBeGreaterThan(500);
    }
  }, 120_000);
});
