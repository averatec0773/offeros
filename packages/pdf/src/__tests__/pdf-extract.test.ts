import { describe, expect, it } from "vitest";
import { reconstructText, type PositionedItem } from "../pdf-extract";

// x/width default to a snug run (width ≈ 6px/char, placed at x). Same-line tests
// set x explicitly so the horizontal-gap spacing logic is exercised realistically.
const item = (str: string, y: number, opts: Partial<PositionedItem> = {}): PositionedItem => ({
  str,
  x: opts.x ?? 0,
  y,
  width: opts.width ?? str.length * 6,
  height: opts.height ?? 10,
  hasEOL: opts.hasEOL ?? false,
});

describe("reconstructText", () => {
  it("joins gap-separated runs on one baseline with a single space", () => {
    const out = reconstructText([
      item("Hello", 700, { x: 0, width: 30 }),
      item("world", 700, { x: 38, width: 30 }),
    ]);
    expect(out).toBe("Hello world");
  });

  it("concatenates touching glyph runs without a spurious space (ligature split)", () => {
    // pdf.js emits "Sofia" as "So" | "fi" | "a" at touching x positions
    const out = reconstructText([
      item("So", 700, { x: 0, width: 12 }),
      item("fi", 700, { x: 12, width: 6 }),
      item("a", 700, { x: 18, width: 6 }),
    ]);
    expect(out).toBe("Sofia");
  });

  it("does not split a URL across touching runs", () => {
    const out = reconstructText([
      item("linkedin.com/in/", 700, { x: 0, width: 90 }),
      item("so", 700, { x: 90, width: 12 }),
      item("fi", 700, { x: 102, width: 6 }),
      item("avandenberg", 700, { x: 108, width: 66 }),
    ]);
    expect(out).toBe("linkedin.com/in/sofiavandenberg");
  });

  it("breaks a line when hasEOL is set", () => {
    const out = reconstructText([
      item("Michael Torres", 700, { hasEOL: true }),
      item("michael@x.com", 686, { hasEOL: true }),
    ]);
    expect(out).toBe("Michael Torres\nmichael@x.com");
  });

  it("breaks a line on a clear downward baseline drop even without hasEOL", () => {
    const out = reconstructText([
      item("Michael Torres", 700),
      item("michael@x.com", 686),
      item("San Francisco, CA", 672),
    ]);
    expect(out).toBe("Michael Torres\nmichael@x.com\nSan Francisco, CA");
  });

  it("does not break on tiny baseline jitter within a line", () => {
    const out = reconstructText([
      item("E", 700, { x: 0, width: 6 }),
      item("=", 700, { x: 10, width: 6 }),
      item("mc", 702, { x: 20, width: 12 }),
      item("2", 704, { x: 40, width: 6 }),
    ]);
    expect(out).toBe("E = mc 2");
  });

  it("collapses runs of whitespace and drops blank lines", () => {
    const out = reconstructText([
      item("a", 700, { hasEOL: true }),
      item("   ", 690, { hasEOL: true }),
      item("b", 680, { hasEOL: true }),
    ]);
    expect(out).toBe("a\nb");
  });

  it("returns empty string for no items", () => {
    expect(reconstructText([])).toBe("");
  });

  it("keeps section headers and entries on separate lines", () => {
    const out = reconstructText([
      item("EXPERIENCE", 600, { hasEOL: true }),
      item("Acme Corp", 586, { hasEOL: true }),
      item("Senior Engineer", 572, { hasEOL: true }),
    ]);
    expect(out).toBe("EXPERIENCE\nAcme Corp\nSenior Engineer");
  });
});
