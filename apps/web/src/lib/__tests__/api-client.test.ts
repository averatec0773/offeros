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

describe("api client", () => {
  it("unwraps the envelope result", async () => {
    stubFetch({ success: true, errorCode: 10000, errorMsg: null, result: [{ id: "a" }] });
    const apps = await api.applications.list();
    expect(apps).toEqual([{ id: "a" }]);
  });

  it("calls the right url and method for a create", async () => {
    const fetchMock = stubFetch({
      success: true,
      errorCode: 10000,
      errorMsg: null,
      result: { id: "x" },
    });
    await api.agentTasks.create({ applicationId: "app-1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/agent/tasks");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ applicationId: "app-1" });
  });

  it("throws ApiError carrying the error code when success is false", async () => {
    stubFetch(
      { success: false, errorCode: 40400, errorMsg: "application not found", result: null },
      404,
    );
    await expect(api.applications.get("missing")).rejects.toMatchObject({
      name: "ApiError",
      code: 40400,
    });
    await expect(api.applications.get("missing")).rejects.toBeInstanceOf(ApiError);
  });
});
