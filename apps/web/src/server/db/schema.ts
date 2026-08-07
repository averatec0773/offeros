import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type {
  JobInfo,
  Profile,
  ApplicationInfo,
  Settings,
  AnswerEntry,
  JdAnalysis,
  Artifact,
  FieldReport,
  Template,
  FitAnalysis,
} from "@offeros/core";

/** Singleton row (id = "me") holding the profile document. */
export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  doc: text("doc", { mode: "json" }).$type<Profile>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const answers = sqliteTable("answers", {
  id: text("id").primaryKey(),
  doc: text("doc", { mode: "json" }).$type<AnswerEntry>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const resumes = sqliteTable("resumes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  targetRole: text("target_role"),
  note: text("note"),
  text: text("text"),
  filePath: text("file_path"),
  createdAt: integer("created_at").notNull(),
});

export const applications = sqliteTable("applications", {
  id: text("id").primaryKey(),
  jobInfo: text("job_info", { mode: "json" }).$type<JobInfo>().notNull(),
  status: text("status").notNull(),
  jdText: text("jd_text"),
  notes: text("notes"),
  resumeId: text("resume_id"),
  attachResume: text("attach_resume"),
  appliedAt: integer("applied_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const agentTasks = sqliteTable("agent_tasks", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull(),
  status: text("status").notNull(),
  step: integer("step").notNull().default(0),
  applicationInfo: text("application_info", { mode: "json" }).$type<ApplicationInfo>(),
  resumeId: text("resume_id"),
  coverLetterId: text("cover_letter_id"),
  coverLetterRequirement: text("cover_letter_requirement").notNull().default("unknown"),
  skippedCoverLetter: integer("skipped_cover_letter", { mode: "boolean" }).notNull().default(false),
  fillFirst: integer("fill_first", { mode: "boolean" }).notNull().default(false),
  fieldReports: text("field_reports", { mode: "json" }).$type<FieldReport[]>(),
  failureReason: text("failure_reason"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(),
  doc: text("doc", { mode: "json" }).$type<Settings>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const jdAnalyses = sqliteTable("jd_analyses", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull(),
  doc: text("doc", { mode: "json" }).$type<JdAnalysis>().notNull(),
  createdAt: integer("created_at").notNull(),
});

export const fitAnalyses = sqliteTable("fit_analyses", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull(),
  doc: text("doc", { mode: "json" }).$type<FitAnalysis>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  kind: text("kind").notNull(),
  doc: text("doc", { mode: "json" }).$type<Artifact>().notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const templates = sqliteTable("templates", {
  id: text("id").primaryKey(),
  doc: text("doc", { mode: "json" }).$type<Template>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const fillHandoffs = sqliteTable("fill_handoffs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  applicationId: text("application_id").notNull(),
  applyLink: text("apply_link"),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Append-only bookkeeping log, one row per notable pipeline occurrence. See
 *  `@offeros/core`'s `applicationEventSchema` for the shape `doc` round-trips. */
export const applicationEvents = sqliteTable("application_events", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull(),
  kind: text("kind").notNull(),
  at: integer("at").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
});

/** One row per style-memory kind ("resume" | "cover-letter"), keyed by `kind`.
 *  Owned by `style-memory-repo.ts`; see `server/memory/style-memory.ts` for
 *  the pluggable contract this backs. */
export const styleMemories = sqliteTable("style_memories", {
  kind: text("kind").primaryKey(),
  notes: text("notes").notNull().default(""),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sourceCount: integer("source_count").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const schema = {
  profiles,
  answers,
  resumes,
  applications,
  agentTasks,
  settings,
  jdAnalyses,
  fitAnalyses,
  artifacts,
  templates,
  fillHandoffs,
  applicationEvents,
  styleMemories,
};
