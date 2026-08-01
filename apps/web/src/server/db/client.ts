import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { schema } from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const DDL = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mime_type TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0, target_role TEXT, file_path TEXT,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY, job_info TEXT NOT NULL, status TEXT NOT NULL,
  jd_text TEXT, notes TEXT, applied_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL, status TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0, application_info TEXT, resume_id TEXT,
  cover_letter_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jd_analyses (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL, doc TEXT NOT NULL,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fit_analyses (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL, doc TEXT NOT NULL,
  updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL, doc TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fill_handoffs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, application_id TEXT NOT NULL,
  apply_link TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_application ON agent_tasks(application_id);
CREATE INDEX IF NOT EXISTS idx_jd_analyses_application ON jd_analyses(application_id);
CREATE INDEX IF NOT EXISTS idx_fit_analyses_application ON fit_analyses(application_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_fill_handoffs_task ON fill_handoffs(task_id);
`;

/** SQLite errors on `ALTER TABLE ADD COLUMN` if the column already exists, so
 *  re-opening an existing DB must check first via `PRAGMA table_info`. */
function addColumnIfMissing(
  sqlite: Database.Database,
  table: string,
  column: string,
  ddl: string,
): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

export function defaultDbPath(): string {
  return process.env.OFFEROS_DB_PATH ?? join(homedir(), ".offeros", "offeros.db");
}

/** Directory that holds imported resume files, alongside the DB. */
export function defaultStorageDir(): string {
  return join(dirname(defaultDbPath()), "resumes");
}

/** Directory that holds imported template assets (.cls, shared preamble inputs). */
export function defaultTemplatesDir(): string {
  return join(dirname(defaultDbPath()), "templates");
}

/** Best-effort tighten to owner-only. This is a single-user, local-first app;
 *  the DB and its directory hold the user's résumé, answers, and job data, so
 *  they should not be group/world-readable. Exotic filesystems (some network
 *  mounts, Windows) may not support POSIX modes — degrade silently rather
 *  than block startup. */
function tightenPerms(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // best-effort; unsupported on this filesystem/platform
  }
}

/** Open a database at an explicit path, applying the schema. Used by tests. */
export function createDb(path: string): Db {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  tightenPerms(dir, 0o700);
  tightenPerms(path, 0o600);
  addColumnIfMissing(
    sqlite,
    "agent_tasks",
    "cover_letter_requirement",
    "cover_letter_requirement TEXT NOT NULL DEFAULT 'unknown'",
  );
  addColumnIfMissing(
    sqlite,
    "agent_tasks",
    "skipped_cover_letter",
    "skipped_cover_letter INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(sqlite, "agent_tasks", "field_reports", "field_reports TEXT");
  addColumnIfMissing(sqlite, "agent_tasks", "failure_reason", "failure_reason TEXT");
  addColumnIfMissing(sqlite, "resumes", "note", "note TEXT");
  addColumnIfMissing(sqlite, "resumes", "text", "text TEXT");
  addColumnIfMissing(sqlite, "applications", "resume_id", "resume_id TEXT");
  addColumnIfMissing(sqlite, "applications", "attach_resume", "attach_resume TEXT");
  return drizzle(sqlite, { schema });
}

const globalForDb = globalThis as unknown as { __offerosDb?: Db };

/** Process-wide singleton for the app's real database. Cached on globalThis so
 *  Next.js dev-mode module re-evaluation reuses the handle instead of leaking it. */
export function getDb(): Db {
  globalForDb.__offerosDb ??= createDb(defaultDbPath());
  return globalForDb.__offerosDb;
}
