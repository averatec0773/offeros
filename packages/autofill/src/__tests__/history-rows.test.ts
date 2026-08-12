import { describe, it, expect } from "vitest";
import { buildFillPlan, explainFillPlan } from "../fill-plan";
import { matchHistoryField, totalExperienceYears, valueForRow } from "../history-rows";
import type { FieldDescriptor } from "../classify";
import type { FillProfile } from "../types";

/**
 * A form that asks for a history, not a fact.
 *
 * Most fields have one answer; a repeated section does not. On a real
 * application with three experience rows, every row received the profile's most
 * recent job — so the applicant's three employers came out as the same company
 * three times, and each row's "Summary" was handed to a model that wrote a
 * generic paragraph where a specific history belonged.
 */

const profile = (): FillProfile => ({
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0100",
    address: "1 Example Way",
    recentCompany: "Northwind Systems",
    recentTitle: "Senior Engineer",
    links: {},
  },
  skills: [],
  answerBank: [],
  education: [
    {
      school: "Birchwood College",
      degree: "BSc",
      field: "Computer Science",
      start: "2014",
      end: "2018",
    },
    {
      school: "Cedarcrest University",
      degree: "MSc",
      field: "Machine Learning",
      start: "2018",
      end: "2020",
    },
  ],
  experience: [
    {
      company: "Northwind Systems",
      title: "Senior Engineer",
      start: "2021-03",
      end: "Present",
      bullets: ["Led the ingestion rewrite.", "Cut nightly batch latency by 40%."],
    },
    {
      company: "Lakeside Analytics",
      title: "Engineer",
      start: "2018-06",
      end: "2021-02",
      bullets: ["Built the reporting service."],
    },
    {
      company: "Harbour Data",
      title: "Junior Engineer",
      start: "2016-01",
      end: "2018-05",
      bullets: ["Maintained the ETL jobs."],
    },
  ],
});

const field = (fieldId: string, label: string, type = "text"): FieldDescriptor => ({
  fieldId,
  label,
  name: "",
  autocomplete: "",
  type,
  placeholder: "",
  ariaLabel: "",
});

describe("reading what a row's field asks for", () => {
  it.each([
    ["School", "education", "school"],
    ["University Name", "education", "school"],
    ["Degree", "education", "degree"],
    ["Field of Study", "education", "fieldOfStudy"],
    ["Major", "education", "fieldOfStudy"],
    ["Company", "experience", "company"],
    ["Current Employer", "experience", "company"],
    ["Occupation / Title", "experience", "title"],
    ["Job Title", "experience", "title"],
    ["Designation", "experience", "title"],
    ["Summary", "experience", "summary"],
    ["Responsibilities", "experience", "summary"],
  ])("%o is the %s entry's %s", (label, kind, part) => {
    const m = matchHistoryField(label);
    expect(m?.kind).toBe(kind);
    expect(m?.field).toBe(part);
  });

  it("reads a bare date from the section it sits in", () => {
    // "Start Date" alone belongs to whichever history the row is in.
    expect(matchHistoryField("Start Date", "Educational Details")?.kind).toBe("education");
    expect(matchHistoryField("Start Date", "Work Experience")?.kind).toBe("experience");
    expect(matchHistoryField("Start Date")).toBeNull();
  });

  it("leaves ordinary fields alone", () => {
    for (const label of ["Email", "Phone", "LinkedIn"]) {
      expect(matchHistoryField(label), label).toBeNull();
    }
  });

  it("does not read a question as a column heading", () => {
    // A row's fields are named, not asked. Treating "Why do you want to work
    // at this company?" as an employer field would put the applicant's current
    // employer into an essay box.
    for (const label of [
      "Why this company?",
      "Why do you want to work at this company?",
      "Tell us about your most recent role and what you learned",
      "Describe your responsibilities in your own words in detail",
    ]) {
      expect(matchHistoryField(label), label).toBeNull();
    }
  });
});

