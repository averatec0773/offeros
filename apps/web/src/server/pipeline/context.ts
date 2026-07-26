import {
  callProvider as realCallProvider,
  getTask,
  runTask,
  type LlmProvider,
  type ProviderCallArgs,
  type RunTaskDeps,
} from "@offeros/llm";
import type { Db } from "../db/client";
import {
  createApplication,
  getApplication,
  listApplications,
  updateApplication,
} from "../repositories/application-repo";
import {
  createAgentTask,
  getAgentTask,
  listAgentTasks,
  updateAgentTask,
} from "../repositories/agent-task-repo";
import { getAgentTaskByApplicationId } from "../repositories/agent-task-by-application";
import { getJdAnalysis, saveJdAnalysis } from "../repositories/jd-analysis-repo";
import { getArtifact, listArtifacts, upsertArtifact } from "../repositories/artifact-repo";
import { getProfile, saveProfile } from "../repositories/profile-repo";
import { getSettings, saveSettings } from "../repositories/settings-repo";
import { getDefaultTemplate } from "../repositories/template-repo";
import { listResumes } from "../services/resume-service";
import { STEPS } from "./steps";
import type { PipelineContext, PipelineStep } from "./types";

/**
 * Repositories bound to a single `db`, so step bodies never touch SQL or thread
 * a `db` handle around. This is the seam Task 5's real steps read/write through.
 */
export function makeRepos(db: Db) {
  return {
    getApplication: (id: string) => getApplication(db, id),
    listApplications: () => listApplications(db),
    createApplication: (input: Parameters<typeof createApplication>[1]) =>
      createApplication(db, input),
    updateApplication: (id: string, patch: Parameters<typeof updateApplication>[2]) =>
      updateApplication(db, id, patch),

    getAgentTask: (id: string) => getAgentTask(db, id),
    listAgentTasks: () => listAgentTasks(db),
    createAgentTask: (input: Parameters<typeof createAgentTask>[1]) => createAgentTask(db, input),
    updateAgentTask: (id: string, patch: Parameters<typeof updateAgentTask>[2]) =>
      updateAgentTask(db, id, patch),
    getAgentTaskByApplicationId: (applicationId: string) =>
      getAgentTaskByApplicationId(db, applicationId),

    getJdAnalysis: (applicationId: string) => getJdAnalysis(db, applicationId),
    saveJdAnalysis: (analysis: Parameters<typeof saveJdAnalysis>[1]) =>
      saveJdAnalysis(db, analysis),

    getArtifact: (taskId: string, kind: Parameters<typeof getArtifact>[2]) =>
      getArtifact(db, taskId, kind),
    listArtifacts: (taskId: string) => listArtifacts(db, taskId),
    upsertArtifact: (artifact: Parameters<typeof upsertArtifact>[1]) =>
      upsertArtifact(db, artifact),

    getProfile: () => getProfile(db),
    saveProfile: (profile: Parameters<typeof saveProfile>[1]) => saveProfile(db, profile),

    listResumes: () => listResumes(db),

    getSettings: () => getSettings(db),
    saveSettings: (next: Parameters<typeof saveSettings>[1]) => saveSettings(db, next),

    getDefaultTemplate: (kind: string) => getDefaultTemplate(db, kind),
  };
}

export type PipelineRepos = ReturnType<typeof makeRepos>;

function apiKeyFor(provider: LlmProvider): string {
  if (provider === "openai") return process.env.OPENAI_API_KEY ?? "";
  return process.env.ANTHROPIC_API_KEY ?? "";
}

export interface PipelineContextOptions {
  /** Injectable provider transport; defaults to the real `@offeros/llm` one. */
  callProvider?: (provider: LlmProvider, args: ProviderCallArgs) => Promise<string>;
  /** Override the whole LLM entry point (tests fake this to avoid any provider). */
  runLlm?: (taskId: string, input: unknown) => Promise<unknown>;
  /** Override the step registry (tests inject controllable placeholder steps). */
  steps?: PipelineStep[];
}

/**
 * Build a context for one task. `runLlm` assembles `RunTaskDeps` from the
 * settings repo (provider/model) plus the injected `callProvider`, so callers
 * never construct LLM deps by hand and tests can bypass the network entirely.
 */
export function makePipelineContext(
  db: Db,
  taskId: string,
  opts: PipelineContextOptions = {},
): PipelineContext {
  const repos = makeRepos(db);
  const callProvider = opts.callProvider ?? realCallProvider;

  const runLlm =
    opts.runLlm ??
    ((llmTaskId: string, input: unknown) => {
      const settings = repos.getSettings();
      const provider = settings.llm.provider;
      const deps: RunTaskDeps = {
        getTask,
        getOverride: async (id) => settings.llm.promptOverrides[id] || null,
        getModelOverride: async (id) => settings.llm.modelOverrides[id] || null,
        getProvider: async () => provider,
        getKey: async () => apiKeyFor(provider),
        getModel: async () => settings.llm.model ?? "",
        callProvider,
      };
      return runTask(llmTaskId, input, deps);
    });

  return {
    db,
    taskId,
    runLlm,
    repos,
    steps: opts.steps ?? STEPS,
  };
}
