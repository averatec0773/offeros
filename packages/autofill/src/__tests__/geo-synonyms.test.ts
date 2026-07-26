import { describe, expect, it } from "vitest";
import { geoCandidates } from "../geo-synonyms";
import { matchOptionValue } from "../option-match";

describe("geoCandidates", () => {
  it("expands US country aliases to a shared candidate set", () => {
    const c = geoCandidates("US");
    expect(c).toContain("United States of America");
    expect(c).toContain("United States");
    expect(geoCandidates("usa")).toContain("United States of America");
  });

  it("expands US state abbreviations and names both ways", () => {
    expect(geoCandidates("OR")).toContain("Oregon");
    expect(geoCandidates("Oregon")).toContain("OR");
    expect(geoCandidates("california")).toContain("CA");
  });

  it("returns just the value for unknown terms", () => {
    expect(geoCandidates("Atlantis")).toEqual(["Atlantis"]);
  });
});

describe("matchOptionValue — geo candidate fallback", () => {
  const countries = [
    { label: "United States of America", value: "US" },
    { label: "Canada", value: "CA" },
  ];
  const states = [
    { label: "Oregon", value: "OR" },
    { label: "California", value: "CA" },
  ];

  it("matches an abbreviation to the full option label", () => {
    expect(matchOptionValue(countries, "US")).toMatchObject({ value: "US" });
    expect(matchOptionValue(states, "OR")).toMatchObject({ value: "OR" });
  });

  it("matches a full name to an abbreviated option", () => {
    const abbrevStates = [
      { label: "OR", value: "OR" },
      { label: "CA", value: "CA" },
    ];
    expect(matchOptionValue(abbrevStates, "Oregon")).toMatchObject({ value: "OR" });
  });

  it("still returns null for genuinely absent values", () => {
    expect(matchOptionValue(countries, "Atlantis")).toBeNull();
  });

  it("falls back to plain matchOption for non-geo values", () => {
    const opts = [{ label: "Yes", value: "y" }];
    expect(matchOptionValue(opts, "yes")).toMatchObject({ value: "y" });
  });
});
