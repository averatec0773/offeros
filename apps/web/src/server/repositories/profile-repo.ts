import { eq } from "drizzle-orm";
import { profileSchema, type Profile } from "@offeros/core";
import type { Db } from "../db/client";
import { profiles } from "../db/schema";

const SINGLETON_ID = "me";

export function getProfile(db: Db): Profile | null {
  const row = db.select().from(profiles).where(eq(profiles.id, SINGLETON_ID)).get();
  if (!row) return null;
  return profileSchema.parse(row.doc);
}

export function saveProfile(db: Db, profile: Profile): Profile {
  const doc = profileSchema.parse(profile);
  db.insert(profiles)
    .values({ id: SINGLETON_ID, doc, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: profiles.id, set: { doc, updatedAt: Date.now() } })
    .run();
  return doc;
}
