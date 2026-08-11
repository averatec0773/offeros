import { exportBackup } from "@/server/services/backup-service";
import { handle } from "@/server/http/envelope";

export const runtime = "nodejs";

/** A UTC YYYY-MM-DD stamp for the backup filename. */
function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Download a portable backup of the whole database (keys stripped). It is a
 * plain SQLite file: restoring is "put it at ~/.offeros/offeros.db". Errors
 * are enveloped JSON; success is the file bytes.
 */
export async function GET() {
  return handle(async () => {
    const { bytes, filename } = exportBackup(dateStamp());
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/x-sqlite3",
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(bytes.byteLength),
        "cache-control": "no-store",
      },
    });
  });
}
