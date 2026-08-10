import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../../repositories/application-repo";
import { listEvents } from "../../repositories/application-event-repo";
import { saveEvidence, EvidenceError } from "../evidence-service";

let db: Db;
let dir: string;
let evidenceDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-evidence-"));
  evidenceDir = join(dir, "evidence");
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// A real 1x1 PNG, so the magic-byte check is exercised against honest input.
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const pngDataUrl = `data:image/png;base64,${PNG_1PX}`;

function seedApp(): string {
  return createApplication(db, {
    jobInfo: { jobId: "j", jobTitle: "Engineer", companyName: "Acme" },
  }).id;
}

describe("saveEvidence", () => {
  it("writes the PNG under the application's directory and logs the event", () => {
    const applicationId = seedApp();
    const saved = saveEvidence(
      db,
      applicationId,
      { label: "Visa status", dataUrl: pngDataUrl },
      evidenceDir,
    );

    expect(existsSync(saved.file)).toBe(true);
    expect(saved.file).toContain(applicationId);
    expect(saved.file).toContain("visa-status");
    // Stored byte-for-byte: evidence that has been "helpfully" re-encoded is
    // no longer the browser's testimony.
    expect(readFileSync(saved.file).toString("base64")).toBe(PNG_1PX);

    const events = listEvents(db, applicationId);
    expect(events.some((e) => e.kind === "evidence-captured")).toBe(true);
    const payload = events.find((e) => e.kind === "evidence-captured")?.payload as {
      file?: string;
      label?: string;
    };
    expect(payload.file).toBe(saved.file);
    expect(payload.label).toBe("Visa status");
  });

  it("refuses an unknown application", () => {
    expect(() => saveEvidence(db, "ghost", { dataUrl: pngDataUrl }, evidenceDir)).toThrow(
      EvidenceError,
    );
  });

  it("refuses a non-PNG data URL", () => {
    const applicationId = seedApp();
    expect(() =>
      saveEvidence(
        db,
        applicationId,
        { dataUrl: `data:image/jpeg;base64,${PNG_1PX}` },
        evidenceDir,
      ),
    ).toThrow(EvidenceError);
  });

  it("refuses bytes that are not actually a PNG, whatever the prefix claims", () => {
    const applicationId = seedApp();
    const notPng = Buffer.from("plainly not an image").toString("base64");
    expect(() =>
      saveEvidence(db, applicationId, { dataUrl: `data:image/png;base64,${notPng}` }, evidenceDir),
    ).toThrow(/not a PNG/);
  });

  it("refuses an oversized payload before touching the disk", () => {
    const applicationId = seedApp();
    // 9MB of PNG-magic-prefixed zeros — over the 8MB cap.
    const big = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.alloc(9 * 1024 * 1024),
    ]).toString("base64");
    expect(() =>
      saveEvidence(db, applicationId, { dataUrl: `data:image/png;base64,${big}` }, evidenceDir),
    ).toThrow(/cap/);
    expect(existsSync(join(evidenceDir, applicationId))).toBe(false);
  });
});
