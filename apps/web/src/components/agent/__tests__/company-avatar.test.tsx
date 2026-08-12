// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CompanyAvatar, avatarStyle, initials } from "../company-avatar";

/**
 * The floor must never fail: offline, deterministic, and never empty. The
 * fetched logo is an upgrade on top of it, served locally — an <img> pointed
 * at an employer would tell them which jobs someone is looking at.
 */

afterEach(cleanup);

describe("initials", () => {
  it("takes up to two", () => {
    expect(initials("Acme")).toBe("A");
    expect(initials("Acme Corporation")).toBe("AC");
    expect(initials("Acme Corp Holdings Ltd")).toBe("AC");
  });

  it("copes with whatever a company name turns out to be", () => {
    expect(initials("  spaced   out  ")).toBe("SO");
    expect(initials("")).toBe("—");
    expect(initials("   ")).toBe("—");
    // Multi-byte first characters must not be sliced in half.
    expect(initials("字节 跳动")).toBe("字跳");
  });
});

describe("avatarStyle", () => {
  it("is the same colour for the same company, forever", () => {
    expect(avatarStyle("Acme")).toEqual(avatarStyle("Acme"));
    expect(avatarStyle("Acme")).toEqual(avatarStyle("  acme  "));
  });

  it("distinguishes different companies", () => {
    expect(avatarStyle("Acme").backgroundColor).not.toBe(avatarStyle("Globex").backgroundColor);
  });

  it("fixes saturation and lightness so contrast is by construction, not luck", () => {
    for (const name of ["Acme", "Globex", "Initech", "Umbrella", "Stark"]) {
      expect(avatarStyle(name).backgroundColor).toMatch(/^hsl\(\d+ 52% 42%\)$/);
      expect(avatarStyle(name).color).toBe("hsl(0 0% 100%)");
    }
  });
});

describe("CompanyAvatar", () => {
  it("renders letters when there is no logo", () => {
    render(<CompanyAvatar company="Acme Corp" />);
    expect(screen.getByText("AC")).toBeTruthy();
  });

  it("renders a logo from a LOCAL route when one is cached", () => {
    render(<CompanyAvatar company="Acme Corp" logoUrl="/api/v1/applications/app-1/logo" />);
    const img = document.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/api/v1/applications/app-1/logo");
    // Never an employer's host: that would leak the job search to them.
    expect(img.getAttribute("src")!.startsWith("/")).toBe(true);
  });

  it("falls back to letters, silently, when the logo will not load", () => {
    render(<CompanyAvatar company="Acme Corp" logoUrl="/api/v1/applications/app-1/logo" />);
    fireEvent.error(document.querySelector("img")!);
    expect(screen.getByText("AC")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
});
