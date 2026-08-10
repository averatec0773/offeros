import { PIPELINE_STEPS } from "@offeros/core";
import { diagnoseFill, type FillDiagnosis } from "@offeros/autofill";
import { listApplications, getApplication } from "../repositories/application-repo";
import { listAgentTasks, getAgentTask } from "../repositories/agent-task-repo";
import { newestTaskByApplication } from "../repositories/agent-task-by-application";
import { listTrace } from "../repositories/agent-trace-repo";
import { listAnswers } from "../repositories/answer-repo";
import { getFit } from "../repositories/fit-repo";
import { getProfile } from "../repositories/profile-repo";
import { listResumes } from "../services/resume-service";
import { formMemorySummary, listIncidents } from "../repositories/form-memory-repo";
import { buildInbox } from "../services/attention-service";
import type { Tool, ToolContext } from "./types";

/**
 * What the agent can look at.
 *
 * The registry it started with could only ACT — tailor, generate, open a fill
 * ticket, mark submitted. An agent with hands and no eyes cannot answer "why
 * did this one stall", which is the question worth answering: the fill engine
 * already records, per field, what it chose and why, and nobody reads it back.
 *
 * Every tool here is read-only, so none of them needs `verify` in the sense the
 * acting tools do — there is no world-change to confirm. They still go through
 * `runTool`, because the trace is as useful for "what did the agent look at"
 * as for "what did it change".
 *
 * They return summaries, not objects. A fill report is seventy rows; handing
 * the model all of them on every turn crowds out the reasoning. The shape is
 * always: counts and the few rows that need attention, plus enough identity
 * for the agent to ask for more.
 */

/** How many rows any one read may put in front of the model. */
const ROW_BUDGET = 12;

export interface ApplicationLine {
  id: string;
  company: string;
  title: string;
  status: string;
  /** Where its newest task is parked, in the words the pipeline uses. */
  step?: string;
  taskStatus?: string;
}

/** Everything in flight, one line each. The agent's starting picture. */
export const listApplicationsTool: Tool<void, { applications: ApplicationLine[] }> = {
  id: "list_applications",
  description:
    "List the user's applications with their current pipeline step. Start here when the question is about more than one job, or when you do not know which application is meant.",
  run: async (ctx) => {
    const apps = listApplications(ctx.db);
    const byApp = newestTaskByApplication(listAgentTasks(ctx.db));
    const applications = apps.map((a): ApplicationLine => {
      const task = byApp.get(a.id);
      return {
        id: a.id,
        company: a.jobInfo.companyName,
        title: a.jobInfo.jobTitle,
        status: a.status,
        ...(task ? { step: PIPELINE_STEPS[task.step]?.key, taskStatus: task.status } : {}),
      };
    });
    return {
      ok: true,
      summary: `${applications.length} applications`,
      result: { applications },
    };
  },
  verify: async () => null,
};

/**
 * The last fill, grouped by why it did not finish.
 *
 * The tool deliberately does NOT hand over the rows. Eighteen failed fields is
 * a wall; four causes is a to-do list, and turning one into the other is a
 * lookup over reason strings our own engine wrote — deterministic, testable,
 * free. Leaving that to the model would be paying for judgement on a question
 * that has an exact answer, and getting a different grouping each time.
 *
 * What is left for the model is the part that needs judgement: which of these
 * causes matters to this person now, and how to put it.
 */
export const readFillReportTool: Tool<void, FillDiagnosis> = {
  id: "read_fill_report",
  description:
    "Diagnose the last fill for this application: how many fields filled, and the reasons the rest did not, grouped by cause with the field names under each. Use this for any question about why a form did not complete.",
  run: async (ctx) => {
    const task = ctx.taskId ? getAgentTask(ctx.db, ctx.taskId) : undefined;
    const reports = task?.fieldReports ?? [];
    const diagnosis = diagnoseFill(reports);
    if (reports.length === 0) {
      return { ok: true, summary: "no fill has run for this application yet", result: diagnosis };
    }
    const causeCount = diagnosis.causes.length;
    return {
      ok: true,
      summary: `${diagnosis.filled} of ${diagnosis.total} fields filled; ${causeCount === 0 ? "nothing outstanding" : `${causeCount} reason${causeCount === 1 ? "" : "s"} it did not finish`}`,
      result: diagnosis,
    };
  },
  verify: async () => null,
};

