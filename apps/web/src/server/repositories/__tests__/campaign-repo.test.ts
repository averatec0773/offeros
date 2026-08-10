import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { createApplication, getApplication } from "../application-repo";
import {
  assignToCampaign,
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
} from "../campaign-repo";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-campaign-repo-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seedApplication(): string {
  return createApplication(db, {
    jobInfo: { jobId: "j", jobTitle: "Engineer", companyName: "Acme" },
  }).id;
}

describe("campaign CRUD", () => {
  it("creates active and round-trips through the domain schema", () => {
    const campaign = createCampaign(db, { name: "August wave", note: "new-grad SWE" });
    expect(campaign.status).toBe("active");
    expect(getCampaign(db, campaign.id)).toEqual(campaign);
    expect(listCampaigns(db)).toHaveLength(1);
  });

  it("updates name, note and status independently", () => {
    const campaign = createCampaign(db, { name: "A" });
    const renamed = updateCampaign(db, campaign.id, { name: "B" });
    expect(renamed?.name).toBe("B");
    const archived = updateCampaign(db, campaign.id, { status: "archived" });
    expect(archived?.status).toBe("archived");
    expect(archived?.name).toBe("B");
  });

  it("returns null updating a campaign that does not exist", () => {
    expect(updateCampaign(db, "ghost", { name: "X" })).toBeNull();
  });
});

describe("assignToCampaign", () => {
  it("moves applications in, and out with null", () => {
    const campaign = createCampaign(db, { name: "Wave" });
    const a = seedApplication();
    const b = seedApplication();

    expect(assignToCampaign(db, campaign.id, [a, b])).toBe(2);
    expect(getApplication(db, a)?.campaignId).toBe(campaign.id);

    expect(assignToCampaign(db, null, [a])).toBe(1);
    expect(getApplication(db, a)?.campaignId).toBeUndefined();
    expect(getApplication(db, b)?.campaignId).toBe(campaign.id);
  });

  it("reassigning MOVES between campaigns — single membership", () => {
    const first = createCampaign(db, { name: "First" });
    const second = createCampaign(db, { name: "Second" });
    const a = seedApplication();
    assignToCampaign(db, first.id, [a]);
    assignToCampaign(db, second.id, [a]);
    expect(getApplication(db, a)?.campaignId).toBe(second.id);
  });

  it("refuses to assign into a campaign that does not exist", () => {
    const a = seedApplication();
    expect(assignToCampaign(db, "ghost", [a])).toBe(0);
    expect(getApplication(db, a)?.campaignId).toBeUndefined();
  });
});

describe("deleteCampaign", () => {
  it("detaches every member in the same call — no ghost membership survives", () => {
    const campaign = createCampaign(db, { name: "Doomed" });
    const a = seedApplication();
    const b = seedApplication();
    assignToCampaign(db, campaign.id, [a, b]);

    expect(deleteCampaign(db, campaign.id)).toBe(true);
    expect(getCampaign(db, campaign.id)).toBeNull();
    // The applications survive; only the grouping is gone.
    expect(getApplication(db, a)?.campaignId).toBeUndefined();
    expect(getApplication(db, b)?.campaignId).toBeUndefined();
  });

  it("returns false for a campaign that does not exist", () => {
    expect(deleteCampaign(db, "ghost")).toBe(false);
  });
});
