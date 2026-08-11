import { describe, it, expect, vi, afterEach } from "vitest";
import { api, ApiError } from "../api-client";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown, status = 200) {
  // A fresh Response per call — a fetch Response body can only be read once,
  // and mockResolvedValue would hand back the same instance on every call.
  const fetchMock = vi.fn().mockImplementation(
    () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const okEnvelope = (result: unknown) => ({
  success: true,
  errorCode: 10000,
  errorMsg: null,
  result,
});

const failEnvelope = (errorCode: number, errorMsg: string) => ({
  success: false,
  errorCode,
  errorMsg,
  result: null,
});

describe("api.pipelineTasks pipeline methods", () => {
  it("createFromJd posts jobInfo/jdText/source and unwraps the created task", async () => {
    const task = { id: "task-1", applicationId: "app-1" };
    const fetchMock = stubFetch(okEnvelope(task));
    const input = {
      jobInfo: { title: "Engineer", company: "Acme" },
      jdText: "job description text",
      source: "manual",
    };
    const result = await api.pipelineTasks.createFromJd(input as never);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/agent/tasks");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(input);
    expect(result).toEqual(task);
  });

  it("start posts to /agent/tasks/:id/start and unwraps the task", async () => {
    const task = { id: "task-1", status: "running" };
    const fetchMock = stubFetch(okEnvelope(task));
    const result = await api.pipelineTasks.start("task-1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/agent/tasks/task-1/start");
    expect(init.method).toBe("POST");
    expect(result).toEqual(task);
  });

  it("advance posts to /agent/tasks/:id/advance and unwraps the task", async () => {
    const task = { id: "task-1", step: 2 };
    const fetchMock = stubFetch(okEnvelope(task));
    const result = await api.pipelineTasks.advance("task-1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/agent/tasks/task-1/advance");
    expect(init.method).toBe("POST");
    expect(result).toEqual(task);
  });

  it("tweak posts kind + instruction and unwraps { version, diff }", async () => {
    const payload = {
      version: { id: "v2", content: "new content", rationale: "why", createdAt: 1 },
      diff: [{ op: "eq", text: "line 1" }],
    };
    const fetchMock = stubFetch(okEnvelope(payload));
    const result = await api.pipelineTasks.tweak("task-1", "resume", "make it punchier");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/agent/tasks/task-1/tweak");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      kind: "resume",
      instruction: "make it punchier",
    });
    expect(result).toEqual(payload);
  });

  it("choice posts { choice } and unwraps the task", async () => {
    const task = { id: "task-1", status: "running" };
    const fetchMock = stubFetch(okEnvelope(task));
    const result = await api.pipelineTasks.choice("task-1", "generate");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/agent/tasks/task-1/choice");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ choice: "generate" });
    expect(result).toEqual(task);
  });

  it("pause posts to /agent/tasks/:id/pause and unwraps the task", async () => {
    const task = { id: "task-1", status: "paused" };
    const fetchMock = stubFetch(okEnvelope(task));
    const result = await api.pipelineTasks.pause("task-1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/agent/tasks/task-1/pause");
    expect(init.method).toBe("POST");
    expect(result).toEqual(task);
  });

  it("get fetches /agent/tasks/:id and unwraps { task, jdAnalysis, artifacts }", async () => {
    const payload = {
      task: { id: "task-1" },
      jdAnalysis: { summary: "s" },
      artifacts: [{ id: "a1" }],
    };
    const fetchMock = stubFetch(okEnvelope(payload));
    const result = await api.pipelineTasks.get("task-1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/agent/tasks/task-1");
    expect(init.method).toBeUndefined();
    expect(result).toEqual(payload);
  });

  it("throws ApiError carrying the error code when success is false", async () => {
    stubFetch(failEnvelope(40400, "agent task not found"), 404);
    await expect(api.pipelineTasks.start("missing")).rejects.toMatchObject({
      name: "ApiError",
      code: 40400,
    });
    stubFetch(failEnvelope(40400, "agent task not found"), 404);
    await expect(api.pipelineTasks.get("missing")).rejects.toBeInstanceOf(ApiError);
  });
});
