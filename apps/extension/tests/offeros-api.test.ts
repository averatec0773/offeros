import { describe, expect, it } from "vitest";
import { claim, generateAnswer, getPending, postReport } from "../src/lib/offeros-api";

interface Call { url: string; init: RequestInit }
const fakeFetch = (status: number, body: unknown) => {
  const calls: Call[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
};

const ok = (result: unknown) => ({ success: true, errorCode: 10000, errorMsg: null, result });
const err = (errorCode: number, errorMsg: string) => ({ success: false, errorCode, errorMsg, result: null });

describe("getPending", () => {
  it("unwraps result on success", async () => {
    const tickets = [{ id: "h1", taskId: "t1", applicationId: "a1", status: "pending", createdAt: 1, updatedAt: 1, job: { title: "SWE", company: "Acme" } }];
    const f = fakeFetch(200, ok(tickets));
    const r = await getPending(f.fn);
    expect(r).toEqual({ ok: true, value: tickets });
    expect(f.calls[0]!.url).toBe("http://localhost:3000/api/v1/agent/fill/pending");
  });

  it("returns ok:false on a non-ok envelope", async () => {
    const f = fakeFetch(500, err(50000, "boom"));
    const r = await getPending(f.fn);
    expect(r).toEqual({ ok: false, error: "boom" });
  });

  it("returns ok:false on a network throw", async () => {
    const fn = (async () => { throw new Error("net down"); }) as typeof fetch;
    const r = await getPending(fn);
    expect(r).toEqual({ ok: false, error: "network error" });
  });

  it("returns ok:false on malformed JSON", async () => {
    const fn = (async () => new Response("not json", { status: 200 })) as typeof fetch;
    const r = await getPending(fn);
    expect(r.ok).toBe(false);
  });
});

describe("claim", () => {
  it("POSTs to the handoff claim endpoint and unwraps the bundle", async () => {
    const bundle = {
      handoffId: "h1",
      taskId: "t1",
      applicationId: "a1",
      job: { title: "SWE", company: "Acme" },
      fillProfile: { personal: { name: "", email: "", phone: "", address: "", links: {} }, skills: [], answerBank: [] },
      resumeText: null,
      coverLetterText: null,
      jdSummary: null,
    };
    const f = fakeFetch(200, ok(bundle));
    const r = await claim("h1", f.fn);
    expect(r).toEqual({ ok: true, value: bundle });
    expect(f.calls[0]!.url).toBe("http://localhost:3000/api/v1/agent/fill/handoffs/h1/claim");
    expect(f.calls[0]!.init.method).toBe("POST");
  });
});

describe("postReport", () => {
  it("POSTs reports and complete flag", async () => {
    const f = fakeFetch(200, ok({ id: "t1" }));
    const reports = [{ fieldId: "f1", label: "Name", classifiedType: "name", status: "filled", source: "personal", reason: "matched", outcome: "filled" as const, required: true }];
    const r = await postReport("t1", reports, true, f.fn);
    expect(r).toEqual({ ok: true, value: { id: "t1" } });
    const body = JSON.parse(String(f.calls[0]!.init.body));
    expect(body).toEqual({ reports, complete: true });
    expect(f.calls[0]!.url).toBe("http://localhost:3000/api/v1/agent/tasks/t1/fill/report");
  });
});

describe("generateAnswer", () => {
  it("POSTs the question payload and unwraps the answer", async () => {
    const f = fakeFetch(200, ok({ answer: "Yes" }));
    const r = await generateAnswer("t1", { question: "Are you legally authorized?", label: "Authorized?" }, f.fn);
    expect(r).toEqual({ ok: true, value: { answer: "Yes" } });
    expect(f.calls[0]!.url).toBe("http://localhost:3000/api/v1/agent/tasks/t1/fill/answer");
  });
});
