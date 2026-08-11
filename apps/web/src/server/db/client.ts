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
CREATE TABLE IF NOT EXISTS application_events (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL, kind TEXT NOT NULL,
  at INTEGER NOT NULL, payload TEXT);
CREATE TABLE IF NOT EXISTS agent_trace (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL, task_id TEXT,
  tool TEXT NOT NULL, reason TEXT, ok INTEGER NOT NULL, summary TEXT NOT NULL,
  failure_kind TEXT, failure_reason TEXT, verified INTEGER,
  duration_ms INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS style_memories (
  kind TEXT PRIMARY KEY, notes TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1, source_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT NOT NULL, steps TEXT, ran_out_of_steps INTEGER, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, note TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS form_shapes (
  question_key TEXT PRIMARY KEY, vendor TEXT NOT NULL, question TEXT NOT NULL,
  classified_type TEXT NOT NULL, seen_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0, first_failed_application_id TEXT,
  first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fill_incidents (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL, task_id TEXT NOT NULL,
  vendor TEXT NOT NULL, form_fingerprint TEXT NOT NULL, trigger_id TEXT NOT NULL,
  question_keys TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL,
  at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_application ON agent_tasks(application_id);
CREATE INDEX IF NOT EXISTS idx_jd_analyses_application ON jd_analyses(application_id);
CREATE INDEX IF NOT EXISTS idx_fit_analyses_application ON fit_analyses(application_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_fill_handoffs_task ON fill_handoffs(task_id);
CREATE INDEX IF NOT EXISTS idx_application_events_application ON application_events(application_id);
CREATE INDEX IF NOT EXISTS idx_agent_trace_application ON agent_trace(application_id);
-- Two lookups run often enough to index and are selective: every artifact read
-- is (task, kind), and the extension polls open handoffs by status. The
-- updated_at orderings are deliberately NOT indexed — this is one person's
-- database, those tables hold hundreds of rows, and the write cost would buy
-- nothing measurable.
CREATE INDEX IF NOT EXISTS idx_artifacts_task_kind ON artifacts(task_id, kind);
CREATE INDEX IF NOT EXISTS idx_fill_handoffs_status ON fill_handoffs(status);
CREATE INDEX IF NOT EXISTS idx_fill_incidents_application ON fill_incidents(application_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_scope ON chat_messages(scope, at);
`;

/**
 * Columns added to a table that had already shipped. `CREATE TABLE IF NOT
 * EXISTS` does nothing for a database that already has the table, so each of
 * these needs its own ALTER — and they are listed as data, not written as
 * calls, so that SCHEMA_FINGERPRINT below can see them. Every entry is
 * permanent: someone's database is still at the version that needs it.
 */
const ADDED_COLUMNS: ReadonlyArray<readonly [table: string, column: string, ddl: string]> = [
  [
    "agent_tasks",
    "cover_letter_requirement",
    "cover_letter_requirement TEXT NOT NULL DEFAULT 'unknown'",
  ],
  ["agent_tasks", "skipped_cover_letter", "skipped_cover_letter INTEGER NOT NULL DEFAULT 0"],
  ["agent_tasks", "field_reports", "field_reports TEXT"],
  ["agent_tasks", "fill_first", "fill_first INTEGER NOT NULL DEFAULT 0"],
  ["agent_tasks", "failure_reason", "failure_reason TEXT"],
  ["resumes", "note", "note TEXT"],
  ["resumes", "text", "text TEXT"],
  ["applications", "resume_id", "resume_id TEXT"],
  ["applications", "attach_resume", "attach_resume TEXT"],
  ["applications", "campaign_id", "campaign_id TEXT"],
  // Assistant messages: did the loop hit its step budget before answering?
  // Persisted so a reloaded thread still shows the "stopped at the limit"
  // notice, and so out-of-steps rate is measurable after the fact.
  ["chat_messages", "ran_out_of_steps", "ran_out_of_steps INTEGER"],
];

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

/**
 * What this build's schema looks like, as a number `PRAGMA user_version` can
 * hold. Derived from the schema text itself rather than bumped by hand: a
 * version someone has to remember to raise is a version that eventually is
 * not raised, and the failure is silent until a query hits the missing table.
 * Any edit to DDL or ADDED_COLUMNS changes this automatically.
 */
const SCHEMA_FINGERPRINT = ((): number => {
  let h = 2166136261;
  for (const ch of DDL + JSON.stringify(ADDED_COLUMNS)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  // user_version is a signed 32-bit int; keep it positive.
  return h >>> 1;
})();

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

/** Directory that holds fill evidence (incident-field screenshots), one
 *  subdirectory per application. */
export function defaultEvidenceDir(): string {
  return join(dirname(defaultDbPath()), "evidence");
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

/**
 * Bring a database up to the schema this build expects.
 *
 * Every statement is idempotent, so this is safe to run against a fresh file
 * and against one opened by an older build. It is deliberately separate from
 * opening the connection: a long-lived process (the auto-start service, a dev
 * server across a hot reload) keeps its handle far longer than it keeps its
 * code, and the schema has to follow the code, not the handle.
 */
function applySchema(sqlite: Database.Database): void {
  sqlite.exec(DDL);
  for (const [table, column, ddl] of ADDED_COLUMNS) addColumnIfMissing(sqlite, table, column, ddl);
  sqlite.pragma(`user_version = ${SCHEMA_FINGERPRINT}`);
}

/** Open a database at an explicit path, applying the schema. The raw handle
 *  comes back too: `getDb` keeps it to re-check the schema later, without a
 *  second connection to the same file. */
function openDb(path: string): { db: Db; sqlite: Database.Database } {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  applySchema(sqlite);
  tightenPerms(dir, 0o700);
  tightenPerms(path, 0o600);
  return { db: drizzle(sqlite, { schema }), sqlite };
}

/** Open a database at an explicit path, applying the schema. Used by tests. */
export function createDb(path: string): Db {
  return openDb(path).db;
}

const globalForDb = globalThis as unknown as {
  __offerosDb?: Db;
  __offerosSqlite?: Database.Database;
};

/**
 * Process-wide singleton for the app's real database. Cached on globalThis so
 * Next.js dev-mode module re-evaluation reuses the handle instead of leaking it.
 *
 * The cached handle can outlive the code that made it — a dev server hot-reloads
 * modules while keeping globalThis, and the auto-start service runs for days
 * across app updates. A build that added a table would then query one that its
 * own DDL creates but this connection never ran, which is exactly how a running
 * app started answering `no such table: agent_trace`. So the version this
 * process last applied is checked here, not only when the handle is opened.
 */
export function getDb(): Db {
  if (!globalForDb.__offerosDb || !globalForDb.__offerosSqlite) {
    const opened = openDb(defaultDbPath());
    globalForDb.__offerosDb = opened.db;
    globalForDb.__offerosSqlite = opened.sqlite;
    return globalForDb.__offerosDb;
  }
  // Cheap: one pragma read per call, no statement compilation.
  if (globalForDb.__offerosSqlite.pragma("user_version", { simple: true }) !== SCHEMA_FINGERPRINT) {
    applySchema(globalForDb.__offerosSqlite);
  }
  return globalForDb.__offerosDb;
}

/**
 * The raw better-sqlite3 handle for the app's real database, opening it if
 * needed. Almost nothing should reach for this — the repositories are the way
 * in — but the backup export needs SQLite-level operations (`VACUUM INTO`)
 * that drizzle does not surface.
 */
export function getSqlite(): Database.Database {
  getDb(); // ensures the singleton (both handles) is open and schema-current
  return globalForDb.__offerosSqlite!;
}
