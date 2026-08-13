import { describe, expect, it } from "vitest";
import { checkResume, RESUME_RULES, type ResumeCheckInput, type ResumeRule } from "../resume-check";

/**
 * Every rule, both ways round.
 *
 * A checklist is only worth having if a tick means something, so each rule is
 * tested on a résumé that should fail it and one that should pass — a rule that
 * can only ever pass is decoration, and one that fires on a good document
 * teaches people to ignore the whole list.
 *
 * All fixtures are invented.
 */

const bullets = (n: number, text = "Shipped the billing service to production") =>
  Array.from({ length: n }, (_, i) => `${text} ${i + 1}`);

const good = (): ResumeCheckInput => ({
  resume: {
    summary: "Backend engineer.",
    experience: [
      {
        company: "Northwind Systems",
        title: "Senior Engineer",
        dates: "2021 – 2024",
        bullets: bullets(4),
      },
      {
        company: "Acme Cloud",
        title: "Engineer",
        dates: "2019 – 2021",
        bullets: bullets(3),
      },
    ],
    education: [
      {
        school: "State University",
        degree: "BSc",
        field: "Computer Science",
        dates: "2015 – 2019",
        details: "",
      },
    ],
    skills: ["TypeScript", "Postgres"],
  },
  text: Array.from({ length: 400 }, () => "word").join(" "),
  header: { name: "Jordan Rivera", email: "jordan@example.com", phone: "555-0100" },
});

/** Run one rule by id and return its findings. */
const only = (id: string, input: ResumeCheckInput) =>
  checkResume(
    input,
    RESUME_RULES.filter((r) => r.id === id),
  );

const failed = (id: string, input: ResumeCheckInput) => only(id, input).filter((f) => !f.ok);

describe("length", () => {
  it("passes a résumé of ordinary length", () => {
    expect(failed("length", good())).toHaveLength(0);
  });

  it("flags one too short to say anything", () => {
    const input = { ...good(), text: "Jordan Rivera. Engineer." };
    expect(failed("length", input)[0]!.detail).toMatch(/words/i);
  });

  it("flags one nobody will read to the end of", () => {
    const input = { ...good(), text: Array.from({ length: 1200 }, () => "word").join(" ") };
    expect(failed("length", input)).toHaveLength(1);
  });

  it("says nothing at all about an empty document", () => {
    // Silence, not a pass: there is nothing here to have an opinion about.
    expect(only("length", { ...good(), text: "" })).toHaveLength(0);
  });
});

describe("sections", () => {
  it("passes when experience, education and skills are all there", () => {
    expect(failed("sections", good())).toHaveLength(0);
  });

  it("says nothing about a résumé it only has the text of", () => {
    // An uploaded PDF: real experience, none of it parsed. Claiming the
    // sections are missing would be a false accusation.
    const input: ResumeCheckInput = {
      resume: { summary: "", experience: [], education: [], skills: [] },
      text: Array.from({ length: 400 }, () => "word").join(" "),
    };
    expect(only("sections", input)).toHaveLength(0);
  });

  it("names what is missing", () => {
    const input = good();
    input.resume.skills = [];
    input.resume.education = [];
    const detail = failed("sections", input)[0]!.detail;
    expect(detail).toMatch(/education/);
    expect(detail).toMatch(/skills/);
  });
});

describe("bullets per role", () => {
  it("passes roles with a sensible number", () => {
    expect(failed("bullet-count", good())).toHaveLength(0);
  });

  it("flags a role that looks like a placeholder, and says which", () => {
    const input = good();
    input.resume.experience[0]!.bullets = [];
    const hit = failed("bullet-count", input)[0]!;
    expect(hit.where).toContain("Senior Engineer");
  });

  it("flags a role nobody reads to the end of", () => {
    const input = good();
    input.resume.experience[0]!.bullets = bullets(12);
    expect(failed("bullet-count", input)).toHaveLength(1);
  });
});

describe("bullet length", () => {
  it("passes ordinary bullets", () => {
    expect(failed("bullet-length", good())).toHaveLength(0);
  });

  it("flags a paragraph wearing a bullet's clothes", () => {
    const input = good();
    input.resume.experience[0]!.bullets = [Array.from({ length: 60 }, () => "word").join(" ")];
    expect(failed("bullet-length", input)).toHaveLength(1);
  });
});

