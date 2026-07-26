import { describe, expect, it } from "vitest";
import { flattenOptions, matchOption } from "../option-match";

describe("matchOption", () => {
  const opts = [
    { label: "Yes", value: "y" },
    { label: "No", value: "n" },
    {
      options: [
        { label: "United States", value: "US" },
        { label: "Canada", value: "CA" },
      ],
    },
  ];

  it("flattens grouped options", () => {
    expect(flattenOptions(opts)).toHaveLength(4);
  });

  it("matches exactly (case/whitespace-insensitive) before substring", () => {
    expect(matchOption(opts, " yes ")).toMatchObject({ value: "y" });
    expect(matchOption(opts, "united states")).toMatchObject({ value: "US" });
  });

  it("falls back to substring containment", () => {
    expect(matchOption(opts, "united")).toMatchObject({ value: "US" });
  });

  it("returns null for empty or unmatched", () => {
    expect(matchOption(opts, "")).toBeNull();
    expect(matchOption(opts, "zz-nothing")).toBeNull();
  });

  it("matches an ellipsis-truncated option label to the full value (Workday clips)", () => {
    const clipped = [
      { label: "United States of Ameri…", value: "US" },
      { label: "United Kingdom", value: "UK" },
    ];
    expect(matchOption(clipped, "United States of America")).toMatchObject({ value: "US" });
  });

  it("matches a truncated multi-part EEO label", () => {
    const eeo = [{ label: "Yes, I am authorized to work in the …", value: "auth" }];
    expect(matchOption(eeo, "Yes, I am authorized to work in the United States")).toMatchObject({
      value: "auth",
    });
  });

  it("does not let a trivially short truncation match everything", () => {
    const bad = [{ label: "Y…", value: "y" }];
    expect(matchOption(bad, "No, I need sponsorship")).toBeNull();
  });

  it("is tolerant of punctuation/spacing differences on exact match", () => {
    const punct = [{ label: "E‑mail address", value: "email" }];
    expect(matchOption(punct, "E-mail address")).toMatchObject({ value: "email" });
  });
});
