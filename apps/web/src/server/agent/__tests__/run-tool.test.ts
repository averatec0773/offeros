import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../../repositories/application-repo";
import { listTrace } from "../../repositories/agent-trace-repo";
import { runTool } from "../run-tool";
import type { Tool, ToolContext } from "../types";

let db: Db;
let dir: string;
let ctx: ToolContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-run-tool-"));
  db = createDb(join(dir, "t.db"));
  const app = createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "AI Engineer", companyName: "Acme" },
  });
  ctx = { db, applicationId: app.id, taskId: "t1", reason: "because the test said so" };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const okTool = (over: Partial<Tool<void, unknown>> = {}): Tool<void, unknown> => ({
  id: "demo",
  description: "demo",
  run: async () => ({ ok: true, summary: "did the thing" }),
  ...over,
});

describe("runTool contract", () => {
  it("records every call on the trace with the policy's reason", async () => {
    await runTool(okTool(), ctx, undefined);
    const trace = listTrace(db, ctx.applicationId);
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({
      tool: "demo",
      ok: true,
      summary: "did the thing",
      reason: "because the test said so",
      taskId: "t1",
    });
    expect(trace[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("downgrades a success its own verify contradicts — a tool cannot vouch for itself", async () => {
    const obs = await runTool(okTool({ verify: async () => false }), ctx, undefined);
    expect(obs.ok).toBe(false);
    expect(obs.failure?.kind).toBe("unverified");
    const [entry] = listTrace(db, ctx.applicationId);
    expect(entry).toMatchObject({ ok: false, verified: false });
  });

  it("distinguishes 'verified' from 'nothing to verify'", async () => {
    await runTool(okTool({ id: "checked", verify: async () => true }), ctx, undefined);
    await runTool(okTool({ id: "nothing-to-check", verify: async () => null }), ctx, undefined);
    const byTool = Object.fromEntries(listTrace(db, ctx.applicationId).map((t) => [t.tool, t]));
    expect(byTool["checked"]!.verified).toBe(true);
    expect(byTool["nothing-to-check"]!.verified).toBeUndefined();
  });

  it("turns a thrown error into a dependency failure instead of propagating", async () => {
    const obs = await runTool(
      okTool({
        run: async () => {
          throw new Error("provider exploded");
        },
      }),
      ctx,
      undefined,
    );
    expect(obs.ok).toBe(false);
    expect(obs.failure).toMatchObject({ kind: "dependency", reason: "provider exploded" });
    expect(listTrace(db, ctx.applicationId)[0]).toMatchObject({
      ok: false,
      failureKind: "dependency",
    });
  });

  it("rejects bad input as a precondition failure, without running the tool", async () => {
    const run = vi.fn(async () => ({ ok: true, summary: "ran" }));
    const obs = await runTool(
      okTool({
        run,
        parse: () => {
          throw new Error("confirmedByUser must be true");
        },
      }),
      ctx,
      {},
    );
    expect(obs.failure?.kind).toBe("precondition");
    expect(run).not.toHaveBeenCalled();
  });

  it("treats a failing verify as unverified rather than letting it throw", async () => {
    const obs = await runTool(
      okTool({
        verify: async () => {
          throw new Error("db is gone");
        },
      }),
      ctx,
      undefined,
    );
    expect(obs.failure).toMatchObject({ kind: "unverified", reason: "db is gone" });
  });

  it("leaves an already-failed observation alone (no verification, honest trace)", async () => {
    const verify = vi.fn(async () => true);
    const obs = await runTool(
      okTool({
        run: async () => ({
          ok: false,
          summary: "nope",
          failure: { kind: "human-gate" as const, reason: "waiting for you" },
        }),
        verify,
      }),
      ctx,
      undefined,
    );
    expect(obs.failure?.kind).toBe("human-gate");
    expect(verify).not.toHaveBeenCalled();
    expect(listTrace(db, ctx.applicationId)[0]).toMatchObject({
      ok: false,
      failureKind: "human-gate",
    });
  });
});
