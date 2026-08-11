import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { appendChatMessage, listThread, listRecentMessages, GLOBAL_SCOPE } from "../chat-repo";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-chat-repo-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("chat-repo ranOutOfSteps persistence", () => {
  it("round-trips the out-of-steps flag so a reloaded thread keeps the notice", () => {
    appendChatMessage(db, { scope: GLOBAL_SCOPE, role: "user", content: "why stuck?" });
    appendChatMessage(db, {
      scope: GLOBAL_SCOPE,
      role: "assistant",
      content: "stopped early",
      steps: [{ tool: "list_applications", ok: true, summary: "19", reason: "" }],
      ranOutOfSteps: true,
    });

    const thread = listThread(db, GLOBAL_SCOPE);
    const assistant = thread.find((m) => m.role === "assistant")!;
    expect(assistant.ranOutOfSteps).toBe(true);

    const recent = listRecentMessages(db, GLOBAL_SCOPE, 10);
    expect(recent.find((m) => m.role === "assistant")!.ranOutOfSteps).toBe(true);
  });

  it("omits the flag for a normal completed turn (absent, not false-persisted)", () => {
    appendChatMessage(db, { scope: GLOBAL_SCOPE, role: "assistant", content: "done", steps: [] });
    const assistant = listThread(db, GLOBAL_SCOPE)[0]!;
    expect(assistant.ranOutOfSteps).toBeUndefined();
  });
});
