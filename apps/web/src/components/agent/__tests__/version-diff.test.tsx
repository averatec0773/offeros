// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { VersionDiff } from "../version-diff";
import type { LineDiff } from "@/lib/diff";

afterEach(cleanup);

const diff: LineDiff = [
  { op: "eq", text: "Jordan Rivera — ML Engineer" },
  { op: "del", text: "Led the ML pipeline redesign" },
  { op: "add", text: "Led the ML pipeline redesign, cutting latency 40%" },
];

describe("VersionDiff", () => {
  it("marks add lines with the brand tint and del lines struck through", () => {
    render(<VersionDiff diff={diff} />);

    const eqLine = screen.getByText("Jordan Rivera — ML Engineer");
    expect(eqLine.closest("div")?.className).not.toContain("line-through");

    const delLine = screen.getByText("Led the ML pipeline redesign");
    expect(delLine.closest("div")?.className).toContain("line-through");

    const addLine = screen.getByText("Led the ML pipeline redesign, cutting latency 40%");
    expect(addLine.closest("div")?.className).toContain("bg-brand/15");
  });
});