describe("three rows get three different jobs", () => {
  const rows = [
    field("c1", "Company"),
    field("t1", "Occupation / Title"),
    field("s1", "Summary", "textarea"),
    field("c2", "Company"),
    field("t2", "Occupation / Title"),
    field("s2", "Summary", "textarea"),
    field("c3", "Company"),
    field("t3", "Occupation / Title"),
    field("s3", "Summary", "textarea"),
  ];

  it("assigns entries to rows in page order", () => {
    const plan = buildFillPlan(rows, profile());
    const by = new Map(plan.map((i) => [i.fieldId, i.value]));
    expect(by.get("c1")).toBe("Northwind Systems");
    expect(by.get("c2")).toBe("Lakeside Analytics");
    expect(by.get("c3")).toBe("Harbour Data");
    expect(by.get("t1")).toBe("Senior Engineer");
    expect(by.get("t3")).toBe("Junior Engineer");
  });

  it("fills each Summary with that job's own bullets, never a generated one", () => {
    // The real description is a lookup away; a model asked for one writes a
    // paragraph that could describe anybody.
    const plan = buildFillPlan(rows, profile());
    const by = new Map(plan.map((i) => [i.fieldId, i]));
    expect(by.get("s1")!.value).toContain("Led the ingestion rewrite.");
    expect(by.get("s1")!.value).toContain("Cut nightly batch latency by 40%.");
    expect(by.get("s2")!.value).toBe("Built the reporting service.");
    // Not offered to the model.
    expect(by.get("s1")!.generatable).toBeUndefined();
    expect(by.get("s1")!.source).toBe("personal");
  });

  it("says which row a value came from, so a wrong one is explainable", () => {
    const { trace } = explainFillPlan(rows, profile());
    const t = trace.find((x) => x.fieldId === "c2")!;
    expect(t.reason).toContain("row 2");
    expect(t.reason).toContain("experience");
  });

  it("is honest about a row the profile has no entry for", () => {
    const short = { ...profile(), experience: profile().experience.slice(0, 1) };
    const plan = buildFillPlan(rows, short);
    const by = new Map(plan.map((i) => [i.fieldId, i]));
    expect(by.get("c1")!.status).toBe("fillable");
    expect(by.get("c2")!.status).toBe("needs-answer");
    expect(by.get("c2")!.value).toBe("");
  });

  it("does the same for education rows", () => {
    const eduRows = [
      field("e1", "School"),
      field("d1", "Degree"),
      field("e2", "School"),
      field("d2", "Degree"),
    ];
    const by = new Map(buildFillPlan(eduRows, profile()).map((i) => [i.fieldId, i.value]));
    expect(by.get("e1")).toBe("Birchwood College");
    expect(by.get("e2")).toBe("Cedarcrest University");
    expect(by.get("d2")).toBe("MSc");
  });

  it("leaves the ordinary current-employer field to the ordinary classifier", () => {
    // A single "Current Employer" outside a repeated section is row 1 of the
    // experience list, which is the same answer the classifier gave — the point
    // is that it still gets one.
    const plan = buildFillPlan([field("one", "Current Employer")], profile());
    expect(plan[0]!.value).toBe("Northwind Systems");
  });
});

describe("how many years of experience", () => {
  const at = (iso: string) => new Date(iso);

  it("counts the whole working life, not one job", () => {
    // 2016-01 to 2026-01 is ten years of calendar, but the profile has two
    // one-month gaps between jobs and those are not experience. Nine is the
    // number that cannot be wrong in the applicant's favour.
    expect(totalExperienceYears(profile().experience, at("2026-01-15"))).toBe(9);
  });

  it("rounds down, because the number is a claim", () => {
    const one = [{ company: "A", title: "Eng", start: "2020-01", end: "2024-12", bullets: [] }];
    // Four years and eleven months is four.
    expect(totalExperienceYears(one, at("2025-01-01"))).toBe(4);
  });

  it("counts overlapping jobs once", () => {
    // Two roles held at the same time are not eight years of experience.
    const overlap = [
      { company: "A", title: "Eng", start: "2020-01", end: "2024-01", bullets: [] },
      { company: "B", title: "Advisor", start: "2021-01", end: "2023-01", bullets: [] },
    ];
    expect(totalExperienceYears(overlap, at("2024-06-01"))).toBe(4);
  });

  it("understands a job that has not ended", () => {
    const current = [{ company: "A", title: "Eng", start: "2022-01", end: "Present", bullets: [] }];
    expect(totalExperienceYears(current, at("2026-01-01"))).toBe(4);
  });

  it("says nothing rather than guessing when there is nothing to count", () => {
    expect(totalExperienceYears([])).toBeNull();
    expect(
      totalExperienceYears([{ company: "A", title: "T", start: "", end: "", bullets: [] }]),
    ).toBeNull();
  });
});

describe("valueForRow", () => {
  it("returns nothing for a row beyond the profile", () => {
    expect(valueForRow({ kind: "experience", field: "company" }, profile(), 9)).toBe("");
    expect(valueForRow({ kind: "education", field: "school" }, profile(), 9)).toBe("");
  });
});
