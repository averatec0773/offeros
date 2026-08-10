import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { campaignSchema, type Campaign } from "@offeros/core";
import type { Db } from "../db/client";
import { applications, campaigns } from "../db/schema";

/**
 * Row access for campaigns — named batches of applications.
 *
 * Membership lives on the APPLICATION (`applications.campaign_id`), not in a
 * join table: an application belongs to at most one campaign, so a join table
 * would only add a place for the two to disagree. Everything that asks "what is
 * in this campaign" filters applications; the campaigns table holds nothing but
 * the name on the box.
 */

type Row = typeof campaigns.$inferSelect;

function toDomain(row: Row): Campaign {
  return campaignSchema.parse({
    id: row.id,
    name: row.name,
    note: row.note ?? undefined,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function createCampaign(db: Db, input: { name: string; note?: string }): Campaign {
  const now = Date.now();
  const row: Row = {
    id: randomUUID(),
    name: input.name,
    note: input.note ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  db.insert(campaigns).values(row).run();
  return toDomain(row);
}

export function listCampaigns(db: Db): Campaign[] {
  return db.select().from(campaigns).orderBy(desc(campaigns.updatedAt)).all().map(toDomain);
}

export function getCampaign(db: Db, id: string): Campaign | null {
  const row = db.select().from(campaigns).where(eq(campaigns.id, id)).get();
  return row ? toDomain(row) : null;
}

export function updateCampaign(
  db: Db,
  id: string,
  patch: Partial<Pick<Campaign, "name" | "note" | "status">>,
): Campaign | null {
  const existing = db.select().from(campaigns).where(eq(campaigns.id, id)).get();
  if (!existing) return null;
  db.update(campaigns)
    .set({
      name: patch.name ?? existing.name,
      note: patch.note ?? existing.note,
      status: patch.status ?? existing.status,
      updatedAt: Date.now(),
    })
    .where(eq(campaigns.id, id))
    .run();
  return getCampaign(db, id);
}

/**
 * Delete a campaign AND detach its members in the same call.
 *
 * The detach is not optional. Deleting only the campaign row would leave every
 * member's `campaign_id` pointing at nothing — invisible until some later
 * feature groups by it and resurrects a ghost campaign. (This project has been
 * bitten by exactly this shape before: a removed feature whose data stayed.)
 */
export function deleteCampaign(db: Db, id: string): boolean {
  const existing = db.select().from(campaigns).where(eq(campaigns.id, id)).get();
  if (!existing) return false;
  db.update(applications)
    .set({ campaignId: null, updatedAt: Date.now() })
    .where(eq(applications.campaignId, id))
    .run();
  db.delete(campaigns).where(eq(campaigns.id, id)).run();
  return true;
}

/**
 * Move applications into a campaign (or out of any, with `campaignId: null`).
 * Setting is a MOVE, never an addition — single membership means assigning an
 * application that already sits in another campaign silently reassigns it,
 * which is what "add these to the August wave" means to the person doing it.
 * Returns how many rows actually changed.
 */
export function assignToCampaign(
  db: Db,
  campaignId: string | null,
  applicationIds: string[],
): number {
  if (applicationIds.length === 0) return 0;
  if (campaignId !== null && !getCampaign(db, campaignId)) return 0;
  const result = db
    .update(applications)
    .set({ campaignId, updatedAt: Date.now() })
    .where(inArray(applications.id, applicationIds))
    .run();
  return result.changes;
}
