// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ActionRequiredCard } from "../action-required-card";
import type { ApplicationInfo } from "@offeros/core";

afterEach(cleanup);

const applicationInfo: ApplicationInfo = {
  status: 2,
  filledFields: ["Full name"],
  missingFields: ["LinkedIn Profile"],
  totalFields: ["Full name", "LinkedIn Profile"],
};

describe("ActionRequiredCard", () => {
  it("fires onReFill, onFixed and onApplied from their respective buttons", () => {
    const onReFill = vi.fn();
    const onFixed = vi.fn();
    const onApplied = vi.fn();

    render(
      <ActionRequiredCard
        applicationInfo={applicationInfo}
        onReFill={onReFill}
        onFixed={onFixed}
        onApplied={onApplied}
      />,
    );

    fireEvent.click(screen.getByText(/Re-fill/i));
    fireEvent.click(screen.getByText(/Fixed/i));
    fireEvent.click(screen.getByText(/I've Applied/i));

    expect(onReFill).toHaveBeenCalledTimes(1);
    expect(onFixed).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });
});
