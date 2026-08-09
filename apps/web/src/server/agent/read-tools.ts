import { PIPELINE_STEPS } from "@offeros/core";
import { listApplications, getApplication } from "../repositories/application-repo";
import { listAgentTasks, getAgentTask } from "../repositories/agent-task-repo";
import { newestTaskByApplication } from "../repositories/agent-task-by-application";
import { listTrace } from "../repositories/agent-trace-repo";
import { listAnswers } from "../repositories/answer-repo";
import { getFit } from "../repositories/fit-repo";
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

export interface FieldLine {
  label: string;
  outcome: string;
  reason?: string;
}

/**
 * The per-field record of the last fill.
 *
 * This is the tool the whole idea rests on. The extension writes a decision
 * trace for every field — what it classified it as, what it chose, and a
 * plain-language reason — and that record is what lets an agent say "three of
 * these are one broken question" instead of listing seventeen red rows.
 *
 * Only the fields that did NOT succeed come back. A filled field has nothing
 * to diagnose, and the counts already say how many there were.
 */
export const readFillReportTool: Tool<
  void,
  { total: number; filled: number; needsAttention: FieldLine[]; truncated: number }
> = {
  id: "read_fill_report",
  description:
    "Read the last fill's per-field outcome for this application: how many fields were filled, and the ones that were not, each with the reason the engine recorded. Use this for any question about why a form did not complete.",
  run: async (ctx) => {
    const task = ctx.taskId ? getAgentTask(ctx.db, ctx.taskId) : undefined;
    const reports = task?.fieldReports ?? [];
    if (reports.length === 0) {
      return {
        ok: true,
        summary: "no fill has run for this application yet",
        result: { total: 0, filled: 0, needsAttention: [], truncated: 0 },
      };
    }
    const filled = reports.filter((r) => r.outcome === "filled").length;
    const problems = reports.filter((r) => r.outcome !== "filled" && r.outcome !== "skipped");
    const needsAttention = problems.slice(0, ROW_BUDGET).map((r): FieldLine => ({
      label: r.label || r.fieldId,
      outcome: r.outcome,
      ...(r.reason ? { reason: r.reason } : {}),
    }));
    return {
      ok: true,
      summary: `${filled} of ${reports.length} fields filled, ${problems.length} need attention`,
      result: {
        total: reports.length,
        filled,
        needsAttention,
        truncated: Math.max(0, problems.length - needsAttention.length),
      },
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

/** Every read the agent may perform, by id. */
export const READ_TOOLS = {
  [listApplicationsTool.id]: listApplicationsTool,
  [readApplicationTool.id]: readApplicationTool,
  [readFillReportTool.id]: readFillReportTool,
  [readTraceTool.id]: readTraceTool,
  [searchAnswersTool.id]: searchAnswersTool,
} as const;

/** A tool's id and description, which is all the model needs to choose one. */
export function toolMenu(tools: Record<string, { id: string; description: string }>): string {
  return Object.values(tools)
    .map((t) => `- ${t.id}: ${t.description}`)
    .join("\n");
}

export type { ToolContext };
