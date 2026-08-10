import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db/client";
import { defaultEvidenceDir } from "../db/client";
import { getApplication } from "../repositories/application-repo";
import { appendEvent } from "../repositories/application-event-repo";

/**
 * Fill evidence: what the page actually looked like, kept on disk.
 *
 * The extension reports what it believes it did; the field reports record what
 * the engine planned; this stores the third, independent witness — a screenshot
 * of the incident field, taken by the browser itself. An auditor (human or
 * agent) reading a suspicious fill cross-checks all three, which only works if
 * none of them is derived from another. That independence is the entire value:
 * nothing here interprets the image, it is stored exactly as captured.
 *
 * Files land under `~/.offeros/evidence/<applicationId>/`, next to the DB and
 * the résumés — local disk, never a cloud. The timeline gets an
 * `evidence-captured` event pointing at the file, so evidence is discoverable
 * from the application's history without a new table.
 */

export class EvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceError";
  }
}

/** PNG data-URL prefix — the only format `captureVisibleTab` is asked for. */
const PNG_PREFIX = "data:image/png;base64,";

/** Screenshots above this decoded size are refused: a viewport PNG is a few
 *  hundred KB; anything MB-sized here means a caller bug, and evidence must
 *  never be able to fill the disk. */
const MAX_BYTES = 8 * 1024 * 1024;

/** Keep only what survives into a safe filename; the LABEL is preserved
 *  verbatim in the event payload, this is just the disk name. */
function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "field"
  );
}

export interface SavedEvidence {
  file: string;
  bytes: number;
}

export function saveEvidence(
  db: Db,
  applicationId: string,
  input: { label?: string; dataUrl: string },
  dir: string = defaultEvidenceDir(),
): SavedEvidence {
  if (!getApplication(db, applicationId)) {
    throw new EvidenceError(`application ${applicationId} not found`);
  }
  if (!input.dataUrl.startsWith(PNG_PREFIX)) {
    throw new EvidenceError("evidence must be a PNG data URL");
  }
  const base64 = input.dataUrl.slice(PNG_PREFIX.length);
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) throw new EvidenceError("evidence image is empty");
  if (bytes.length > MAX_BYTES) {
    throw new EvidenceError(`evidence image is ${bytes.length} bytes — over the ${MAX_BYTES} cap`);
  }
  // PNG magic — the prefix said PNG; the bytes have to agree. A mislabeled
  // payload stored as .png poisons every later reader silently.
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) {
    throw new EvidenceError("payload is not a PNG");
  }

  const appDir = join(dir, applicationId);
  mkdirSync(appDir, { recursive: true, mode: 0o700 });
  const file = join(appDir, `${Date.now()}-${slugify(input.label ?? "")}.png`);
  writeFileSync(file, bytes, { mode: 0o600 });

  appendEvent(db, {
    applicationId,
    kind: "evidence-captured",
    payload: { file, ...(input.label ? { label: input.label } : {}) },
  });
  return { file, bytes: bytes.length };
}
