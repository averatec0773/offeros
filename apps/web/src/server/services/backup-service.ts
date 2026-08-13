import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSqlite } from "../db/client";

/**
 * A portable backup of the user's entire database — profile, applications,
 * answers, generated documents, chat history, form memory: everything that
 * lives in `~/.offeros/offeros.db`.
 *
 * The backup is a normal SQLite file, so restoring it is "put this file at
 * ~/.offeros/offeros.db" — no bespoke import format to drift. It is produced
 * with `VACUUM INTO`, which writes a clean, fully-checkpointed copy of the live
 * database without touching it. Export also folds the write-ahead log back in
 * (see below) — the one moment this app reliably gets to do that. The copy is then opened once to strip the
 * saved LLM API keys, because a backup the user might email themselves or drop
 * in cloud storage must not carry a provider credential.
 *
 * NOT included: the original uploaded résumé/template PDF files (they live as
 * separate files beside the DB, and are re-uploadable). The résumé TEXT used
 * for tailoring is in the database and is preserved.
 */
export interface BackupBundle {
  bytes: Buffer;
  filename: string;
}

const SETTINGS_ID = "app";

/** Build a keys-stripped SQLite backup of the live database. `dateStamp` is
 *  injected (YYYY-MM-DD) so this stays pure — the caller stamps the filename. */
export function exportBackup(dateStamp: string): BackupBundle {
  const sqlite = getSqlite();
  const dir = mkdtempSync(join(tmpdir(), "offeros-backup-"));
  const copyPath = join(dir, `${randomUUID()}.db`);
  try {
    // Fold the write-ahead log back into the database file and start it over.
    //
    // Not for the backup's sake — VACUUM INTO already copies committed WAL
    // content, so the export was always complete. It is because automatic
    // checkpointing only runs when a connection happens to notice the log is
    // long, and a server process that stays open for days may simply never
    // notice: on this machine a 978 KB database had grown a 4.1 MB log with no
    // checkpoint in two days. Export is a natural moment to collect it — the
    // user asked for something slow already, and the log is provably redundant
    // the instant it is folded in.
    //
    // TRUNCATE, not PASSIVE: PASSIVE leaves the file at its high-water mark, so
    // the disk never comes back. A checkpoint that cannot complete (another
    // connection mid-read) is not an error worth failing an export over — the
    // pragma reports it in its result and the backup is unaffected either way.
    sqlite.pragma("wal_checkpoint(TRUNCATE)");

    // A clean, checkpointed copy of the current database. Single-quotes in the
    // path are escaped for the SQL literal; the path itself is server-generated.
    sqlite.exec(`VACUUM INTO '${copyPath.replace(/'/g, "''")}'`);

    // Strip saved API keys from the copy so the backup carries no credential.
    const copy = new Database(copyPath);
    try {
      const row = copy.prepare("SELECT doc FROM settings WHERE id = ?").get(SETTINGS_ID) as
        { doc: string } | undefined;
      if (row?.doc) {
        const doc = JSON.parse(row.doc) as { llm?: { apiKeys?: Record<string, string> } };
        if (doc.llm && doc.llm.apiKeys && Object.keys(doc.llm.apiKeys).length > 0) {
          doc.llm.apiKeys = {};
          copy
            .prepare("UPDATE settings SET doc = ? WHERE id = ?")
            .run(JSON.stringify(doc), SETTINGS_ID);
        }
      }
    } finally {
      copy.close();
    }

    return { bytes: readFileSync(copyPath), filename: `offeros-backup-${dateStamp}.db` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
