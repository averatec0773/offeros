// @vitest-environment happy-dom
// Wiring test for the profile page: another thin passthrough — fetch the
// stored profile (or null) and hand it to <ProfileClient> as
// initialProfile. Mock ProfileClient to capture the prop rather than
// exercising its (separately-tested) internal form logic.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";

const dir = mkdtempSync(join(tmpdir(), "offeros-profile-page-"));
process.env.OFFEROS_DB_PATH = join(dir, "profile.db");

const profileClientSpy = vi.fn((_props: unknown) => <div data-testid="profile-client-stub" />);
vi.mock("@/components/profile/profile-client", () => ({
  ProfileClient: (props: unknown) => profileClientSpy(props),
}));

const { default: ProfilePage } = await import("../page");
const { getDb } = await import("@/server/db/client");
const { saveProfile } = await import("@/server/repositories/profile-repo");

afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  cleanup();
  profileClientSpy.mockClear();
});

const PROFILE = {
  personal: { name: "Jordan Rivera", email: "j@example.com", phone: "555", links: {} },
  skills: ["Python"],
  education: [],
  experience: [],
};

describe("ProfilePage", () => {
  it("passes null before any profile has been saved", () => {
    render(ProfilePage());
    expect(profileClientSpy).toHaveBeenCalledTimes(1);
    expect(profileClientSpy.mock.calls[0]![0]).toEqual({ initialProfile: null });
  });

  it("passes the saved profile once one exists", () => {
    saveProfile(getDb(), PROFILE);
    render(ProfilePage());
    const props = profileClientSpy.mock.calls[0]![0] as { initialProfile: { skills: string[] } };
    expect(props.initialProfile.skills).toEqual(["Python"]);
  });
});
