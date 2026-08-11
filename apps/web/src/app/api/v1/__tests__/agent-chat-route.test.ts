import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "offeros-chat-api-"));
process.env.OFFEROS_DB_PATH = join(dir, "chat.db");

// The turn itself is not under test — the history WINDOW is. Capture whatever
// the route hands the loop and answer instantly, so no provider is involved.
const { captured } = vi.hoisted(() => ({
  captured: {} as { history?: { role: string; content: string }[] },
}));

vi.mock("@/server/agent/loop", () => ({
  runTurn: async (args: { history?: { role: string; content: string }[] }) => {
    captured.history = args.history;
    return { answer: "ok", steps: [], ranOutOfSteps: false };
  },
}));
vi.mock("@/server/agent/agent-llm", () => ({ makeAgentLlm: () => async () => ({}) }));

const chatRoute = await import("../agent/chat/route");
const { getDb } = await import("@/server/db/client");
const { createApplication } = await import("@/server/repositories/application-repo");
const { appendChatMessage, listThread } = await import("@/server/repositories/chat-repo");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const db = getDb();

function post(body: unknown) {
  return chatRoute.POST(
    new Request("http://localhost/api/v1/agent/chat", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

let applicationId = "";
let seq = 0;

beforeEach(() => {
  captured.history = undefined;
  seq += 1;
  applicationId = createApplication(db, {
    jobInfo: { jobId: `j-chat-${seq}`, jobTitle: "GenAI Engineer", companyName: "Evolver" },
  }).id;
});

describe("POST /api/v1/agent/chat history window truncation", () => {
  it("truncates a long pasted user message to 500 chars in the window", async () => {
    const pastedJd = "J".repeat(5000);
    appendChatMessage(db, { scope: applicationId, role: "user", content: pastedJd });

    await post({ applicationId, question: "which job was that?" });

    const user = captured.history!.find((m) => m.role === "user")!;
    expect(user.content).toHaveLength(500);
    expect(user.content).toBe("J".repeat(500));
  });

  it("leaves a short user message untouched", async () => {
    appendChatMessage(db, { scope: applicationId, role: "user", content: "what about Evolver?" });

    await post({ applicationId, question: "and the second one?" });

    const user = captured.history!.find((m) => m.role === "user")!;
    expect(user.content).toBe("what about Evolver?");
  });

  it("still truncates assistant messages to 200 chars", async () => {
    appendChatMessage(db, { scope: applicationId, role: "user", content: "hi" });
    appendChatMessage(db, { scope: applicationId, role: "assistant", content: "A".repeat(5000) });

    await post({ applicationId, question: "go on" });

    const assistant = captured.history!.find((m) => m.role === "assistant")!;
    expect(assistant.content).toHaveLength(200);
  });

  it("persists the full user message even though the window carries a snippet", async () => {
    const pastedJd = "K".repeat(5000);

    await post({ applicationId, question: pastedJd });

    // What was asked is kept whole on disk; only the prompt window is capped.
    const first = listThread(db, applicationId)[0]!;
    expect(first.role).toBe("user");
    expect(first.content).toHaveLength(5000);
  });

  it("does not truncate the CURRENT question — only prior turns", async () => {
    const pastedJd = "M".repeat(5000);

    // Turn 1: the long paste is the current question, so it is not in the window.
    await post({ applicationId, question: pastedJd });
    expect(captured.history).toEqual([]);

    // Turn 2: now it is history, and capped.
    await post({ applicationId, question: "summarise that" });
    const user = captured.history!.find((m) => m.role === "user")!;
    expect(user.content).toHaveLength(500);
  });
});
