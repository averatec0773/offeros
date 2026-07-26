import { LlmError } from "./errors";
import { resolveModel } from "./models";
import type { LlmProvider, ProviderCallArgs } from "./providers/types";
import type { LlmTask, TaskId } from "./task";

export interface RunTaskDeps {
  getTask: (id: string) => LlmTask | null;
  getOverride: (id: TaskId) => Promise<string | null>;
  getModelOverride: (id: TaskId) => Promise<string | null>;
  getProvider: () => Promise<LlmProvider>;
  getKey: () => Promise<string>;
  getModel: () => Promise<string>;
  callProvider: (provider: LlmProvider, args: ProviderCallArgs) => Promise<string>;
}

export async function runTask(taskId: string, input: unknown, deps: RunTaskDeps): Promise<unknown> {
  const task = deps.getTask(taskId);
  if (!task) throw new LlmError("unknown_task", `Unknown task: ${taskId}`);

  const provider = await deps.getProvider();
  const key = await deps.getKey();
  const userModel = await deps.getModel();
  const override = await deps.getOverride(task.id);
  const modelOverride = await deps.getModelOverride(task.id);
  const raw = await deps.callProvider(provider, {
    key,
    system: override ?? task.defaultSystemPrompt,
    userPrompt: task.buildUserPrompt(input),
    schema: task.schema,
    // per-task user override (validated against the provider) > task pin > global choice
    model:
      resolveModel(provider, modelOverride ?? "") ??
      task.model ??
      resolveModel(provider, userModel),
    maxTokens: task.maxTokens ?? 4096,
  });
  return task.parse(raw);
}
