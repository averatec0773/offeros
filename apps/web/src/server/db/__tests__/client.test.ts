import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { createDb, getDb } from "../client";
import { RELEASE_DDL } from "./fixtures/release-schema";
import { applications, schema } from "../schema";

const dirs: string[] = [];
const dbPaths: string[] = [];
function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "offeros-test-"));
  dirs.push(dir);
  const path = join(dir, "test.db");
  dbPaths.push(path);
  return path;
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

describe("schema application", () => {
  /**
   * The invariant this file exists for.
   *
   * Drizzle's `schema` is what every query in the app assumes. The DDL string
   * is what actually gets created. Nothing tied the two together, so a table
   * added to one and not the other worked on a fresh database and threw
   * `no such table` on a real one — which is how a running app started
   * answering `no such table: agent_trace`. Comparing them here is the check
   * that could not be skipped by remembering to do it.
   */
  it("creates every table and column the app's queries assume", () => {
    createDb(tempDbPath());
    const raw = new Database(dbPaths.at(-1)!);
    for (const table of Object.values(schema)) {
      const { name, columns } = getTableConfig(table);
      const present = raw.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>;
      expect(
        present.length,
        `table ${name} is declared in schema.ts but never created`,
      ).toBeGreaterThan(0);
      const names = new Set(present.map((c) => c.name));
      for (const column of columns) {
        expect(names.has(column.name), `${name}.${column.name} is declared but not created`).toBe(
          true,
        );
      }
    }
    raw.close();
  });

  /**
   * The variant a fresh-database test can never see.
   *
   * Adding a column INTO an existing `CREATE TABLE` body works forever on a
   * new file and breaks only on a file someone already has — the column is
   * created for new users and silently skipped for everyone else. So the check
   * has to start from a database that really shipped, not from one this code
   * just made. The fixture is the first public release's DDL, frozen.
   */
  it("carries a first-release database all the way to the current schema", () => {
    const path = tempDbPath();
    const old = new Database(path);
    old.exec(RELEASE_DDL);
    old.close();

    createDb(path);

    const raw = new Database(path);
    const missing: string[] = [];
    for (const table of Object.values(schema)) {
      const { name, columns } = getTableConfig(table);
      const present = new Set(
        (raw.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map(
          (c) => c.name,
        ),
      );
      if (present.size === 0) missing.push(`table ${name}`);
      for (const column of columns) {
        if (!present.has(column.name)) missing.push(`${name}.${column.name}`);
      }
    }
    raw.close();
    expect(
      missing,
      "a database from the first release did not reach the current schema — every new table needs CREATE TABLE IF NOT EXISTS and every new column on an existing table needs an ADDED_COLUMNS entry, never an edit to a CREATE TABLE body",
    ).toEqual([]);
  });

  it("adds a table missing from a database an older build left behind", () => {
    const path = tempDbPath();
    // What an older build's file looks like: some of the schema, none of the rest.
    const old = new Database(path);
    old.exec(
      "CREATE TABLE applications (id TEXT PRIMARY KEY, job_info TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    );
    old.close();

    createDb(path);

    const raw = new Database(path);
    const found = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_trace'")
      .all();
    expect(found).toHaveLength(1);
    raw.close();
  });

  it("re-applies the schema to a handle opened before the schema grew", () => {
    const path = tempDbPath();
    process.env.OFFEROS_DB_PATH = path;
    try {
      const db = getDb();
      // Exactly the production failure: a long-lived process keeps its handle
      // across a code change that added a table. Simulated by dropping the
      // table and rewinding the version this connection last applied.
      const raw = new Database(path);
      raw.exec("DROP TABLE agent_trace");
      raw.pragma("user_version = 0");
      raw.close();

      // The same handle, used again after the code moved on.
      expect(getDb()).toBe(db);
      const check = new Database(path);
      expect(
        check.prepare("SELECT name FROM sqlite_master WHERE name='agent_trace'").all(),
      ).toHaveLength(1);
      check.close();
    } finally {
      delete process.env.OFFEROS_DB_PATH;
      delete (globalThis as Record<string, unknown>).__offerosDb;
      delete (globalThis as Record<string, unknown>).__offerosSqlite;
    }
  });

  it("does not re-run the schema on every call", () => {
    const path = tempDbPath();
    process.env.OFFEROS_DB_PATH = path;
    try {
      getDb();
      const raw = new Database(path);
      const version = raw.pragma("user_version", { simple: true });
      raw.close();
      // A fingerprint that changed per call would mean the guard never matches
      // and the DDL runs on every request.
      getDb();
      const after = new Database(path);
      expect(after.pragma("user_version", { simple: true })).toBe(version);
      expect(version).not.toBe(0);
      after.close();
    } finally {
      delete process.env.OFFEROS_DB_PATH;
      delete (globalThis as Record<string, unknown>).__offerosDb;
      delete (globalThis as Record<string, unknown>).__offerosSqlite;
    }
  });
});
