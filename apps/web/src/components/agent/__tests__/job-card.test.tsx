// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { JobCard } from "../job-card";
import type { JobInfo } from "@offeros/core";

afterEach(cleanup);

describe("JobCard", () => {
  it("renders title, company, initials and optional chips", () => {
    const job: JobInfo = {
      jobId: "j1",
      jobTitle: "GenAI Engineer",
      companyName: "Evolver Labs",
      jobLocation: "Austin, TX",
      employmentType: "Full-time",
      workModel: "Remote",
      jobSeniority: "Senior",
      companyStage: "Series B",
      salaryDesc: "$150k–$180k",
      publishTimeDesc: "2 days ago",
    };
    render(<JobCard job={job} />);

    expect(screen.getByText("GenAI Engineer")).toBeTruthy();
    expect(screen.getByText(/Evolver Labs/)).toBeTruthy();
    expect(screen.getByText(/2 days ago/)).toBeTruthy();
    // Initials are derived from the first two words of the company name.
    expect(screen.getByText("EL")).toBeTruthy();

    for (const chip of ["Austin, TX", "Full-time", "Remote", "Senior", "Series B", "$150k–$180k"]) {
      expect(screen.getByText(chip)).toBeTruthy();
    }
  });

  it("omits chips and the publish time when the job doesn't have them", () => {
    const job: JobInfo = { jobId: "j2", jobTitle: "Backend Engineer", companyName: "Acme" };
    render(<JobCard job={job} />);

    expect(screen.getByText("Backend Engineer")).toBeTruthy();
    expect(screen.queryByText(/·/)).toBeNull();
    expect(screen.getByText("Acme").className).toContain("truncate");
  });

  it("shows a match score ring only when displayScore is set", () => {
    const withScore: JobInfo = {
      jobId: "j3",
      jobTitle: "ML Engineer",
      companyName: "Nimbus",
      displayScore: 74,
    };
    const { rerender } = render(<JobCard job={withScore} />);
    expect(screen.getByLabelText("Match score 74 percent")).toBeTruthy();

    const withoutScore: JobInfo = { jobId: "j4", jobTitle: "ML Engineer", companyName: "Nimbus" };
    rerender(<JobCard job={withoutScore} />);
    expect(screen.queryByLabelText(/Match score/)).toBeNull();
  });

  it("falls back to a single '?' when the company name has no usable letters", () => {
    const job: JobInfo = { jobId: "j5", jobTitle: "Role", companyName: "!!!" };
    render(<JobCard job={job} />);
    expect(screen.getByText("?")).toBeTruthy();
  });
});
