import { describe, expect, it } from "vitest";
import { companyFromUrl, jobIdFromUrl, matchAts, RECIPES } from "../src/lib/autofill/recipes";

describe("matchAts", () => {
  it("matches greenhouse boards and job-boards hosts", () => {
    expect(matchAts("https://boards.greenhouse.io/acme/jobs/123")?.atsId).toBe("greenhouse");
    expect(matchAts("https://job-boards.greenhouse.io/acme/jobs/123")?.atsId).toBe("greenhouse");
    expect(matchAts("https://acme.greenhouse.io/jobs/123")?.atsId).toBe("greenhouse");
  });

  it("returns null for a non-greenhouse url", () => {
    expect(matchAts("https://jobs.workday.com/acme/abc")).toBeNull();
    expect(matchAts("https://example.com")).toBeNull();
  });

  it("the greenhouse recipe carries form and field selectors", () => {
    const r = RECIPES.find((x) => x.atsId === "greenhouse")!;
    expect(r.formSelector.length).toBeGreaterThan(0);
    expect(r.fieldSelector.length).toBeGreaterThan(0);
  });
});

describe("matchAts lever/ashby", () => {
  it("matches lever hosts", () => {
    expect(matchAts("https://jobs.lever.co/acme/1234/apply")?.atsId).toBe("lever");
    expect(matchAts("https://jobs.eu.lever.co/acme/1234")?.atsId).toBe("lever");
  });

  it("matches ashby hosts", () => {
    expect(matchAts("https://jobs.ashbyhq.com/acme/uuid/application")?.atsId).toBe("ashby");
    expect(matchAts("https://acme.ashbyhq.com/jobs/1")?.atsId).toBe("ashby");
  });

  it("rejects host spoofs and bare apex domains", () => {
    expect(matchAts("https://jobs.lever.co.evil.com/acme")).toBeNull();
    expect(matchAts("https://jobs.ashbyhq.com.evil.com/acme")).toBeNull();
    expect(matchAts("https://lever.co/acme")).toBeNull();
  });

  it("lever and ashby recipes carry selectors", () => {
    for (const id of ["lever", "ashby"] as const) {
      const r = RECIPES.find((x) => x.atsId === id)!;
      expect(r.formSelector.length).toBeGreaterThan(0);
      expect(r.fieldSelector.length).toBeGreaterThan(0);
    }
  });
});

describe("matchAts icims", () => {
  it("matches careers-* icims.com portals", () => {
    expect(matchAts("https://careers-cotiviti.icims.com/jobs/18929/x")?.atsId).toBe("icims");
  });

  it("does not match the login subdomain", () => {
    expect(matchAts("https://login.icims.com/jobs/18929/x")).toBeNull();
  });

  it("the icims recipe carries form and field selectors", () => {
    const r = RECIPES.find((x) => x.atsId === "icims")!;
    expect(r.formSelector.length).toBeGreaterThan(0);
    expect(r.fieldSelector.length).toBeGreaterThan(0);
  });
});

describe("companyFromUrl", () => {
  it("takes the first path segment on shared job-board hosts", () => {
    expect(companyFromUrl("https://boards.greenhouse.io/acme/jobs/1")).toBe("acme");
    expect(companyFromUrl("https://jobs.lever.co/acme/1234")).toBe("acme");
    expect(companyFromUrl("https://jobs.ashbyhq.com/acme/uuid")).toBe("acme");
  });

  it("takes the first host label on dedicated subdomains", () => {
    expect(companyFromUrl("https://acme.greenhouse.io/jobs/1")).toBe("acme");
    expect(companyFromUrl("https://acme.ashbyhq.com/x")).toBe("acme");
  });

  it("strips a leading careers- prefix on icims hosts", () => {
    expect(companyFromUrl("https://careers-cotiviti.icims.com/jobs/18929/x")).toBe("cotiviti");
  });

  it("returns empty string on garbage input", () => {
    expect(companyFromUrl("not a url")).toBe("");
  });
});

describe("jobIdFromUrl", () => {
  it("extracts the greenhouse numeric job id", () => {
    expect(jobIdFromUrl("https://boards.greenhouse.io/acme/jobs/5630445")).toBe("5630445");
    expect(jobIdFromUrl("https://job-boards.greenhouse.io/acme/jobs/123?x=1")).toBe("123");
    expect(jobIdFromUrl("https://acme.greenhouse.io/jobs/999")).toBe("999");
  });

  it("extracts the lever/ashby path uuid", () => {
    expect(jobIdFromUrl("https://jobs.lever.co/acme/398186bb-457d-453f-a747-57c72217e12e/apply"))
      .toBe("398186bb-457d-453f-a747-57c72217e12e");
    expect(jobIdFromUrl("https://jobs.ashbyhq.com/acme/cc0af88a-2a19-493d-93cf-c5090f986f1f/application"))
      .toBe("cc0af88a-2a19-493d-93cf-c5090f986f1f");
  });

  it("extracts the icims job id after the jobs segment", () => {
    expect(jobIdFromUrl("https://careers-cotiviti.icims.com/jobs/18929/x")).toBe("18929");
  });

  it("returns empty string when there is no id or the url is garbage", () => {
    expect(jobIdFromUrl("https://boards.greenhouse.io/acme")).toBe("");
    expect(jobIdFromUrl("not a url")).toBe("");
  });
});
