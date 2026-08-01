import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "offeros-resume-file-route-"));
process.env.OFFEROS_DB_PATH = join(dir, "route.db");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const { getDb } = await import("@/server/db/client");
const { resumes } = await import("@/server/db/schema");
const { uploadResume } = await import("@/server/services/resume-service");
const { GET } = await import("../resumes/[id]/file/route");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://localhost");

const PDF_BASE64 = Buffer.from("%PDF-1.4 fake resume bytes").toString("base64");

describe("GET resume file route", () => {
  it("streams the stored bytes with the row's mime type and a content-disposition using the stored name", async () => {
    const db = getDb();
    const resume = uploadResume(db, {
      name: "Jordan Résumé.pdf",
      mimeType: "application/pdf",
      dataBase64: PDF_BASE64,
    });

    const res = await GET(req(), ctx(resume.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("Jordan Résumé.pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.toString("utf8")).toBe("%PDF-1.4 fake resume bytes");
  });

  it("404s an unknown id", async () => {
    const res = await GET(req(), ctx("nope"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("404s when the row exists but the file is missing on disk", async () => {
    const db = getDb();
    const resume = uploadResume(db, {
      name: "gone.pdf",
      mimeType: "application/pdf",
      dataBase64: PDF_BASE64,
    });
    const row = db.select().from(resumes).where(eq(resumes.id, resume.id)).get();
    unlinkSync(row!.filePath!);

    const res = await GET(req(), ctx(resume.id));
    expect(res.status).toBe(404);
  });

  it("404s when the resume row has no stored file at all", async () => {
    const db = getDb();
    db.insert(resumes)
      .values({
        id: "no-file",
        name: "No File.pdf",
        mimeType: "application/pdf",
        isPrimary: false,
        filePath: null,
        createdAt: Date.now(),
      })
      .run();

    const res = await GET(req(), ctx("no-file"));
    expect(res.status).toBe(404);
  });
});
