import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "offeros-style-api-"));
process.env.OFFEROS_DB_PATH = join(dir, "style.db");

const styleRoute = await import("../settings/style/route");
const { getDb } = await import("@/server/db/client");
const { upsertStyleMemory } = await import("@/server/repositories/style-memory-repo");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function put(body: unknown): Request {
  return new Request("http://localhost", { method: "PUT", body: JSON.stringify(body) });
}

describe("/api/v1/settings/style", () => {
  it("GET returns defaults for both kinds when nothing has been stored", async () => {
    const res = await styleRoute.GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.result).toHaveLength(2);
    const resume = body.result.find((r: { kind: string }) => r.kind === "resume");
    expect(resume).toEqual({
      kind: "resume",
      notes: "",
      enabled: true,
      sourceCount: 0,
      updatedAt: null,
    });
    const coverLetter = body.result.find((r: { kind: string }) => r.kind === "cover-letter");
    expect(coverLetter.kind).toBe("cover-letter");
  });

  it("GET reflects a distilled row's real sourceCount/updatedAt", async () => {
    upsertStyleMemory(getDb(), "resume", { notes: "- Prefers active voice.", sourceCount: 3 });
    const res = await styleRoute.GET();
    const body = await res.json();
    const resume = body.result.find((r: { kind: string }) => r.kind === "resume");
    expect(resume.notes).toBe("- Prefers active voice.");
    expect(resume.sourceCount).toBe(3);
    expect(typeof resume.updatedAt).toBe("number");
  });

  it("PUT updates notes for a kind and returns the full refreshed list", async () => {
    const res = await styleRoute.PUT(put({ kind: "cover-letter", notes: "- Warm tone." }));
    const body = await res.json();
    expect(res.status).toBe(200);
    const coverLetter = body.result.find((r: { kind: string }) => r.kind === "cover-letter");
    expect(coverLetter.notes).toBe("- Warm tone.");
    expect(coverLetter.enabled).toBe(true);
  });

  it("PUT updates enabled independently of notes", async () => {
    await styleRoute.PUT(put({ kind: "resume", notes: "- Keep it short." }));
    const res = await styleRoute.PUT(put({ kind: "resume", enabled: false }));
    const body = await res.json();
    const resume = body.result.find((r: { kind: string }) => r.kind === "resume");
    expect(resume.enabled).toBe(false);
    // notes untouched by the enabled-only write
    expect(resume.notes).toBe("- Keep it short.");
  });

  it("PUT truncates notes at the 2000-char cap", async () => {
    const overLong = "z".repeat(2500);
    const res = await styleRoute.PUT(put({ kind: "resume", notes: overLong }));
    const body = await res.json();
    const resume = body.result.find((r: { kind: string }) => r.kind === "resume");
    expect(resume.notes).toHaveLength(2000);
  });

  it("PUT rejects an unknown kind with a 400", async () => {
    const res = await styleRoute.PUT(put({ kind: "bogus", notes: "x" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });
});
