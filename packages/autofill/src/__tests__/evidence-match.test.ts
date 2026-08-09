import { describe, expect, it } from "vitest";
import {
  selectEvidence,
  formatEvidence,
  matchSelfAssessment,
  type EvidenceItem,
  type SelfAssessmentItem,
} from "../evidence-match";

const ev = (over: Partial<EvidenceItem> & { id: string; title: string }): EvidenceItem => ({
  url: "",
  summary: "",
  stack: [],
  outcome: "",
  ...over,
});

const LIBRARY: EvidenceItem[] = [
  ev({
    id: "rag",
    title: "Doc search over internal wikis",
    url: "https://github.com/example/rag",
    summary: "Retrieval pipeline with evaluation harness",
    stack: ["Python", "RAG", "Postgres"],
    outcome: "Cut answer latency from 4s to 900ms",
  }),
  ev({
    id: "css",
    title: "Design system",
    stack: ["TypeScript", "CSS"],
    summary: "Component library for the marketing site",
  }),
  ev({
    id: "sched",
    title: "Batch scheduler",
    stack: ["Go", "Kubernetes"],
    summary: "Job runner for nightly reports",
  }),
];

describe("selectEvidence", () => {
  const JD =
    "We need an AI engineer to build RAG systems in Python. Postgres experience is a plus. You will own evaluation.";

  it("puts the work whose stack matches the job first", () => {
    expect(selectEvidence(LIBRARY, JD).map((e) => e.id)).toEqual(["rag"]);
  });

  it("drops work that matches nothing rather than padding the answer", () => {
    // A design system says nothing about a RAG role; listing it weakens the
    // answer, so it is left out instead of filling the quota.
    expect(selectEvidence(LIBRARY, JD).some((e) => e.id === "css")).toBe(false);
  });

  it("honours the 1-3 limit these questions ask for", () => {
    const jd = "Python TypeScript CSS Go Kubernetes RAG Postgres";
    expect(selectEvidence(LIBRARY, jd, 2)).toHaveLength(2);
  });

  it("returns nothing when the job text is empty (never guesses)", () => {
    expect(selectEvidence(LIBRARY, "")).toEqual([]);
  });
});

describe("formatEvidence", () => {
  it("renders link plus what you built and what came of it", () => {
    const text = formatEvidence(selectEvidence(LIBRARY, "RAG Python"));
    expect(text).toContain("https://github.com/example/rag");
    expect(text).toContain("Retrieval pipeline with evaluation harness");
    expect(text).toContain("Cut answer latency from 4s to 900ms");
  });
});

describe("matchSelfAssessment", () => {
  const LEDGER: SelfAssessmentItem[] = [
    { id: "1", topic: "Python", level: "High", note: "" },
    { id: "2", topic: "Python for data analysis", level: "Medium", note: "" },
    { id: "3", topic: "system design", level: "Medium", note: "" },
  ];

  it("answers a rating question from the committed level", () => {
    expect(
      matchSelfAssessment("How would you rate your proficiency with Python?", LEDGER)?.level,
    ).toBe("High");
  });

  it("prefers the most specific committed topic", () => {
    // Both "Python" and "Python for data analysis" appear in this question;
    // the narrower commitment is the honest answer.
    expect(
      matchSelfAssessment(
        "When using Python for data analysis, rate your proficiency.",
        LEDGER,
      )?.level,
    ).toBe("Medium");
  });

  it("is case- and punctuation-insensitive", () => {
    expect(matchSelfAssessment("Rate your SYSTEM DESIGN skills:", LEDGER)?.id).toBe("3");
  });

  it("returns null for a topic never committed to — no invented rating", () => {
    expect(matchSelfAssessment("How strong is your Rust?", LEDGER)).toBeNull();
  });
});
