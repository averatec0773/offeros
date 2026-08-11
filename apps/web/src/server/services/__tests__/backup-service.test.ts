import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { saveSettings } from "../../repositories/settings-repo";
import { createApplication } from "../../repositories/application-repo";

let dir: string;
let dbPath: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-backup-svc-"));
  dbPath = join(dir, "t.db");
  db = createDb(dbPath);
  // Point getSqlite() at this test DB by mocking the client's singleton getter.
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** exportBackup reads via getSqlite(); give it our test handle. */
async function loadServiceWith(handle: Database.Database) {
  vi.resetModules();
  vi.doMock("../../db/client", async () => {
    const actual = await vi.importActual<typeof import("../../db/client")>("../../db/client");
    return { ...actual, getSqlite: () => handle };
  });
  return import("../backup-service");
}

describe("exportBackup", () => {
  it("produces a valid SQLite copy that carries the data but not the API keys", async () => {
    // Seed data + a saved key.
    createApplication(db, {
      jobInfo: { jobId: "j1", jobTitle: "AI Engineer", companyName: "Acme" },
    });
    saveSettings(db, {
      agent: {
        enableCustomizeResume: true,
        enableCustomizeCoverLetter: true,
        useOriginalResume: false,
        autoConfirm: false,
        autoSubmit: false,
      },
      llm: {
        provider: "anthropic",
        promptOverrides: {},
        modelOverrides: {},
        apiKeys: { anthropic: "sk-secret-do-not-export" },
      },
    });

    const handle = new Database(dbPath);
    try {
      const { exportBackup } = await loadServiceWith(handle);
      const bundle = exportBackup("2026-08-11");
      expect(bundle.filename).toBe("offeros-backup-2026-08-11.db");

      // Write the bytes out and open them as a real database.
      const restoredPath = join(dir, "restored.db");
      writeFileSync(restoredPath, bundle.bytes);
      const restored = new Database(restoredPath);
      try {
        const apps = restored.prepare("SELECT count(*) AS n FROM applications").get() as {
          n: number;
        };
        expect(apps.n).toBe(1); // data survived

        const settingsRow = restored.prepare("SELECT doc FROM settings WHERE id = 'app'").get() as {
          doc: string;
        };
        const doc = JSON.parse(settingsRow.doc) as { llm: { apiKeys: Record<string, string> } };
        expect(doc.llm.apiKeys).toEqual({}); // key stripped
        expect(settingsRow.doc).not.toContain("sk-secret-do-not-export");
      } finally {
        restored.close();
      }
    } finally {
      handle.close();
    }
  });
});
