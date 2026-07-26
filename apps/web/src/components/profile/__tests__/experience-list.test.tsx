// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Experience } from "@offeros/core";
import { ExperienceList } from "../experience-list";

afterEach(cleanup);

const entry: Experience = {
  id: "x1",
  company: "Acme",
  title: "Engineer",
  start: "2020",
  end: "Present",
  bullets: ["Shipped things"],
};

describe("ExperienceList", () => {
  it("adds a new entry with a generated id and empty bullets", () => {
    const onChange = vi.fn();
    render(<ExperienceList value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByText("Add experience"));

    const next = onChange.mock.calls[0]![0] as Experience[];
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBeTruthy();
    expect(next[0]!.bullets).toEqual([]);
  });

  it("edits a top-level field of an entry", () => {
    const onChange = vi.fn();
    render(<ExperienceList value={[entry]} onChange={onChange} />);

    fireEvent.change(screen.getByDisplayValue("Acme"), { target: { value: "Globex" } });

    expect(onChange).toHaveBeenCalledWith([{ ...entry, company: "Globex" }]);
  });

  it("adds a bullet to an entry", () => {
    const onChange = vi.fn();
    render(<ExperienceList value={[entry]} onChange={onChange} />);

    fireEvent.click(screen.getByText("Add highlight"));

    expect(onChange).toHaveBeenCalledWith([{ ...entry, bullets: ["Shipped things", ""] }]);
  });

  it("removes a bullet by index", () => {
    const onChange = vi.fn();
    render(<ExperienceList value={[entry]} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Remove highlight"));

    expect(onChange).toHaveBeenCalledWith([{ ...entry, bullets: [] }]);
  });
});
