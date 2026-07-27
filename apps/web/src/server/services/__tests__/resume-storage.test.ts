import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeResumeFile } from "../resume-storage";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("writeResumeFile perms", () => {
  it.skipIf(process.platform === "win32")("locks storageDir to 0700", () => {
    const base = mkdtempSync(join(tmpdir(), "offeros-resume-storage-"));
    dirs.push(base);
    const storageDir = join(base, "resumes"); // doesn't exist yet, exercises mkdirSync's mode

    writeResumeFile(storageDir, "r1", "application/pdf", Buffer.from("fake pdf"));

    expect(statSync(storageDir).mode & 0o777).toBe(0o700);
  });
});