describe("first person", () => {
  it("passes bullets written the conventional way", () => {
    expect(failed("first-person", good())).toHaveLength(0);
  });

  it("flags a bullet that starts with I or we", () => {
    const input = good();
    input.resume.experience[0]!.bullets = ["I rebuilt the billing service", "We shipped it"];
    expect(failed("first-person", input)[0]!.detail).toMatch(/2 bullets/);
  });

  it("leaves a bullet alone that merely contains those letters", () => {
    // "AI", "Interface", "Migrated" all contain an i; the rule looks at the
    // subject position, not at the alphabet.
    const input = good();
    input.resume.experience[0]!.bullets = [
      "Migrated the AI inference service to our own cluster",
      "Improved interface latency by half",
    ];
    expect(failed("first-person", input)).toHaveLength(0);
  });
});

describe("punctuation", () => {
  it("passes when every bullet ends the same way", () => {
    expect(failed("punctuation", good())).toHaveLength(0);
  });

  it("flags a mix, and says how many are in the minority", () => {
    const input = good();
    input.resume.experience[0]!.bullets = ["Shipped billing.", "Cut latency", "Wrote the runbook"];
    input.resume.experience[1]!.bullets = ["Ran the migration"];
    const hit = failed("punctuation", input)[0]!;
    expect(hit.detail).toMatch(/full stop/);
    expect(hit.where).toBe("1 to change");
  });

  it("says nothing when there are too few bullets to have a convention", () => {
    const input = good();
    input.resume.experience[0]!.bullets = ["Shipped billing."];
    input.resume.experience[1]!.bullets = [];
    expect(only("punctuation", input)).toHaveLength(0);
  });
});

describe("tense", () => {
  it("passes a finished role written in the past tense", () => {
    expect(failed("tense", good())).toHaveLength(0);
  });

  it("flags present tense in a role that has ended", () => {
    const input = good();
    input.resume.experience[0]!.bullets = ["Manage the billing service", "Shipped the runbook"];
    expect(failed("tense", input)[0]!.detail).toMatch(/present-tense/);
  });

  it("leaves the current role alone", () => {
    const input = good();
    input.resume.experience[0]!.dates = "2021 – Present";
    input.resume.experience[0]!.bullets = ["Manage the billing service"];
    input.resume.experience[1]!.bullets = ["Shipped it"];
    expect(failed("tense", input)).toHaveLength(0);
  });
});

describe("dates", () => {
  it("passes one format used throughout", () => {
    expect(failed("dates", good())).toHaveLength(0);
  });

  it("flags a document that mixes them", () => {
    const input = good();
    input.resume.experience[0]!.dates = "March 2021 – June 2024";
    input.resume.experience[1]!.dates = "03/2019 – 02/2021";
    expect(failed("dates", input)).toHaveLength(1);
  });
});

describe("contact details", () => {
  it("passes a header anyone could reply to", () => {
    expect(failed("contact", good())).toHaveLength(0);
  });

  it("names what is missing", () => {
    const input = { ...good(), header: { name: "Jordan Rivera", email: "", phone: "" } };
    expect(failed("contact", input)[0]!.detail).toMatch(/email/);
  });

  it("says nothing when there is no header to check", () => {
    const { header: _header, ...rest } = good();
    expect(only("contact", rest as ResumeCheckInput)).toHaveLength(0);
  });
});

describe("the registry", () => {
  it("runs a rule nobody has heard of, with no change to the engine", () => {
    // The property that makes this cheap to extend: the engine does not know
    // what a rule does, and no consumer knows which rules exist.
    const invented: ResumeRule = {
      id: "invented",
      title: "Invented",
      run: () => [
        { ruleId: "invented", ok: false, title: "Invented", detail: "Something to fix." },
      ],
    };
    const findings = checkResume(good(), [...RESUME_RULES, invented]);
    expect(findings.some((f) => f.ruleId === "invented")).toBe(true);
  });

  it("puts what needs doing above what does not", () => {
    const input = good();
    input.resume.skills = [];
    const findings = checkResume(input);
    expect(findings[0]!.ok).toBe(false);
  });

  it("gives every rule a distinct id, so a consumer can key on it", () => {
    const ids = RESUME_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
