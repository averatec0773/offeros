import { z } from "zod";

export const agentSettingsSchema = z.object({
  enableCustomizeResume: z.boolean().default(true),
  enableCustomizeCoverLetter: z.boolean().default(true),
  useOriginalResume: z.boolean().default(false),
  autoConfirm: z.boolean().default(false),
});

export const llmSettingsSchema = z.object({
  provider: z.enum(["anthropic", "openai"]).default("anthropic"),
  model: z.string().optional(),
  // Per-task overrides, keyed by TaskId (e.g. "resume-tailor", "jd-analysis",
  // "cover-letter"). An override present here beats the task's default system
  // prompt / the global model choice; see @offeros/llm's runTask.
  promptOverrides: z.record(z.string()).default({}),
  modelOverrides: z.record(z.string()).default({}),
});

export const settingsSchema = z.object({
  agent: agentSettingsSchema.default({}),
  llm: llmSettingsSchema.default({}),
});

export type AgentSettings = z.infer<typeof agentSettingsSchema>;
export type Settings = z.infer<typeof settingsSchema>;