export interface TraceLine {
  tool: string;
  ok: boolean;
  summary: string;
  failure?: string;
}

/** What the agent itself has already done on this application. */
export const readTraceTool: Tool<void, { entries: TraceLine[] }> = {
  id: "read_trace",
  description:
    "Read what has already been attempted on this application, newest last. Use it before repeating an action, and to explain what happened.",
  run: async (ctx) => {
    const entries = listTrace(ctx.db, ctx.applicationId)
      .slice(-ROW_BUDGET)
      .map((t): TraceLine => ({
        tool: t.tool,
        ok: t.ok,
        summary: t.summary,
        ...(t.failureKind ? { failure: `${t.failureKind}: ${t.failureReason ?? ""}` } : {}),
      }));
    return {
      ok: true,
      summary: entries.length ? `${entries.length} recent steps` : "nothing recorded yet",
      result: { entries },
    };
  },
  verify: async () => null,
};

/**
 * Answers the user has approved before.
 *
 * Matching happens in the fill engine; this exists so the agent can tell the
 * difference between "we have never been asked this" and "we have an answer and
 * it did not match" — two situations that look identical from a blank field and
 * call for opposite responses.
 */
export const searchAnswersTool: Tool<{ query: string }, { matches: string[]; total: number }> = {
  id: "search_answers",
  description:
    "Search the user's saved answers by keyword. Use it to check whether a question the form asked has already been answered before.",
  parse: (input) => {
    const query = (input as { query?: unknown } | null)?.query;
    if (typeof query !== "string" || query.trim() === "") throw new Error("query is required");
    return { query: query.trim() };
  },
  run: async (ctx, input) => {
    const needle = input.query.toLowerCase();
    const hits = listAnswers(ctx.db).filter((a) =>
      a.questionPatterns.some((p) => p.toLowerCase().includes(needle)),
    );
    return {
      ok: true,
      summary: hits.length ? `${hits.length} saved answers match` : "no saved answer matches",
      result: {
        total: hits.length,
        matches: hits
          .slice(0, ROW_BUDGET)
          .map((a) => `${a.questionPatterns[0]} → ${a.answer.slice(0, 80)}`),
      },
    };
  },
  verify: async () => null,
};

export interface JobDetail {
  company: string;
  title: string;
  status: string;
  step?: string;
  applyLink?: string;
  fit?: { overall: number; label: string };
}

/** One application in full, for when the agent has narrowed down to it. */
export const readApplicationTool: Tool<void, JobDetail> = {
  id: "read_application",
  description:
    "Read one application's job, current step, and fit score. Use after list_applications when the question is about a specific job.",
  run: async (ctx) => {
    const app = getApplication(ctx.db, ctx.applicationId);
    if (!app) {
      return {
        ok: false,
        summary: "no such application",
        failure: { kind: "precondition", reason: `application ${ctx.applicationId} not found` },
      };
    }
    const task = ctx.taskId ? getAgentTask(ctx.db, ctx.taskId) : undefined;
    const fit = getFit(ctx.db, ctx.applicationId);
    return {
      ok: true,
      summary: `${app.jobInfo.jobTitle} at ${app.jobInfo.companyName}`,
      result: {
        company: app.jobInfo.companyName,
        title: app.jobInfo.jobTitle,
        status: app.status,
        ...(task ? { step: PIPELINE_STEPS[task.step]?.key } : {}),
        ...(app.jobInfo.applyLink ? { applyLink: app.jobInfo.applyLink } : {}),
        ...(fit ? { fit: { overall: fit.overall, label: fit.label } } : {}),
      },
    };
  },
  verify: async () => null,
};

/** The user's profile in summary: who the forms say they are, and which
 *  résumés exist. Summary on purpose — the agent needs "is there a phone
 *  number, which résumé is primary", not the document itself. */
export const readProfileTool: Tool<
  void,
  {
    personal: Record<string, string>;
    skills: string[];
    resumes: { name: string; primary: boolean; hasText: boolean }[];
  }
