// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SkillsEditor } from "../skills-editor";

afterEach(cleanup);

describe("SkillsEditor", () => {
  it("adds a trimmed skill on Enter", () => {
    const onChange = vi.fn();
    render(<SkillsEditor value={["React"]} onChange={onChange} />);

    const input = screen.getByLabelText("Add a skill");
    fireEvent.change(input, { target: { value: "  TypeScript  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(["React", "TypeScript"]);
  });

  it("ignores duplicates", () => {
    const onChange = vi.fn();
    render(<SkillsEditor value={["React"]} onChange={onChange} />);

    const input = screen.getByLabelText("Add a skill");
    fireEvent.change(input, { target: { value: "React" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a skill via its × button", () => {
    const onChange = vi.fn();
    render(<SkillsEditor value={["React", "Vue"]} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Remove Vue"));

    expect(onChange).toHaveBeenCalledWith(["React"]);
  });

  it("removes the last chip on Backspace when the input is empty", () => {
    const onChange = vi.fn();
    render(<SkillsEditor value={["React", "Vue"]} onChange={onChange} />);

    fireEvent.keyDown(screen.getByLabelText("Add a skill"), { key: "Backspace" });

    expect(onChange).toHaveBeenCalledWith(["React"]);
  });
});
