import { describe, it, expect } from "vitest";
import { diffLines } from "../diff";

describe("diffLines", () => {
  it("marks every line eq when the inputs are identical", () => {
    const text = "Line one.\nLine two.\nLine three.";
    const result = diffLines(text, text);
    expect(result).toEqual([
      { op: "eq", text: "Line one." },
      { op: "eq", text: "Line two." },
      { op: "eq", text: "Line three." },
    ]);
  });

  it("marks every line add when the old string is empty", () => {
    const result = diffLines("", "First.\nSecond.");
    expect(result).toEqual([
      { op: "add", text: "First." },
      { op: "add", text: "Second." },
    ]);
  });

  it("marks every line del when the new string is empty", () => {
    const result = diffLines("First.\nSecond.", "");
    expect(result).toEqual([
      { op: "del", text: "First." },
      { op: "del", text: "Second." },
    ]);
  });

  it("finds eq/del/add on a single-line edit within a paragraph", () => {
    const oldStr = "Opening line.\nA middle sentence to revise.\nClosing line.";
    const newStr = "Opening line.\nA rewritten middle sentence.\nClosing line.";
    const result = diffLines(oldStr, newStr);
    expect(result).toEqual([
      { op: "eq", text: "Opening line." },
      { op: "del", text: "A middle sentence to revise." },
      { op: "add", text: "A rewritten middle sentence." },
      { op: "eq", text: "Closing line." },
    ]);
  });

  it("handles an added line with no corresponding removal", () => {
    const oldStr = "Alpha.\nBeta.";
    const newStr = "Alpha.\nBeta.\nGamma.";
    const result = diffLines(oldStr, newStr);
    expect(result).toEqual([
      { op: "eq", text: "Alpha." },
      { op: "eq", text: "Beta." },
      { op: "add", text: "Gamma." },
    ]);
  });
});
