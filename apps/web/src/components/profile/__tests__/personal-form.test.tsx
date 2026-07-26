// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Personal } from "@offeros/core";
import { PersonalForm } from "../personal-form";

afterEach(cleanup);

const base: Personal = { name: "Ada", email: "ada@x.io", phone: "555", links: {} };

describe("PersonalForm", () => {
  it("edits a top-level field and emits the merged personal object", () => {
    const onChange = vi.fn();
    render(<PersonalForm value={base} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada Lovelace" } });

    expect(onChange).toHaveBeenCalledWith({ ...base, name: "Ada Lovelace" });
  });

  it("edits a nested link without dropping the other personal fields", () => {
    const onChange = vi.fn();
    render(<PersonalForm value={base} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("LinkedIn"), {
      target: { value: "linkedin.com/in/ada" },
    });

    expect(onChange).toHaveBeenCalledWith({
      ...base,
      links: { linkedin: "linkedin.com/in/ada" },
    });
  });

  it("renders optional fields as empty (not undefined) so they stay editable", () => {
    render(<PersonalForm value={base} onChange={vi.fn()} />);
    expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("");
  });
});
