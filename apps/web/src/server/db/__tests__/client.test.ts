import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createDb } from "../client";
import { applications } from "../schema";

const dirs: string[] = [];
function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "offeros-test-"));
  dirs.push(dir);
  return join(dir, "test.db");
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("createDb", () => {
  it("creates the schema and round-trips a row", () => {
    const db = createDb(tempDbPath());
    const now = Date.now();
    db.insert(applications)
      .values({
        id: "app-1",
        jobInfo: { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" },
        status: "saved",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const rows = db.select().from(applications).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.jobInfo.companyName).toBe("Evolver");
    expect(rows[0]?.status).toBe("saved");
  });

  // Single-user, local-first: the DB directory and file hold résumé/answer
  // data and should not be group/world-readable. POSIX modes only.
  it.skipIf(process.platform === "win32")(
    "locks the DB dir to 0700 and the DB file to 0600",
    () => {
      const base = dirname(tempDbPath());
      const dbPath = join(base, "nested", "offeros.db"); // nested: doesn't exist yet, exercises mkdirSync's mode
      createDb(dbPath);

      expect(statSync(dirname(dbPath)).mode & 0o777).toBe(0o700);
      expect(statSync(dbPath).mode & 0o777).toBe(0o600);
    },
  );
});
