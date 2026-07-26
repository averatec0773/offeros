// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SubmitGateCard } from "../submit-gate-card";

afterEach(cleanup);

describe("SubmitGateCard", () => {
  it("renders the ready-to-submit copy and fires onMarkSubmitted", () => {
    const onMarkSubmitted = vi.fn();
    render(<SubmitGateCard onMarkSubmitted={onMarkSubmitted} />);

    expect(screen.getByText(/Ready to submit/i)).toBeTruthy();

    fireEvent.click(screen.getByText(/Mark as submitted/i));
    expect(onMarkSubmitted).toHaveBeenCalledTimes(1);
  });
});
