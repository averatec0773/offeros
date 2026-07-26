import { describe, expect, it } from "vitest";
import { settings } from "../src/lib/settings";

describe("settings", () => {
  it("defaults webApiBase to the local web app", async () => {
    expect(await settings.webApiBase.getValue()).toBe("http://localhost:3000");
  });
  it("round-trips a write", async () => {
    await settings.webApiBase.setValue("http://localhost:4000");
    expect(await settings.webApiBase.getValue()).toBe("http://localhost:4000");
  });
});
