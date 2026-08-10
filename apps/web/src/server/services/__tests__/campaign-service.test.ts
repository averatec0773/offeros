import { describe, it, expect } from "vitest";
import type { AgentTask, Application } from "@offeros/core";
import { campaignProgress, describeProgress } from "../campaign-service";

const app = (over: Partial<Application>): Application => ({
  id: over.id ?? "a1",
  jobInfo: { jobId: "j", jobTitle: "Engineer", companyName: "Acme" },
  status: "saved",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const actionRequiredTask = (applicationId: string): AgentTask => ({
  id: `t-${applicationId}`,
  applicationId,
  status: "awaiting_user",
  step: 3,
  applicationInfo: { status: 2, filledFields: [], missingFields: ["Email"] },
  coverLetterRequirement: "unknown",
  skippedCoverLetter: false,
  fieldReports: [],
  fillFirst: false,
  createdAt: 1,
  updatedAt: 1,
});

describe("campaignProgress", () => {
  it("counts only members, and buckets them by what happened", () => {
    const applications = [
      app({ id: "in", campaignId: "c1", status: "saved" }),
      app({ id: "done", campaignId: "c1", status: "applied" }),
      app({ id: "needs", campaignId: "c1", status: "applying" }),
      app({ id: "other-campaign", campaignId: "c2", status: "saved" }),
      app({ id: "no-campaign", status: "saved" }),
    ];
    const tasks = new Map([["needs", actionRequiredTask("needs")]]);

    const progress = campaignProgress("c1", applications, tasks);
    expect(progress).toEqual({ members: 3, inProgress: 2, needsYou: 1, submitted: 1 });
  });

  it("describes an empty campaign as empty, not as 0/0 submitted", () => {
    expect(describeProgress({ members: 0, inProgress: 0, needsYou: 0, submitted: 0 })).toMatch(
      /empty/i,
    );
    expect(describeProgress({ members: 3, inProgress: 1, needsYou: 2, submitted: 1 })).toBe(
      "1/3 submitted · 2 need you",
    );
  });
});
