import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { saveSettings } from "../../repositories/settings-repo";
import { getApplication, listApplications } from "../../repositories/application-repo";
import { getPipelineTaskByApplicationId } from "../../repositories/pipeline-task-by-application";
import { makeAgentLlm } from "../agent-llm";
import { runTurn } from "../loop";
import { EVAL_FIXTURES } from "./fixtures";

/**
 * Behavioral eval harness — the thing that turns "the owner hits the chat and
 * eyeballs it" into a pass/fail number, seeded from real shipped regressions
 * (fixtures.ts).
 *
 * It calls a REAL provider, so it is OPT-IN and never runs in CI: set
 * OFFEROS_EVAL=1 and a provider key. The key stays in the shell (the owner's
 * key discipline) — it is read from the environment here, seeded into the
 * throwaway settings row, and never logged.
 *
 *   OFFEROS_EVAL=1 OFFEROS_EVAL_PROVIDER=anthropic \
 *     ANTHROPIC_API_KEY=sk-... npx vitest run apps/web/src/server/agent/__evals__
 *
 * K runs per fixture (OFFEROS_EVAL_K, default 1) surface consistency: a
 * scenario is reported by its pass rate, not a single lucky/unlucky roll.
 */

const RUN = process.env.OFFEROS_EVAL === "1";
const PROVIDER = (process.env.OFFEROS_EVAL_PROVIDER ?? "anthropic") as "anthropic" | "openai";
const KEY = PROVIDER === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
const K = Math.max(1, Number(process.env.OFFEROS_EVAL_K ?? "1"));

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-eval-"));
  db = createDb(join(dir, "t.db"));
  // Provider + key live only in this throwaway DB's settings for the run.
  saveSettings(db, {
    agent: {
      enableCustomizeResume: true,
      enableCustomizeCoverLetter: true,
      useOriginalResume: false,
      autoConfirm: false,
      autoSubmit: false,
    },
    llm: {
      provider: PROVIDER,
      promptOverrides: {},
      modelOverrides: {},
      apiKeys: KEY ? { [PROVIDER]: KEY } : {},
    },
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!RUN)(`agent behavioral eval (provider: ${PROVIDER}, K=${K})`, () => {
  if (RUN && !KEY) {
    it("has a provider key", () => {
      throw new Error(
        `OFFEROS_EVAL=1 but no ${PROVIDER === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} in the environment`,
      );
    });
    return;
  }

  for (const fx of EVAL_FIXTURES) {
    it(
      `${fx.id} — ${fx.note}`,
      async () => {
        let passes = 0;
        const allFails: string[] = [];
        for (let run = 0; run < K; run++) {
          // Fresh seed per run so writes from one run never leak into the next.
          rmSync(join(dir, "t.db"), { force: true });
          db = createDb(join(dir, "t.db"));
          saveSettings(db, {
            agent: {
              enableCustomizeResume: true,
              enableCustomizeCoverLetter: true,
              useOriginalResume: false,
              autoConfirm: false,
              autoSubmit: false,
            },
            llm: {
              provider: PROVIDER,
              promptOverrides: {},
              modelOverrides: {},
              apiKeys: KEY ? { [PROVIDER]: KEY } : {},
            },
          });
          const applicationId = fx.seed(db);
          const focus = (id: string) => {
            if (!getApplication(db, id)) return null;
            const task = getPipelineTaskByApplicationId(db, id);
            return { applicationId: id, ...(task ? { taskId: task.id } : {}) };
          };
          const scoped = applicationId ? focus(applicationId) : undefined;
          // Global-scope fixtures still need SOME application id in ctx (every
          // tool call is recorded against one); the route uses the newest.
          const ctxScope = scoped ?? { applicationId: listApplications(db)[0]?.id ?? "" };
          const result = await runTurn({
            ctx: { db, ...ctxScope },
            question: fx.question,
            runLlm: makeAgentLlm(db),
            ...(applicationId ? {} : { focus }),
          });
          const fails = fx.check({ steps: result.steps, answer: result.answer }, db);
          if (fails.length === 0) passes++;
          else allFails.push(`run ${run + 1}: ${fails.join("; ")}`);
        }
        // Report the pass rate; require every run to pass (raise the bar later
        // to a threshold if a scenario proves inherently noisy).
        expect(passes, `${passes}/${K} passed. Failures:\n${allFails.join("\n")}`).toBe(K);
      },
      60_000 * K,
    );
  }
});
