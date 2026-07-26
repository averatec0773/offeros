import { describe, expect, it } from "vitest";
import { splitName, normalizeLink } from "../format";

describe("splitName", () => {
  it("splits a plain two-token name", () => {
    expect(splitName("Michael Torres")).toEqual({ first: "Michael", last: "Torres" });
  });

  it("drops a written-out middle name", () => {
    expect(splitName("Sarah Jane Chen")).toEqual({ first: "Sarah", last: "Chen" });
  });

  it("drops a middle initial", () => {
    expect(splitName("James R. Patterson")).toEqual({ first: "James", last: "Patterson" });
  });

  it("reorders a 'Last, First' header", () => {
    expect(splitName("Nguyen, Linh")).toEqual({ first: "Linh", last: "Nguyen" });
  });

  it("reorders 'Last, First Middle' and keeps only the first given token", () => {
    expect(splitName("Patterson, James R.")).toEqual({ first: "James", last: "Patterson" });
  });

  it("treats a comma-introduced credential as a suffix, not a surname swap", () => {
    expect(splitName("Jane Doe, PhD")).toEqual({ first: "Jane", last: "Doe" });
    expect(splitName("John Smith, Jr.")).toEqual({ first: "John", last: "Smith" });
    expect(splitName("Maria Garcia, MBA")).toEqual({ first: "Maria", last: "Garcia" });
  });

  it("handles 'Last, First, Middle/Suffix' without keeping a trailing comma", () => {
    expect(splitName("Garcia, Maria, Elena")).toEqual({ first: "Maria", last: "Garcia" });
    expect(splitName("Doe, John, Jr.")).toEqual({ first: "John", last: "Doe" });
  });

  it("keeps a Dutch particle surname whole", () => {
    expect(splitName("Sofia van der Berg")).toEqual({ first: "Sofia", last: "van der Berg" });
  });

  it("keeps a two-token particle surname whole", () => {
    expect(splitName("Ludwig van Beethoven")).toEqual({ first: "Ludwig", last: "van Beethoven" });
  });

  it("keeps a hyphenated surname whole", () => {
    expect(splitName("Raj Gupta-Sharma")).toEqual({ first: "Raj", last: "Gupta-Sharma" });
  });

  it("keeps a hyphenated given name whole", () => {
    expect(splitName("Anne-Marie Dubois")).toEqual({ first: "Anne-Marie", last: "Dubois" });
  });

  it("strips a generational suffix from the surname", () => {
    expect(splitName("Robert King Jr.")).toEqual({ first: "Robert", last: "King" });
    expect(splitName("Robert King III")).toEqual({ first: "Robert", last: "King" });
  });

  it("treats a mononym as a first name with no surname", () => {
    expect(splitName("Teagan")).toEqual({ first: "Teagan", last: "" });
  });

  it("preserves accented characters", () => {
    expect(splitName("Diego Fernández")).toEqual({ first: "Diego", last: "Fernández" });
  });

  it("is empty for an empty string", () => {
    expect(splitName("")).toEqual({ first: "", last: "" });
    expect(splitName("   ")).toEqual({ first: "", last: "" });
  });

  it("collapses irregular whitespace", () => {
    expect(splitName("  Michael   Torres  ")).toEqual({ first: "Michael", last: "Torres" });
  });
});

describe("normalizeLink", () => {
  it("adds a scheme to a bare domain link", () => {
    expect(normalizeLink("linkedin.com/in/weizhang")).toBe("https://linkedin.com/in/weizhang");
    expect(normalizeLink("github.com/wzhang")).toBe("https://github.com/wzhang");
    expect(normalizeLink("wei-zhang.dev")).toBe("https://wei-zhang.dev");
  });

  it("leaves an already-qualified URL unchanged", () => {
    expect(normalizeLink("https://www.linkedin.com/in/x")).toBe("https://www.linkedin.com/in/x");
    expect(normalizeLink("http://example.com")).toBe("http://example.com");
  });

  it("is case-insensitive about the existing scheme", () => {
    expect(normalizeLink("HTTPS://example.com")).toBe("HTTPS://example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeLink("  github.com/x  ")).toBe("https://github.com/x");
  });

  it("returns empty for empty input", () => {
    expect(normalizeLink("")).toBe("");
    expect(normalizeLink("   ")).toBe("");
  });
});
