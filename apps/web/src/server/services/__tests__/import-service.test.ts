import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDb, type Db } from "../../db/client";
import { importBundle } from "../import-service";
import { getProfile } from "../../repositories/profile-repo";
import { listApplications } from "../../repositories/application-repo";
import { answers, resumes } from "../../db/schema";

let db: Db;
let dir: string;
let storageDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-import-"));
  db = createDb(join(dir, "i.db"));
  storageDir = join(dir, "resumes");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const BUNDLE = {
  schemaVersion: 1,
  exportedAt: 1700000000000,
  profile: {
    personal: {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "555-0100",
      address: "1 Main St",
      links: { linkedin: "https://linkedin.com/in/jordan" },
    },
    skills: ["Python", "TypeScript"],
    education: [
      { id: "e1", school: "State U", degree: "BS", field: "CS", start: "2019", end: "2023" },
    ],
    workExperience: [
      {
        id: "w1",
        company: "Acme",
        title: "Engineer",
        start: "2023",
        end: "2025",
        bullets: ["Shipped things"],
      },
    ],
    answerBank: [
      {
        id: "ans1",
        questionPatterns: ["Are you legally authorized to work"],
        answer: "Yes",
        type: "boolean",
        category: "eeo",
      },
      {
        id: "ans2",
        questionPatterns: ["Years of experience"],
        answer: "5",
        type: "number",
        category: "screening",
      },
      // Missing `type` — should fail validation and be skipped, not crash.
      { id: "ans-bad", questionPatterns: ["Broken"], answer: "x", category: "custom" },
    ],
  },
  resumes: [
    {
      id: "r1",
      name: "Resume",
      mimeType: "application/pdf",
      isPrimary: true,
      createdAt: 1700000000000,
    },
    { id: "r2", name: "No Blob Resume", mimeType: "application/pdf", createdAt: 1700000000001 },
  ],
  resumeBlobs: {
    r1: Buffer.from("%PDF-1.4 fake resume bytes").toString("base64"),
  },
  applications: [
    {
      id: "a1",
      company: "Evolver",
      title: "GenAI Engineer",
      url: "https://x/y",
      status: "applied",
      jdText: "We are looking for a GenAI Engineer to join Evolver.",
      filledAt: 1000,
      statusUpdatedAt: 2000,
    },
    {
      id: "a2",
      company: "Filled Co",
      title: "SWE",
      status: "filled",
      filledAt: 1,
      statusUpdatedAt: 2,
    },
    {
      id: "a3",
      company: "OA Co",
      title: "SWE",
      status: "oa",
      filledAt: 1,
      statusUpdatedAt: 2,
    },
  ],
};

