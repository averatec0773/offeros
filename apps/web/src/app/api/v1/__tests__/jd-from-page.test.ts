import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "offeros-jd-page-"));
process.env.OFFEROS_DB_PATH = join(dir, "jd.db");

const route = await import("../applications/[id]/jd-from-page/route");
const { getDb } = await import("@/server/db/client");
const { createApplication, getApplication } =
  await import("@/server/repositories/application-repo");
const { listEvents } = await import("@/server/repositories/application-event-repo");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * The description as the browser sees it — the extraction ladder's fourth rung,
 * reserved from the start and never wired.
 *
 * A posting written entirely in JavaScript does not exist until a browser runs
 * the page, so a server fetch returns a link-preview blurb: on a real posting,
 * 150 characters where the description is thousands. The panel is standing in
 * the browser that has the text.
 */

const LONG = "We are hiring an engineer to own the ingestion pipeline. ".repeat(8);

const seed = (jdText?: string) =>
  createApplication(getDb(), {
    jobInfo: { jobId: "j1", jobTitle: "Engineer", companyName: "Acme" },
    ...(jdText ? { jdText } : {}),
  }).id;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, jdText: unknown) =>
  route.POST(
    new Request("http://localhost", { method: "POST", body: JSON.stringify({ jdText }) }),
    ctx(id),
  );

describe("POST /applications/[id]/jd-from-page", () => {
  it("stores what the browser read, and says where it came from", async () => {
    const id = seed();
    const res = await post(id, LONG);
    expect(res.status).toBe(200);
    const app = getApplication(getDb(), id)!;
    expect(app.jdText).toContain("ingestion pipeline");
    expect(app.jdSource).toBe("browser");
  });

  it("replaces a summary, and records what it replaced", async () => {
    // The whole point: the blurb is already stored, and this is the only path
    // that can do better.
    const blurb = "Join our team and help build the future of logistics software.";
    const id = seed(blurb);
    await post(id, LONG);
    const app = getApplication(getDb(), id)!;
    expect(app.jdText).toContain("ingestion pipeline");
    const replaced = listEvents(getDb(), id).find((e) => e.kind === "jd-replaced");
    expect(replaced).toBeTruthy();
    expect((replaced!.payload as { previousChars: number }).previousChars).toBe(blurb.length);
  });

  it("does not record an event when nothing changed", async () => {
    const id = seed(LONG.trim());
    await post(id, LONG);
    expect(listEvents(getDb(), id).filter((e) => e.kind === "jd-replaced")).toHaveLength(0);
  });

  it("refuses a page that had almost no text on it", async () => {
    // A mis-click on a nav page must not overwrite a real description.
    const id = seed(LONG);
    const res = await post(id, "Careers | Acme");
    expect(res.status).toBe(400);
    expect(getApplication(getDb(), id)!.jdText).toContain("ingestion pipeline");
  });

  it("404s for an application that does not exist", async () => {
    const res = await post("nope", LONG);
    expect(res.status).toBe(404);
  });
});
