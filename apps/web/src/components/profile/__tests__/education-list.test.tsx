// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Education } from "@offeros/core";
import { EducationList } from "../education-list";

afterEach(cleanup);

const entry: Education = {
  id: "e1",
  school: "MIT",
  degree: "BSc",
  field: "CS",
  gpa: "",
  start: "2018",
  end: "2022",
};

describe("EducationList", () => {
  it("adds a new entry with a generated id", () => {
    const onChange = vi.fn();
    render(<EducationList value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByText("Add education"));

    const next = onChange.mock.calls[0]![0] as Education[];
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBeTruthy();
    expect(next[0]!.school).toBe("");
  });

  it("edits a field of an existing entry by id", () => {
    const onChange = vi.fn();
    render(<EducationList value={[entry]} onChange={onChange} />);

    fireEvent.change(screen.getByDisplayValue("MIT"), { target: { value: "Stanford" } });

    expect(onChange).toHaveBeenCalledWith([{ ...entry, school: "Stanford" }]);
  });

  it("removes an entry", () => {
    const onChange = vi.fn();
    render(<EducationList value={[entry]} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Remove education"));

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
