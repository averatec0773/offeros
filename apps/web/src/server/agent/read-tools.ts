import { PIPELINE_STEPS } from "@offeros/core";
import { diagnoseFill, type FillDiagnosis } from "@offeros/autofill";
import { listApplications, getApplication } from "../repositories/application-repo";
import { listPipelineTasks, getPipelineTask } from "../repositories/pipeline-task-repo";
import { newestTaskByApplication } from "../repositories/pipeline-task-by-application";
import { listTrace } from "../repositories/agent-trace-repo";
import { listAnswers } from "../repositories/answer-repo";
import { getFit } from "../repositories/fit-repo";
import { getProfile } from "../repositories/profile-repo";
import { listResumes } from "../services/resume-service";
import { getArtifact } from "../repositories/artifact-repo";
import { resolveEffectiveResume } from "../pipeline/steps/grounding";
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

/**
 * Everything in flight — as COUNTS first, rows second.
 *
 * This tool used to hand the model every application as a row, and the model
 * dutifully echoed the rows back: a real "summarise my applications" turn
 * produced nineteen bullet lines because nineteen lines is what the tool
 * said. The synthesis a summary needs (totals, the split by state) is
 * arithmetic, so it is computed HERE, deterministically — the model receives
 * the summary material, plus the most recent ROW_BUDGET rows for naming
 * individual jobs. `query` narrows by company/title when the user asked
 * about one job by name.
 */
export const listApplicationsTool: Tool<
  { query?: string } | void,
  { total: number; byStatus: Record<string, number>; applications: ApplicationLine[] }