describe("importBundle", () => {
  it("maps a legacy export into the new model", () => {
    const summary = importBundle(db, BUNDLE, { storageDir });
    expect(summary.profile).toBe(true);
    expect(summary.applications).toBe(3);
    expect(summary.resumes).toBe(2);
    expect(summary.resumeFiles).toBe(1);
    expect(summary.answers).toBe(2);
    expect(summary.skipped).toBe(1);

    const profile = getProfile(db);
    expect(profile?.personal.name).toBe("Jordan Rivera");
    expect(profile?.skills).toEqual(["Python", "TypeScript"]);
    // legacy `workExperience` is mapped onto `experience`
    expect(profile?.experience[0]?.company).toBe("Acme");

    const apps = listApplications(db);
    expect(apps).toHaveLength(3);
    const a1 = apps.find((a) => a.id === "a1");
    expect(a1?.jobInfo.companyName).toBe("Evolver");
    expect(a1?.status).toBe("applied");
    const legacyA1 = BUNDLE.applications.find((a) => a.id === "a1")!;
    expect(a1?.jdText).toBe(legacyA1.jdText);
    expect(a1?.createdAt).toBe(legacyA1.filledAt);
    expect(a1?.updatedAt).toBe(legacyA1.statusUpdatedAt);

    const r1 = db
      .select()
      .from(resumes)
      .all()
      .find((r) => r.id === "r1");
    expect(r1?.isPrimary).toBe(true);
  });

  it("sorts imported applications by updatedAt desc using the legacy timestamps", () => {
    const bundle = {
      ...BUNDLE,
      applications: [
        ...BUNDLE.applications,
        {
          id: "a4",
          company: "Newer Co",
          title: "SWE",
          status: "saved",
          filledAt: 5000,
          statusUpdatedAt: 6000,
        },
      ],
    };
    importBundle(db, bundle, { storageDir });
    const apps = listApplications(db);
    expect(apps[0]?.id).toBe("a4");
    expect(apps[1]?.id).toBe("a1");
  });

  it("is idempotent — importing twice does not duplicate applications", () => {
    importBundle(db, BUNDLE, { storageDir });
    importBundle(db, BUNDLE, { storageDir });
    expect(listApplications(db)).toHaveLength(3);
  });

  it("is idempotent — importing twice does not duplicate answers or resumes", () => {
    importBundle(db, BUNDLE, { storageDir });
    importBundle(db, BUNDLE, { storageDir });
    expect(db.select().from(answers).all()).toHaveLength(2);
    expect(db.select().from(resumes).all()).toHaveLength(2);
  });

  it("rejects a bundle that is not an object", () => {
    expect(() => importBundle(db, "nope", { storageDir })).toThrow();
  });

  it("imports answerBank entries into the answers table keyed by original id", () => {
    importBundle(db, BUNDLE, { storageDir });
    const rows = db.select().from(answers).all();
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["ans1", "ans2"]);
    const ans1 = rows.find((r) => r.id === "ans1");
    expect(ans1?.doc.answer).toBe("Yes");
    expect(ans1?.doc.category).toBe("eeo");
  });

  it("writes resumeBlobs to the injected storageDir and round-trips bytes", () => {
    importBundle(db, BUNDLE, { storageDir });
    const rows = db.select().from(resumes).all();
    const r1 = rows.find((r) => r.id === "r1");
    expect(r1?.filePath).toBeTruthy();
    expect(r1?.filePath).toContain(storageDir);
    expect(r1?.filePath).toMatch(/\.pdf$/);

    const bytes = readFileSync(r1!.filePath!, "utf8");
    expect(bytes).toBe("%PDF-1.4 fake resume bytes");
  });

  it("leaves filePath null for a resume with no matching blob", () => {
    importBundle(db, BUNDLE, { storageDir });
    const rows = db.select().from(resumes).all();
    const r2 = rows.find((r) => r.id === "r2");
    expect(r2?.filePath).toBeNull();
  });

  it("maps legacy `filled` to `applying` and `oa` to `interview`", () => {
    importBundle(db, BUNDLE, { storageDir });
    const apps = listApplications(db);
    expect(apps.find((a) => a.id === "a2")?.status).toBe("applying");
    expect(apps.find((a) => a.id === "a3")?.status).toBe("interview");
  });

  it("re-importing without a resume's blob does not null out a previously-set filePath", () => {
    importBundle(db, BUNDLE, { storageDir });
    const before = db
      .select()
      .from(resumes)
      .all()
      .find((r) => r.id === "r1");
    expect(before?.filePath).toBeTruthy();

    // Same bundle, but this resume's blob is now missing (partial export).
    const rebundle = { ...BUNDLE, resumeBlobs: {} };
    importBundle(db, rebundle, { storageDir });

    const after = db
      .select()
      .from(resumes)
      .all()
      .find((r) => r.id === "r1");
    expect(after?.filePath).toBe(before?.filePath);
    expect(readFileSync(after!.filePath!, "utf8")).toBe("%PDF-1.4 fake resume bytes");
  });

  it("sanitizes a path-traversal resume id so the file stays inside storageDir", () => {
    const evilBundle = {
      ...BUNDLE,
      resumes: [
        { id: "../../evil", name: "Evil", mimeType: "application/pdf", createdAt: 1700000000000 },
      ],
      resumeBlobs: {
        "../../evil": Buffer.from("evil bytes").toString("base64"),
      },
    };
    importBundle(db, evilBundle, { storageDir });

    const row = db
      .select()
      .from(resumes)
      .all()
      .find((r) => r.id === "../../evil");
    expect(row).toBeTruthy();
    expect(row?.filePath).toBeTruthy();
    const resolvedPath = resolve(row!.filePath!);
    expect(resolvedPath.startsWith(resolve(storageDir))).toBe(true);

    // Nothing escaped: storageDir contains exactly the sanitized file, and
    // no "evil" file was created outside it (in dir, storageDir's parent).
    expect(readdirSync(storageDir)).toHaveLength(1);
    expect(readdirSync(dir)).not.toContain("evil");
  });
});
