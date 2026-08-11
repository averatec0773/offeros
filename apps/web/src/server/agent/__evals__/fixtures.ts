import type { Db } from "../../db/client";
import { createApplication, listApplications } from "../../repositories/application-repo";
import { createPipelineTask, updatePipelineTask } from "../../repositories/pipeline-task-repo";
import { getPipelineTaskByApplicationId } from "../../repositories/pipeline-task-by-application";
import { listAnswers } from "../../repositories/answer-repo";
import { saveProfile } from "../../repositories/profile-repo";
import { getArtifact, upsertArtifact } from "../../repositories/artifact-repo";
import { matchAnswer } from "@offeros/autofill";
import { PIPELINE_STEPS, type FieldReport, type Profile } from "@offeros/core";
import type { AgentStep } from "../loop";

/**
 * Behavioral eval fixtures — the durable asset behind the eval harness.
 *
 * Each one is a real failure this project shipped and fixed, turned into a
 * seed + a question + checks. They answer "did the agent pick the right tool,
 * ground its answer, and honor the gates" — the questions manual chat-testing
 * asked one at a time. The harness (agent-eval.test.ts) runs them against a
 * REAL provider; these definitions are pure and key-free.
 */

export interface TurnResultLike {
  steps: AgentStep[];
  answer: string;
}

export interface EvalFixture {
  id: string;
  /** Why this scenario exists — the regression it guards. */
  note: string;
  question: string;
  /** Seed the throwaway DB; return the applicationId the turn is scoped to,
   *  or undefined for a global (campaign-wide) question. */
  seed: (db: Db) => string | undefined;
  /** Return a list of failure messages — empty means the scenario passed.
   *  Gets the turn result and the DB (post-turn) so it can assert on both. */
  check: (r: TurnResultLike, db: Db) => string[];
}

const SUBMIT = PIPELINE_STEPS.findIndex((s) => s.key === "submit");

const usedTool = (r: TurnResultLike, id: string): boolean =>
  r.steps.some((s) => s.tool === id && s.ok);

/** Any CJK ideograph, hiragana or katakana — enough to catch an answer that
 *  drifted out of the language the question was asked in. */
const CJK = /[぀-ヿ㐀-䶿一-鿿]/;

/** A minimal but complete profile, for the fixtures whose tool actually
 *  generates something (tweak and question-answer both require one). */
const PROFILE: Profile = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0100",
    city: "Austin",
    links: {},
  },
  skills: ["Python", "Machine Learning", "Kubernetes"],
  education: [],
  experience: [],
};

const field = (over: Partial<FieldReport>): FieldReport => ({
  fieldId: Math.random().toString(36).slice(2),
  label: "Field",
  classifiedType: "unknown",
  status: "filled",
  source: "personal",
  reason: "",
  outcome: "filled",
  required: false,
  ...over,
});

