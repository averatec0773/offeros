import { eq } from "drizzle-orm";
import {
  exportBundleSchema,
  profileSchema,
  answerSchema,
  type ApplicationStatus,
} from "@offeros/core";
import { defaultStorageDir, type Db } from "../db/client";
import { applications, resumes, answers } from "../db/schema";
import { saveProfile } from "../repositories/profile-repo";
import { writeResumeFile } from "./resume-storage";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Legacy status -> current status. Explicit mapping instead of a fallback so
// real progress never silently regresses to "saved" during import.
const LEGACY_STATUS_MAP: Record<string, ApplicationStatus> = {
  saved: "saved",
  // "filled" = the legacy extension autofilled the form but the user had not
  // submitted it yet; the new enum's closest equivalent is "applying".
  filled: "applying",
  applied: "applied",
  // "oa" = online assessment, a post-apply evaluation stage in the legacy
  // pipeline; the new enum has no dedicated value, so it maps to "interview".
  oa: "interview",
  interview: "interview",
  offer: "offer",
  rejected: "rejected",
  archived: "archived",
};

function toStatus(raw: unknown): ApplicationStatus {
  const candidate = typeof raw === "string" ? raw : "";
  return LEGACY_STATUS_MAP[candidate] ?? "saved";
}

/**
 * Ingest the legacy extension export. Idempotent: rows are keyed by their
 * original ids, so re-importing updates in place instead of duplicating.
 */
export function importBundle(
  db: Db,
  raw: unknown,
  options?: { storageDir?: string },
): {
  profile: boolean;
  applications: number;
  resumes: number;
  resumeFiles: number;
  answers: number;
  skipped: number;
} {
  const bundle = exportBundleSchema.parse(raw);
  const storageDir = options?.storageDir ?? defaultStorageDir();
  const now = Date.now();
  let importedProfile = false;
  let skipped = 0;
  let importedAnswers = 0;

  if (bundle.profile?.personal) {
    const p = bundle.profile;
    const personal = p.personal as Record<string, unknown>;
    saveProfile(
      db,
      profileSchema.parse({
        personal: {
          name: asString(personal.name),
          email: asString(personal.email),
          phone: asString(personal.phone),
          address: personal.address ? asString(personal.address) : undefined,
          city: personal.city ? asString(personal.city) : undefined,
          state: personal.state ? asString(personal.state) : undefined,
          country: personal.country ? asString(personal.country) : undefined,
          postalCode: personal.postalCode ? asString(personal.postalCode) : undefined,
          links: (personal.links as Record<string, string>) ?? {},
        },
        skills: p.skills ?? [],
        education: p.education ?? [],
        experience: p.workExperience ?? [],
      }),
    );
    importedProfile = true;
  }

  for (const entry of bundle.profile?.answerBank ?? []) {
    const parsed = answerSchema.safeParse(entry);
    if (!parsed.success) {
      skipped++;
      continue;
    }
    db.insert(answers)
      .values({ id: parsed.data.id, doc: parsed.data, updatedAt: now })
      .onConflictDoUpdate({ target: answers.id, set: { doc: parsed.data, updatedAt: now } })
      .run();
    importedAnswers++;
  }

  let resumeFiles = 0;

  for (const slot of bundle.resumes) {
    const blob = bundle.resumeBlobs[slot.id];
    let filePath: string | null = null;
    if (blob !== undefined) {
      // Sanitized for use as a FILENAME only — the database row keeps the
      // original `slot.id` so re-imports still match by identity. Untrusted
      // import JSON could otherwise smuggle `../` and escape `storageDir`.
      filePath = writeResumeFile(storageDir, slot.id, slot.mimeType, Buffer.from(blob, "base64"));
      resumeFiles++;
    }

    db.insert(resumes)
      .values({
        id: slot.id,
        name: slot.name,
        mimeType: slot.mimeType,
        isPrimary: slot.isPrimary ?? false,
        targetRole: slot.targetRole ?? null,
        filePath,
        createdAt: slot.createdAt,
      })
      .onConflictDoUpdate({
        target: resumes.id,
        // Only touch `filePath` when this call actually wrote a blob — a
        // re-import that omits a resume's blob must not null out a
        // previously-good path.
        set: blob !== undefined ? { name: slot.name, filePath } : { name: slot.name },
      })
      .run();
  }

  for (const legacy of bundle.applications) {
    const jobInfo = {
      jobId: legacy.id,
      jobTitle: legacy.title ?? "Untitled role",
      companyName: legacy.company ?? "Unknown company",
      applyLink: legacy.url,
    };
    const existing = db.select().from(applications).where(eq(applications.id, legacy.id)).get();
    if (existing) {
      db.update(applications)
        .set({ jobInfo, status: toStatus(legacy.status), updatedAt: now })
        .where(eq(applications.id, legacy.id))
        .run();
    } else {
      db.insert(applications)
        .values({
          id: legacy.id,
          jobInfo,
          status: toStatus(legacy.status),
          jdText: legacy.jdText ?? null,
          notes: legacy.notes ?? null,
          appliedAt: null,
          createdAt: legacy.filledAt ?? now,
          updatedAt: legacy.statusUpdatedAt ?? legacy.filledAt ?? now,
        })
        .run();
    }
  }

  return {
    profile: importedProfile,
    applications: bundle.applications.length,
    resumes: bundle.resumes.length,
    resumeFiles,
    answers: importedAnswers,
    skipped,
  };
}
