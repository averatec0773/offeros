import { describe, expect, it } from "vitest";
import { cn } from "../utils";

describe("cn", () => {
  it("merges tailwind conflicts, last wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
  it("keeps text color when a semantic size class follows (twMerge misread it as a color)", () => {
    expect(cn("text-muted-foreground", "text-caption")).toBe("text-muted-foreground text-caption");
    expect(cn("text-primary-foreground", "text-body font-semibold")).toBe(
      "text-primary-foreground text-body font-semibold",
    );
  });
  it("still resolves size-vs-size conflicts, last wins", () => {
    expect(cn("text-sm", "text-body")).toBe("text-body");
    expect(cn("text-caption", "text-micro")).toBe("text-micro");
  });
});
