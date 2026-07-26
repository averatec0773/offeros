import { describe, it, expect } from "vitest";
import type { Profile } from "@offeros/core";
import { buildGroundingFacts, buildProfileFacts } from "../steps/grounding";

const profile: Profile = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0100",
    city: "Austin",
    state: "TX",
    links: { linkedin: "https://linkedin.com/in/jordan" },
  },
  skills: ["TypeScript", "React"],
  education: [
    {
      id: "e1",
      school: "UT Austin",
      degree: "BS",
      field: "Computer Science",
      start: "2016",
      end: "2020",
    },
  ],
  experience: [
    {
      id: "x1",
      company: "Acme",
      title: "Senior Engineer",
      start: "2021",
      end: "Present",
      bullets: ["Led the widget pipeline rollout", "Cut latency 40%"],
    },
  ],
};

describe("buildProfileFacts", () => {
  it("includes contact info, experience bullets, skills, and education", () => {
    const facts = buildProfileFacts(profile);
    expect(facts).toContain("Jordan Rivera");
    expect(facts).toContain("jordan@example.com");
    expect(facts).toContain("Austin, TX");
    expect(facts).toContain("Senior Engineer at Acme");
    expect(facts).toContain("Led the widget pipeline rollout");
    expect(facts).toContain("TypeScript, React");
    expect(facts).toContain("BS in Computer Science, UT Austin");
  });

  it("omits empty sections gracefully", () => {
    const minimal: Profile = {
      personal: { name: "Sam", email: "sam@example.com", phone: "", links: {} },
      skills: [],
      education: [],
      experience: [],
    };
    const facts = buildProfileFacts(minimal);
    expect(facts).toContain("Sam");
    expect(facts).not.toContain("Skills:");
    expect(facts).not.toContain("Experience:");
    expect(facts).not.toContain("Education:");
  });
});

describe("buildGroundingFacts", () => {
  it("appends the résumé text after the profile facts", () => {
    const facts = buildGroundingFacts(profile, "Tailored résumé body text.");
    expect(facts).toContain("Jordan Rivera");
    expect(facts).toContain("Résumé text:");
    expect(facts).toContain("Tailored résumé body text.");
  });

  it("omits the résumé section when resumeText is blank", () => {
    const facts = buildGroundingFacts(profile, "   ");
    expect(facts).not.toContain("Résumé text:");
  });
});