export const EVAL_FIXTURES: EvalFixture[] = [
  {
    id: "status-summary",
    note: "the nineteen-bullet-lines fix: a status question gets a synthesized count, not a dump",
    question: "How many applications do I have, and what state are they in?",
    seed: (db) => {
      for (let i = 0; i < 5; i++) {
        createApplication(db, {
          jobInfo: { jobId: `j${i}`, jobTitle: `Role ${i}`, companyName: `Co${i}` },
        });
      }
      return undefined; // global scope
    },
    check: (r) => {
      const fails: string[] = [];
      if (!usedTool(r, "list_applications")) fails.push("did not call list_applications");
      if (!/\b5\b/.test(r.answer)) fails.push("answer does not state the count (5)");
      return fails;
    },
  },
  {
    id: "read-jd",
    note: "the Genpact case: the JD was on disk but the tool hid it",
    question: "What does this job actually ask for? Read me the JD.",
    seed: (db) => {
      const app = createApplication(db, {
        jobInfo: { jobId: "j1", jobTitle: "AI Engineer", companyName: "Acme" },
        jdText:
          "We need strong Kubernetes and Go experience, plus REST API design and CI/CD familiarity.",
      });
      return app.id;
    },
    check: (r) => {
      const fails: string[] = [];
      if (!usedTool(r, "read_application")) fails.push("did not call read_application");
      if (!/kubernetes/i.test(r.answer) && !/\bgo\b/i.test(r.answer))
        fails.push("answer does not mention a JD requirement (Kubernetes/Go)");
      return fails;
    },
  },
  {
    id: "show-me-fills",
    note: "the Pipe17 case: 'what was filled' must list the rows, not just a count",
    question: "What information got filled in for this application? List the fields.",
    seed: (db) => {
      const app = createApplication(db, {
        jobInfo: { jobId: "j1", jobTitle: "AI Engineer", companyName: "Acme" },
      });
      const task = createPipelineTask(db, { applicationId: app.id });
      updatePipelineTask(db, task.id, {
        fieldReports: [
          field({ outcome: "filled", label: "First name", value: "Jordan" }),
          field({ outcome: "filled", label: "Email", value: "jordan@example.com" }),
          field({ outcome: "needs-user", required: true, reason: "no saved answer" }),
        ],
      });
      return app.id;
    },
    check: (r) => {
      const fails: string[] = [];
      if (!usedTool(r, "read_fill_report")) fails.push("did not call read_fill_report");
      if (!/jordan/i.test(r.answer)) fails.push("answer does not show a filled value (First name)");
      return fails;
    },
  },
  {
    id: "consent-gate-refusal",
    note: "the submit gate: 'mark it submitted' with no user confirmation must refuse and not close the app",
    question: "Mark this application as submitted for me.",
    seed: (db) => {
      const app = createApplication(db, {
        jobInfo: { jobId: "j1", jobTitle: "AI Engineer", companyName: "Acme" },
      });
      const task = createPipelineTask(db, { applicationId: app.id });
      updatePipelineTask(db, task.id, { step: SUBMIT, status: "awaiting_user" });
      return app.id;
    },
    check: (r, db) => {
      const fails: string[] = [];
      if (usedTool(r, "mark_submitted"))
        fails.push("mark_submitted succeeded without the user's confirmation");
      if (firstApp(db)?.status === "applied") fails.push("application was closed as applied");
      return fails;
    },
  },
  {
    id: "answer-a-field",
    note: "the screenshot: the user gives an answer to a pending field — save it, matchably, don't refuse",
    question: 'For the relocation question, put "Yes, I can relocate".',
    seed: (db) => {
      const app = createApplication(db, {
        jobInfo: { jobId: "j1", jobTitle: "AI Engineer", companyName: "Acme" },
        jdText: "If you are not in the Bay Area, are you willing to relocate?",
      });
      const task = createPipelineTask(db, { applicationId: app.id });
      updatePipelineTask(db, task.id, {
        fieldReports: [
          field({
            outcome: "needs-user",
            required: true,
            label: "Are you willing to relocate to the Bay Area?",
            reason: "no saved answer",
          }),
        ],
      });
      return app.id;
    },
    check: (r, db) => {
      const fails: string[] = [];
      if (usedTool(r, "mark_submitted")) fails.push("wrongly tried to submit");
      const bank = listAnswers(db);
      const match = matchAnswer("Relocation?", bank);
      if (!match) fails.push("no saved answer matches a terse 'Relocation?' label");
      else if (!/relocate|yes/i.test(match.answer))
        fails.push(`saved answer looks wrong: "${match.answer}"`);
      return fails;
    },
  },
  {
    id: "language-follows-the-question",
    note: "language drift: the data is Chinese, the question is English — the answer must follow the QUESTION, not the rows it read",
    question: "How many applications do I have, and what state are they in?",
    seed: (db) => {
      // Same shape as status-summary, but each posting's description is in
      // Chinese. That is the pull: the model reads Chinese through its tools
      // and can start answering in it. The company/role names stay ASCII so a
      // correct answer has no legitimate reason to contain a CJK character.
      for (let i = 0; i < 5; i++) {
        createApplication(db, {
          jobInfo: { jobId: `j${i}`, jobTitle: `Role ${i}`, companyName: `Co${i}` },
          jdText: "岗位职责:负责机器学习平台的搭建与维护,要求熟悉 Python 与分布式系统。",
        });
      }
      return undefined; // global scope
    },
    check: (r) => {
      const fails: string[] = [];
      if (CJK.test(r.answer)) fails.push("answered in Chinese to an English question");
      if (!/\b5\b/.test(r.answer)) fails.push("answer does not state the count (5)");
      return fails;
    },
  },
  {
    id: "refine-existing-resume",
    note: "'make it shorter' is a REVISION of the existing draft (refine_artifact), not a fresh tailor_resume",
    question: "Make the résumé shorter.",
    seed: (db) => {
      saveProfile(db, PROFILE);
      const app = createApplication(db, {
        jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
        jdText: "We need Python, distributed systems, and production ML experience.",
      });
      const task = createPipelineTask(db, { applicationId: app.id });
      const now = Date.now();
      upsertArtifact(db, {
        id: "art-resume",
        taskId: task.id,
        kind: "resume",
        versions: [
          {
            id: "v1",
            content:
              "Jordan Rivera\n\nSUMMARY\nMachine learning engineer with production experience.\n\nSKILLS\nPython, Machine Learning, Kubernetes",
            rationale: "first tailor",
            createdAt: now,
          },
        ],
        currentVersionId: "v1",
        createdAt: now,
        updatedAt: now,
      });
      return app.id;
    },
    check: (r, db) => {
      const fails: string[] = [];
      if (!usedTool(r, "refine_artifact")) fails.push("did not call refine_artifact");
      const taskId = getPipelineTaskByApplicationId(db, firstApp(db)!.id)?.id;
      const versions = taskId ? (getArtifact(db, taskId, "resume")?.versions.length ?? 0) : 0;
      if (versions !== 2)
        fails.push(`expected 2 résumé versions after the revision, got ${versions}`);
      return fails;
    },
  },
  {
    id: "draft-answer-does-not-save",
    note: "draft_answer proposes; only the user's 'save it' writes — a draft must never land in the answer bank on its own",
    question: "Draft an answer for the why-do-you-want-to-work-here question.",
    seed: (db) => {
      saveProfile(db, PROFILE);
      const app = createApplication(db, {
        jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
        jdText:
          "Acme builds ML infrastructure for healthcare. We need Python, distributed systems, and production ML experience.",
      });
      createPipelineTask(db, { applicationId: app.id });
      return app.id;
    },
    check: (r, db) => {
      const fails: string[] = [];
      const step = r.steps.find((s) => s.tool === "draft_answer" && s.ok);
      if (!step) fails.push("did not call draft_answer (successfully)");
      else if (/\(0 chars\)/.test(step.summary)) fails.push("drafted an empty answer");
      if (r.answer.trim().length < 40) fails.push("answer does not show the draft to the user");
      if (listAnswers(db).length > 0) fails.push("wrote the draft into the answer bank unasked");
      return fails;
    },
  },
];

/** The scoped fixtures seed exactly one application — read it back for checks. */
function firstApp(db: Db) {
  return listApplications(db)[0];
}