> = {
  id: "read_profile",
  description:
    "Read the user's profile summary: personal contact fields, skills, and which résumés exist (and whether each has extracted text). Use before answering questions about the profile or proposing profile changes.",
  run: async (ctx) => {
    const profile = getProfile(ctx.db);
    if (!profile) {
      return {
        ok: false,
        summary: "no profile exists yet",
        failure: { kind: "precondition", reason: "the user has not set up a profile" },
      };
    }
    const personal = Object.fromEntries(
      Object.entries(profile.personal).filter(
        ([k, v]) => typeof v === "string" && v && k !== "links",
      ),
    ) as Record<string, string>;
    const resumes = listResumes(ctx.db).map((r) => ({
      name: r.name,
      primary: r.isPrimary,
      hasText: Boolean(r.text),
    }));
    return {
      ok: true,
      summary: `profile: ${Object.keys(personal).length} personal fields, ${profile.skills.length} skills, ${resumes.length} résumé(s)`,
      result: { personal, skills: profile.skills.slice(0, ROW_BUDGET * 2), resumes },
    };
  },
  verify: async () => null,
};

/** What the fill engine has learned across every application — the memory the
 *  learning loop writes. First real consumer of `fill_incidents`. */
export const readFormMemoryTool: Tool<
  { applicationId?: string } | void,
  {
    knownQuestions: number;
    recurringQuestions: number;
    failedQuestions: number;
    incidents: { trigger: string; summary: string }[];
  }
> = {
  id: "read_form_memory",
  description:
    'Read what the fill engine has learned: how many distinct questions it has met, which recur, and the recorded incidents (things that genuinely went wrong). Pass {"applicationId":"<id>"} to see one application\'s incidents, or nothing for the campaign-wide picture.',
  parse: (input) => {
    const id = (input as Record<string, unknown> | null)?.applicationId;
    return typeof id === "string" && id !== "" ? { applicationId: id } : undefined;
  },
  run: async (ctx, input) => {
    const summary = formMemorySummary(ctx.db);
    const incidents = listIncidents(ctx.db, input?.applicationId)
      .slice(0, ROW_BUDGET)
      .map((row) => ({ trigger: row.triggerId, summary: row.summary }));
    return {
      ok: true,
      summary: `${summary.knownQuestions} questions known, ${summary.recurringQuestions} recurring, ${incidents.length} incident(s)${input?.applicationId ? " on this application" : ""}`,
      result: {
        knownQuestions: summary.knownQuestions,
        recurringQuestions: summary.recurringQuestions,
        failedQuestions: summary.failedQuestions,
        incidents,
      },
    };
  },
  verify: async () => null,
};

/** Everything currently waiting on the user, in priority order — the same
 *  deterministic inbox the console shows. The agent READS it; it never
 *  generates it. */
export const readInboxTool: Tool<
  void,
  { items: { kind: string; summary: string; applicationId: string }[] }
> = {
  id: "read_inbox",
  description:
    "Read the needs-you inbox: everything currently waiting on the user across all applications, in priority order. Use for questions like 'what needs me' or 'what should I do first'.",
  run: async (ctx) => {
    const items = buildInbox(ctx.db)
      .slice(0, ROW_BUDGET)
      .map((item) => ({
        kind: item.kind,
        summary: `${item.headline} (${item.jobTitle} at ${item.companyName})${item.detail ? ` — ${item.detail}` : ""}`,
        applicationId: item.applicationId,
      }));
    return {
      ok: true,
      summary:
        items.length === 0
          ? "nothing is waiting on the user"
          : `${items.length} item(s) waiting on the user`,
      result: { items },
    };
  },
  verify: async () => null,
};

/** Every read the agent may perform, by id. */
export const READ_TOOLS = {
  [listApplicationsTool.id]: listApplicationsTool,
  [readApplicationTool.id]: readApplicationTool,
  [readFillReportTool.id]: readFillReportTool,
  [readTraceTool.id]: readTraceTool,
  [searchAnswersTool.id]: searchAnswersTool,
  [readProfileTool.id]: readProfileTool,
  [readFormMemoryTool.id]: readFormMemoryTool,
  [readInboxTool.id]: readInboxTool,
} as const;

/** A tool's id and description, which is all the model needs to choose one. */
export function toolMenu(tools: Record<string, { id: string; description: string }>): string {
  return Object.values(tools)
    .map((t) => `- ${t.id}: ${t.description}`)
    .join("\n");
}

export type { ToolContext };
