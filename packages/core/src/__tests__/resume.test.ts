import { describe, it, expect } from "vitest";
import {
  structuredResumeSchema,
  serializeResume,
  buildResumeHeader,
  type ResumeHeader,
} from "../resume";
import type { Profile } from "../profile";

function validResume() {
  return {
    summary: "Backend engineer focused on distributed systems.",
    experience: [
      {
        company: "Evolver",
        title: "Senior Engineer",
        dates: "2021 - Present",
        bullets: ["Led migration to Kubernetes", "Cut latency by 40%"],
      },
    ],
    education: [
      {
        school: "State University",
        degree: "B.S.",
        field: "Computer Science",
        dates: "2013 - 2017",
        details: "Graduated with honors",
      },
    ],
    skills: ["TypeScript", "Go", "Kubernetes"],
  };
}

describe("structuredResumeSchema", () => {
  it("round-trips a fully-populated valid resume", () => {
    const parsed = structuredResumeSchema.parse(validResume());
    expect(parsed).toEqual(validResume());
  });

  it("defaults missing top-level fields", () => {
    const parsed = structuredResumeSchema.parse({});
    expect(parsed).toEqual({
      summary: "",
      experience: [],
      education: [],
      skills: [],
    });
  });

  it("degrades gracefully: garbage nested fields fall back, record still parses", () => {
    const garbage = {
      summary: 12345, // wrong type
      experience: [
        {
          company: 999, // wrong type, has own .catch
          title: "Senior Engineer",
          dates: "2021 - Present",
          bullets: "not an array", // wrong type, has own .catch
        },
      ],
      education: "not an array", // wrong type entirely -> whole array swallowed
      skills: ["Go", 123], // mixed valid/invalid items, no per-item catch -> whole array swallowed
    };

    const parsed = structuredResumeSchema.parse(garbage);
    expect(parsed.summary).toBe("");
    expect(parsed.experience).toEqual([
      { company: "", title: "Senior Engineer", dates: "2021 - Present", bullets: [] },
    ]);
    expect(parsed.education).toEqual([]);
    expect(parsed.skills).toEqual([]);
  });

  it("swallows the whole thing to defaults when the top-level input isn't an object at all", () => {
    const defaults = {
      summary: "",
      experience: [],
      education: [],
      skills: [],
    };

    expect(structuredResumeSchema.parse("just a string")).toEqual(defaults);
    expect(structuredResumeSchema.parse(42)).toEqual(defaults);
    expect(structuredResumeSchema.parse(null)).toEqual(defaults);
    expect(structuredResumeSchema.parse(undefined)).toEqual(defaults);
    expect(structuredResumeSchema.parse(["array", "not", "object"])).toEqual(defaults);
  });
});

describe("serializeResume", () => {
  const header: ResumeHeader = {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0100",
    location: "Remote",
    links: ["https://github.com/jrivera", "https://linkedin.com/in/jrivera"],
  };

  it("produces a deterministic plain-text form with header, sections, and bullets", () => {
    const text = serializeResume(validResume(), header);

    expect(text).toContain("Jordan Rivera");
    expect(text).toContain("jordan@example.com");
    expect(text).toContain("555-0100");
    expect(text).toContain("Remote");
    expect(text).toContain("https://github.com/jrivera");
    expect(text).toContain("https://linkedin.com/in/jrivera");

    expect(text).toContain("SUMMARY");
    expect(text).toContain("Backend engineer focused on distributed systems.");

    expect(text).toContain("EXPERIENCE");
    expect(text).toContain("Senior Engineer — Evolver (2021 - Present)");
    expect(text).toContain("- Led migration to Kubernetes");
    expect(text).toContain("- Cut latency by 40%");

    expect(text).toContain("EDUCATION");
    expect(text).toContain("B.S., Computer Science — State University (2013 - 2017)");
    expect(text).toContain("Graduated with honors");

    expect(text).toContain("SKILLS");
    expect(text).toContain("TypeScript, Go, Kubernetes");
  });

  it("is stable: same input twice produces an identical string", () => {
    const first = serializeResume(validResume(), header);
    const second = serializeResume(validResume(), header);
    expect(first).toBe(second);
  });

  it("skips empty sections cleanly", () => {
    const empty = structuredResumeSchema.parse({});
    const text = serializeResume(empty, { name: "Jordan Rivera" });

    expect(text).toContain("Jordan Rivera");
    expect(text).not.toContain("SUMMARY");
    expect(text).not.toContain("EXPERIENCE");
    expect(text).not.toContain("EDUCATION");
    expect(text).not.toContain("SKILLS");
  });

  it("omits optional header lines when absent", () => {
    const text = serializeResume(structuredResumeSchema.parse({}), { name: "Jordan Rivera" });
    expect(text.split("\n")[0]).toBe("Jordan Rivera");
    expect(text).not.toContain("undefined");
  });
});

describe("buildResumeHeader", () => {
  it("maps the profile's personal info to a header, joining location and filtering empty links", () => {
    const profile: Profile = {
      personal: {
        name: "Jordan Rivera",
        email: "jordan@example.com",
        phone: "555-0100",
        city: "Austin",
        state: "TX",
        country: "USA",
        links: { linkedin: "https://linkedin.com/in/jordan", github: "", portfolio: undefined },
      },
      skills: [],
      education: [],
      experience: [],
    };

    const header = buildResumeHeader(profile);

    expect(header).toEqual({
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "555-0100",
      location: "Austin, TX, USA",
      links: ["https://linkedin.com/in/jordan"],
    });
  });

  it("omits email/phone/location when blank, and links defaults to an empty array", () => {
    const profile: Profile = {
      personal: { name: "Sam", email: "", phone: "", links: {} },
      skills: [],
      education: [],
      experience: [],
    };

    const header = buildResumeHeader(profile);

    expect(header.name).toBe("Sam");
    expect(header.email).toBeUndefined();
    expect(header.phone).toBeUndefined();
    expect(header.location).toBeUndefined();
    expect(header.links).toEqual([]);
  });
});
