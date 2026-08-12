// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  /**
   * happy-dom never fetches an image, so every <img> reports `complete: true`
   * with `naturalWidth: 0` — which in a real browser means "this one failed".
   * Left alone, every test here would look like a broken logo. So the state is
   * stated explicitly per test: pending by default, failed where that is the
   * point.
   */
  function stubImageLoad(complete: boolean, naturalWidth: number) {
    Object.defineProperty(HTMLImageElement.prototype, "complete", {
      configurable: true,
      get: () => complete,
    });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
      configurable: true,
      get: () => naturalWidth,
    });
  }

  beforeEach(() => stubImageLoad(false, 0));

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

  it("falls back when the image already failed before React could listen", () => {
    // The markup is server-rendered, so a load can finish — and fail — before
    // hydration attaches onError. That error is never replayed; a finished
    // image with no pixels is the only evidence left, and it has to be enough.
    // This is the bug the broken-image icons on a refreshed list page were.
    stubImageLoad(true, 0);
    render(<CompanyAvatar company="Acme Corp" logoUrl="/api/v1/applications/app-1/logo" />);
    expect(screen.getByText("AC")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("keeps a logo that loaded with pixels", () => {
    stubImageLoad(true, 64);
    render(<CompanyAvatar company="Acme Corp" logoUrl="/api/v1/applications/app-1/logo" />);
    expect(document.querySelector("img")).not.toBeNull();
  });
});
