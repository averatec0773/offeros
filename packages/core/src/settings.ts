import { z } from "zod";

export const agentSettingsSchema = z.object({
  enableCustomizeResume: z.boolean().default(true),
  enableCustomizeCoverLetter: z.boolean().default(true),
  useOriginalResume: z.boolean().default(false),
  autoConfirm: z.boolean().default(false),
  /**
   * Let the agent press submit on the ATS itself, instead of stopping so the
   * user can. Off by default and deliberately explicit: the submit gate is the
   * last point at which a mistake is still cheap, and an application sent on
   * someone's behalf cannot be recalled. The setting exists because the owner
   * asked for it; the disclosure beside it is part of the feature, not decoration.
   */
  autoSubmit: z.boolean().default(false),
});

export const llmSettingsSchema = z.object({
  // Mirrors `LLM_PROVIDERS` in packages/llm/src/models.ts. core cannot import
  // llm (layering: llm depends on core, not the reverse), so this list is
  // duplicated by hand — a web test asserts the two stay in sync.
  provider: z.enum(["anthropic", "openai"]).default("anthropic"),
  model: z.string().optional(),
  // Per-task overrides, keyed by TaskId (e.g. "resume-tailor", "jd-analysis",
  // "cover-letter"). An override present here beats the task's default system
  // prompt / the global model choice; see @offeros/llm's runTask.
  promptOverrides: z.record(z.string()).default({}),
  modelOverrides: z.record(z.string()).default({}),
  // API keys the user has saved in-app, keyed by provider id. Resolution
  // precedence (settings-first, env fallback) lives in the web app's
  // `apiKeyFor`; this schema only stores what the user typed.
  apiKeys: z.record(z.string()).default({}),
});

export const settingsSchema = z.object({
  agent: agentSettingsSchema.default({}),
  llm: llmSettingsSchema.default({}),
});

export type AgentSettings = z.infer<typeof agentSettingsSchema>;
export type Settings = z.infer<typeof settingsSchema>;
