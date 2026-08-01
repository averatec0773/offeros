import { describe, it, expect } from "vitest";
import type { Profile, ResumeSummary } from "@offeros/core";
import { buildGroundingFacts, buildProfileFacts, resolveResumeText } from "../steps/grounding";

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

function resume(overrides: Partial<ResumeSummary>): ResumeSummary {
  return {
    id: "r1",
    name: "resume.pdf",
    mimeType: "application/pdf",
    isPrimary: false,
    hasFile: false,
    createdAt: 1,
    ...overrides,
  };
}

describe("resolveResumeText", () => {
  it("uses the application's selected résumé's text", () => {
    const resumes = [
      resume({ id: "r1", isPrimary: true, text: "Primary résumé body." }),
      resume({ id: "r2", text: "Selected résumé body." }),
    ];
    const text = resolveResumeText({ resumeId: "r2" }, resumes, profile);
    expect(text).toBe("Selected résumé body.");
  });

  it("falls back to the primary résumé when the selection doesn't exist", () => {
    const resumes = [resume({ id: "r1", isPrimary: true, text: "Primary résumé body." })];
    const text = resolveResumeText({ resumeId: "gone" }, resumes, profile);
    expect(text).toBe("Primary résumé body.");
  });

  it("falls back to profile facts when there is no résumé at all", () => {
    const text = resolveResumeText({ resumeId: undefined }, [], profile);
    expect(text).toBe(buildProfileFacts(profile));
  });

  it("falls back to profile facts when the resolved résumé's text is empty/whitespace", () => {
    const resumes = [resume({ id: "r1", isPrimary: true, text: "   " })];
    const text = resolveResumeText({ resumeId: undefined }, resumes, profile);
    expect(text).toBe(buildProfileFacts(profile));
  });
});