> = {
  id: "list_applications",
  description:
    'List the user\'s applications: totals and a split by status, plus the most recent rows (capped). Pass {"query":"<company or title>"} to find a specific job\'s id by name. Start here when the question is about more than one job, or when you do not know which application is meant.',
  parse: (input) => {
    const query = (input as Record<string, unknown> | null)?.query;
    return typeof query === "string" && query.trim() !== "" ? { query: query.trim() } : undefined;
  },
  run: async (ctx, input) => {
    const byApp = newestTaskByApplication(listPipelineTasks(ctx.db));
    const needle = input?.query?.toLowerCase();
    const apps = listApplications(ctx.db).filter(
      (a) =>
        !needle ||
        a.jobInfo.companyName.toLowerCase().includes(needle) ||
        a.jobInfo.jobTitle.toLowerCase().includes(needle),
    );
    const lines = apps.map((a): ApplicationLine => {
      const task = byApp.get(a.id);
      return {
        id: a.id,
        company: a.jobInfo.companyName,
        title: a.jobInfo.jobTitle,
        status: a.status,
        ...(task ? { step: PIPELINE_STEPS[task.step]?.key, taskStatus: task.status } : {}),
      };
    });
    // The split the summary answer is made of: application status, refined by
    // where the task is parked when the application is still moving.
    const byStatus: Record<string, number> = {};
    for (const line of lines) {
      const key =
        line.status === "saved" || line.status === "applying"
          ? `${line.status}${line.step ? ` at ${line.step}` : ""}`
          : line.status;
      byStatus[key] = (byStatus[key] ?? 0) + 1;
    }
    const split = Object.entries(byStatus)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${k}`)
      .join(", ");
    return {
      ok: true,
      summary:
        lines.length === 0
          ? needle
            ? `no application matches "${input?.query}"`
            : "no applications"
          : `${lines.length} application${lines.length === 1 ? "" : "s"}${split ? ` — ${split}` : ""}`,
      result: {
        total: lines.length,
        byStatus,
        // Most recent first is how listApplications already orders; the cap
        // keeps one runaway list from eating the reasoning window.
        applications: lines.slice(0, ROW_BUDGET),
      },
    };
  },
  verify: async () => null,
};

/**
 * The last fill: what went IN, and what did not and why.
 *
 * The unfilled half is deliberately NOT rows. Eighteen failed fields is a
 * wall; four causes is a to-do list, and turning one into the other is a
 * lookup over reason strings our own engine wrote — deterministic, testable,
 * free. Leaving that to the model would be paying for judgement on a question
 * that has an exact answer, and getting a different grouping each time.
 *
 * The FILLED half IS rows — label, value, source — because a real question
 * ("show me what was filled in") was unanswerable without them: the diagnosis
 * alone let the agent say "15 of 17" and nothing more. Capped like every
 * other read; the totals say when rows were left out.
 */
export const readFillReportTool: Tool<
  void,
  FillDiagnosis & {
    /** total − skipped: the honest denominator for "how complete is this fill". */
    fillable: number;
    filledFields: { label: string; value?: string; source: string }[];
  }
> = {
  id: "read_fill_report",
  description:
    "Read the last fill for this application: the fields that WERE filled (label, value, where the value came from), and the reasons the rest did not fill, grouped by cause. Use this both for 'what was filled in' and for 'why did it not complete'.",
  run: async (ctx) => {
    const task = ctx.taskId ? getPipelineTask(ctx.db, ctx.taskId) : undefined;
    const reports = task?.fieldReports ?? [];
    const diagnosis = diagnoseFill(reports);
    const filledFields = reports
      .filter((r) => r.outcome === "filled")
      .slice(0, ROW_BUDGET)
      .map((r) => ({
        label: r.label || r.fieldId,
        ...(r.value ? { value: r.value.slice(0, 60) } : {}),
        source: r.source,
      }));
    if (reports.length === 0) {
      return {
        ok: true,
        summary: "no fill has run for this application yet",
        result: { ...diagnosis, fillable: 0, filledFields },
      };
    }
    const causeCount = diagnosis.causes.length;
    const shown =
      filledFields.length < diagnosis.filled
        ? ` (${filledFields.length} of them listed; the rest are standard fields)`
        : "";
    // Report against FILLABLE fields, not the raw total. `total` counts every
    // scanned control including the ones the engine deliberately skipped
    // (already filled by the page, or not a real question), so "23 of 73"
    // read as a near-failure when it was "23 of 41 fillable" — a 2026-08-10
    // audit finding, reproduced live. The full breakdown stays in `result`.
    const fillable = diagnosis.total - diagnosis.skipped;
    const skippedNote =
      diagnosis.skipped > 0 ? `; ${diagnosis.skipped} standard fields skipped` : "";
    return {
      ok: true,
      summary: `${diagnosis.filled} of ${fillable} fillable fields filled${shown}${skippedNote}; ${causeCount === 0 ? "nothing outstanding" : `${causeCount} reason${causeCount === 1 ? "" : "s"} it did not finish`}`,
      result: { ...diagnosis, fillable, filledFields },
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

/** How much of a job description one read may put in front of the model.
 *  Long enough to answer "what does this job want", short enough not to eat
 *  the whole observation window. */
const JD_BUDGET = 2000;

export interface JobDetail {
  company: string;
  title: string;
  status: string;
  step?: string;
  applyLink?: string;
  /** The job description text, if one was captured. Truncated to JD_BUDGET;
   *  `jdTruncated` says when there is more. Absent means no JD was stored
   *  (e.g. the job was added from an apply-only link with no description). */
  jdText?: string;
  jdTruncated?: boolean;
  /** The user's own note on this application, if they left one. */
  notes?: string;
  fit?: { overall: number; label: string; whyMatch?: string; gaps?: string[] };
}

/** One application in full, for when the agent has narrowed down to it. */
export const readApplicationTool: Tool<void, JobDetail> = {
  id: "read_application",
  description:
    "Read one application in full: the job, current step, fit score AND its gaps, the user's note, and the job description text (when one was captured). Use after list_applications for any question about a specific job — including 'what does this job want' or 'read me the JD'.",
  run: async (ctx) => {
    const app = getApplication(ctx.db, ctx.applicationId);
    if (!app) {
      return {
        ok: false,
        summary: "no such application",
        failure: { kind: "precondition", reason: `application ${ctx.applicationId} not found` },
      };
    }
    const task = ctx.taskId ? getPipelineTask(ctx.db, ctx.taskId) : undefined;
    const fit = getFit(ctx.db, ctx.applicationId);
    const jd = app.jdText?.trim() ?? "";
    return {
      ok: true,
      summary: `${app.jobInfo.jobTitle} at ${app.jobInfo.companyName}${jd ? "" : " (no JD stored)"}`,
      result: {
        company: app.jobInfo.companyName,
        title: app.jobInfo.jobTitle,
        status: app.status,
        ...(task ? { step: PIPELINE_STEPS[task.step]?.key } : {}),
        ...(app.jobInfo.applyLink ? { applyLink: app.jobInfo.applyLink } : {}),
        ...(jd ? { jdText: jd.slice(0, JD_BUDGET) } : {}),
        ...(jd.length > JD_BUDGET ? { jdTruncated: true } : {}),
        ...(app.notes?.trim() ? { notes: app.notes.trim() } : {}),
        ...(fit
          ? {
              fit: {
                overall: fit.overall,
                label: fit.label,
                ...(fit.whyMatch ? { whyMatch: fit.whyMatch } : {}),
                ...(fit.notAlignedSkills.length > 0
                  ? { gaps: fit.notAlignedSkills.slice(0, ROW_BUDGET).map((g) => g.skill) }
                  : {}),
              },
            }
          : {}),
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

/** How much document text one read may put in front of the model. Long enough
 *  to analyse or quote a résumé, short enough not to eat the whole window. */
const DOC_BUDGET = 6000;

/** The user's actual résumé text — the thing "read/analyse my résumé" needs.
 *  Returns the effective résumé's stored text (the application's selected one,
 *  else the primary). Honest when a résumé exists but its text was never
 *  extracted: it says so and points at the structured profile, rather than the
 *  dead "I can't read it" the old hasText boolean produced. */
export const readResumeTool: Tool<
  void,
  { name?: string; text?: string; truncated?: boolean; hasText: boolean }
> = {
  id: "read_resume",
  description:
    "Read the text of the user's own uploaded résumé (the selected one for this application, else the primary). Use for 'read/analyse my résumé' or any question about what the résumé says. If the résumé has no extracted text, this says so — fall back to read_profile for the structured work history and skills.",
  run: async (ctx) => {
    const app = getApplication(ctx.db, ctx.applicationId);
    const resume = resolveEffectiveResume({ resumeId: app?.resumeId }, listResumes(ctx.db));
    if (!resume) {
      return {
        ok: true,
        summary: "no résumé on file",
        result: { hasText: false },
      };
    }
    const text = resume.text?.trim() ?? "";
    if (!text) {
      return {
        ok: true,
        summary: `résumé "${resume.name}" has no extracted text`,
        result: { name: resume.name, hasText: false },
      };
    }
    return {
      ok: true,
      summary: `résumé "${resume.name}" (${text.length} chars)`,
      result: {
        name: resume.name,
        text: text.slice(0, DOC_BUDGET),
        ...(text.length > DOC_BUDGET ? { truncated: true } : {}),
        hasText: true,
      },
    };
  },
  verify: async () => null,
};

/** What the agent GENERATED for this job — the tailored résumé or the cover
 *  letter — read back so it can be shown, quoted, or iterated on. This is the
 *  fix for "you made a résumé and I never saw it": the content was always
 *  stored, just unreachable. */
export const readArtifactTool: Tool<
  { kind: "resume" | "cover-letter" },
  { kind: string; version: number; content: string; truncated?: boolean; rationale?: string }
> = {
  id: "read_artifact",
  description:
    'Read the current text of something the agent generated for THIS application — a tailored résumé or a cover letter. Input {"kind":"resume"} or {"kind":"cover-letter"}. Use right after tailor_resume / generate_cover_letter to show the user what was produced, or when they ask to see the generated résumé/letter.',
  parse: (input) => {
    const kind = (input as { kind?: unknown } | null)?.kind;
    if (kind !== "resume" && kind !== "cover-letter") {
      throw new Error('kind must be "resume" or "cover-letter"');
    }
    return { kind };
  },
  run: async (ctx, input) => {
    if (!ctx.taskId) {
      return {
        ok: false,
        summary: "no task for this application yet",
        failure: { kind: "precondition", reason: "nothing has been generated for this job" },
      };
    }
    const noun = input.kind === "resume" ? "tailored résumé" : "cover letter";
    const artifact = getArtifact(ctx.db, ctx.taskId, input.kind);
    const version = artifact?.versions.find((v) => v.id === artifact.currentVersionId);
    if (!artifact || !version) {
      return {
        ok: false,
        summary: `no ${noun} has been generated yet`,
        failure: { kind: "precondition", reason: `no ${input.kind} artifact for this task` },
      };
    }
    const content = version.content.trim();
    return {
      ok: true,
      summary: `${noun} v${artifact.versions.length} (${content.length} chars)`,
      result: {
        kind: input.kind,
        version: artifact.versions.length,
        content: content.slice(0, DOC_BUDGET),
        ...(content.length > DOC_BUDGET ? { truncated: true } : {}),
        ...(version.rationale ? { rationale: version.rationale } : {}),
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
  [readProfileTool.id]: readProfileTool,
  [readResumeTool.id]: readResumeTool,
  [readArtifactTool.id]: readArtifactTool,
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
