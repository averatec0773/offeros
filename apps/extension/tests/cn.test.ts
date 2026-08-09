import { describe, expect, it } from "vitest";
import { cn } from "../src/lib/cn";

describe("cn", () => {
  it("merges tailwind conflicts, last wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
  it("drops falsy", () => {
    // The constant falsy operand is the input under test; a caller writes it
    // as a condition that happened to be false.
    // eslint-disable-next-line no-constant-binary-expression
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });
  it("keeps text color when a semantic size class follows (regression: blank Fill button)", () => {
    expect(cn("text-primary-foreground", "text-body font-semibold")).toBe(
      "text-primary-foreground text-body font-semibold",
    );
  });
  it("still resolves size-vs-size conflicts, last wins", () => {
    expect(cn("text-sm", "text-body")).toBe("text-body");
    expect(cn("text-caption", "text-micro")).toBe("text-micro");
  });
});
