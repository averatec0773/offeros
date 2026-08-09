/**
 * Independent audit: what the DERIVED answer-bank entries actually do once the
 * bundle reaches the fill plan the extension executes.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_STEPS } from "@offeros/core";
import { buildFillPlan, type FieldDescriptor } from "@offeros/autofill";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../../repositories/application-repo";
import { createAgentTask, updateAgentTask } from "../../repositories/agent-task-repo";
import { createAnswer } from "../../repositories/answer-repo";
import { saveProfile } from "../../repositories/profile-repo";
import { createHandoffForTask, claimHandoff } from "../fill-service";

const FILL_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "fill-form");

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-guardaudit-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seedBundle(jdText: string) {
  const app = createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "Payments Engineer", companyName: "Acme" },
    jdText,
  });
  const task = createAgentTask(db, { applicationId: app.id });
  updateAgentTask(db, task.id, { step: FILL_STEP, status: "awaiting_user" });
  return claimHandoff(db, createHandoffForTask(db, task.id).id);
}

const textField = (fieldId: string, label: string): FieldDescriptor => ({
  fieldId,
  label,
  name: "",
  autocomplete: "",
  type: "textarea",
  placeholder: "",
  ariaLabel: "",
  currentValue: "",
});

describe("AUDIT: derived answers reaching a live form", () => {
  it("irrelevant work is dropped — a C++ side project is offered to a Rails job", () => {
    saveProfile(db, {
      personal: { name: "Jordan Rivera", email: "j@example.com", phone: "", links: {} },
      skills: [],
      education: [],
      experience: [],
      evidence: [
        {
          id: "jam",
          title: "Weekend game jam entry",
          url: "https://example.com/jam",
          summary: "A tiny puzzle game",
          stack: ["C++"],
          outcome: "",
        },
      ],
      selfAssessments: [],
    });
    const bundle = seedBundle("Senior Payments Engineer. Ruby on Rails, Postgres, Stripe.");
    expect(bundle.fillProfile.answerBank.find((a) => a.id === "derived:evidence")).toBeUndefined();
  });

  it("a stored answer always beats a derived one — proven through the plan", () => {
    saveProfile(db, {
      personal: { name: "Jordan Rivera", email: "j@example.com", phone: "", links: {} },
      skills: [],
      education: [],
      experience: [],
      evidence: [
        {
          id: "rag",
          title: "Doc search",
          url: "https://example.com/rag",
          summary: "Retrieval pipeline",
          stack: ["Ruby"],
          outcome: "",
        },
      ],
      selfAssessments: [],
    });
    createAnswer(db, {
      questionPatterns: ["relevant work"],
      answer: "Everything I can share is on my resume.",
      type: "text",
      category: "custom",
    });
    const bundle = seedBundle("Ruby engineer");
    const item = buildFillPlan(
      [textField("f1", "Please share links to any relevant work you would like us to see.")],
      bundle.fillProfile,
    )[0]!;
    expect(item.value).toBe("Everything I can share is on my resume.");
  });

  it("a committed rating only answers questions about that topic", () => {
    saveProfile(db, {
      personal: { name: "Jordan Rivera", email: "j@example.com", phone: "", links: {} },
      skills: [],
      education: [],
      experience: [],
      evidence: [],
      selfAssessments: [{ id: "go", topic: "Go", level: "Advanced", note: "" }],
    });
    const bundle = seedBundle("Backend engineer");
    const item = buildFillPlan(
      [textField("f1", "How far are you willing to go to meet a deadline?")],
      bundle.fillProfile,
    )[0]!;
    // A rating typed into an unrelated essay question, with no AI lane and no
    // review card in front of it — this is a "fillable" write in step 1.
    expect({ status: item.status, value: item.value }).toEqual({
      status: "needs-answer",
      value: "",
    });
  });
});
