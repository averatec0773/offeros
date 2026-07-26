import { eq } from "drizzle-orm";
import { settingsSchema, type Settings } from "@offeros/core";
import type { Db } from "../db/client";
import { settings } from "../db/schema";

const SINGLETON_ID = "app";

export function getSettings(db: Db): Settings {
  const row = db.select().from(settings).where(eq(settings.id, SINGLETON_ID)).get();
  return settingsSchema.parse(row?.doc ?? {});
}

export function saveSettings(db: Db, next: Settings): Settings {
  const doc = settingsSchema.parse(next);
  db.insert(settings)
    .values({ id: SINGLETON_ID, doc, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: settings.id, set: { doc, updatedAt: Date.now() } })
    .run();
  return doc;
}
