import { describe, expect, it } from "vitest";
import {
  claim,
  createTaskFromJd,
  fetchArtifactPdf,
  fetchResumeFile,
  findApplicationsByJobUrl,
  generateAnswer,
  getPending,
  computeFit,
  getFit,
  instantFill,
  postReport,
  resolveFillAction,
  tailorResume,
} from "../src/lib/offeros-api";

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
      attachResume: "tailored" as const,
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

describe("findApplicationsByJobUrl", () => {
  it("GETs the applications endpoint with a jobUrl filter and unwraps the list", async () => {
    const apps = [{ id: "a1", jobInfo: { jobTitle: "SWE", companyName: "Acme", applyLink: "https://boards.greenhouse.io/acme/jobs/1" } }];
    const f = fakeFetch(200, ok(apps));
    const r = await findApplicationsByJobUrl("https://boards.greenhouse.io/acme/jobs/1", f.fn);
    expect(r).toEqual({ ok: true, value: apps });
    expect(f.calls[0]!.url).toBe(
      "http://localhost:3000/api/v1/applications?jobUrl=https%3A%2F%2Fboards.greenhouse.io%2Facme%2Fjobs%2F1",
    );
  });

  it("returns ok:false on a network throw", async () => {
    const fn = (async () => { throw new Error("net down"); }) as typeof fetch;
    const r = await findApplicationsByJobUrl("https://example.com/job/1", fn);
    expect(r).toEqual({ ok: false, error: "network error" });
  });
});

interface RawCall { url: string; init: RequestInit | undefined }
const fakeRawFetch = (status: number, body: Uint8Array, headers?: Record<string, string>) => {
  const calls: RawCall[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(body.buffer as ArrayBuffer, { status, headers });
  }) as typeof fetch;
  return { fn, calls };
};

describe("fetchResumeFile", () => {
  it("GETs the resume file route and returns bytes + filename + mimeType on success", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const f = fakeRawFetch(200, bytes, {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="Resume.pdf"; filename*=UTF-8\'\'Resume.pdf',
    });
    const r = await fetchResumeFile("r1", f.fn);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(new Uint8Array(r.bytes)).toEqual(bytes);
    expect(r.fileName).toBe("Resume.pdf");
    expect(r.mimeType).toBe("application/pdf");
    expect(f.calls[0]!.url).toBe("http://localhost:3000/api/v1/resumes/r1/file");
  });

  it("returns ok:false with status 404 (no stored file — the honest fallback trigger)", async () => {
    const f = fakeRawFetch(404, new Uint8Array());
    const r = await fetchResumeFile("missing", f.fn);
    expect(r).toEqual({ ok: false, status: 404 });
  });

  it("returns ok:false on a network throw", async () => {
    const fn = (async () => { throw new Error("net down"); }) as typeof fetch;
    expect(await fetchResumeFile("r1", fn)).toEqual({ ok: false });
  });

  it("falls back to a default filename/mimeType when headers are absent", async () => {
    const f = fakeRawFetch(200, new Uint8Array([9]));
    const r = await fetchResumeFile("r1", f.fn);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fileName).toBe("file");
    expect(r.mimeType).toBe("application/octet-stream");
  });
});

describe("fetchArtifactPdf", () => {
  it("GETs the task artifact pdf route for the given kind", async () => {
    const f = fakeRawFetch(200, new Uint8Array([4, 5]), {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="Acme_Cover_Letter.pdf"',
    });
    const r = await fetchArtifactPdf("t1", "cover-letter", f.fn);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fileName).toBe("Acme_Cover_Letter.pdf");
    expect(f.calls[0]!.url).toBe("http://localhost:3000/api/v1/agent/tasks/t1/artifacts/cover-letter/pdf");
  });

  it("returns ok:false with status 404 (artifact absent)", async () => {
    const f = fakeRawFetch(404, new Uint8Array());
    const r = await fetchArtifactPdf("t1", "resume", f.fn);
    expect(r).toEqual({ ok: false, status: 404 });
  });

  it("returns ok:false with status 400 (artifact exists but failed to render)", async () => {
    const f = fakeRawFetch(400, new Uint8Array());
    const r = await fetchArtifactPdf("t1", "resume", f.fn);
    expect(r).toEqual({ ok: false, status: 400 });
  });
});

describe("createTaskFromJd", () => {
  it("POSTs the byJd payload with a generated uuid jobId and unwraps { id, applicationId }", async () => {
    const f = fakeFetch(200, ok({ id: "t1", applicationId: "a1" }));
    const r = await createTaskFromJd(
      { jobTitle: "SWE", companyName: "Acme", jobUrl: "https://boards.greenhouse.io/acme/jobs/1", jdText: "We need a SWE." },
      f.fn,
    );
    expect(r).toEqual({ ok: true, value: { id: "t1", applicationId: "a1" } });
    expect(f.calls[0]!.url).toBe("http://localhost:3000/api/v1/agent/tasks");
    expect(f.calls[0]!.init.method).toBe("POST");
    const body = JSON.parse(String(f.calls[0]!.init.body));
    expect(body.jobInfo).toMatchObject({
      jobTitle: "SWE",
      companyName: "Acme",
      applyLink: "https://boards.greenhouse.io/acme/jobs/1",
    });
    expect(typeof body.jobInfo.jobId).toBe("string");
    expect(body.jobInfo.jobId.length).toBeGreaterThan(0);
    expect(body.jdText).toBe("We need a SWE.");
    expect(body.source).toBe("extension");
  });
});

describe("fit + resolve", () => {
  it("getFit GETs the application's fit and unwraps it", async () => {
    const fit = { overall: 82, label: "Strong match" };
    const f = fakeFetch(200, ok(fit));
    const r = await getFit("a1", f.fn);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject(fit);
    expect(f.calls[0]!.url).toBe("http://localhost:3000/api/v1/applications/a1/fit");
  });

  it("computeFit POSTs to the same route", async () => {
    const f = fakeFetch(200, ok({ overall: 70 }));
    const r = await computeFit("a1", f.fn);
    expect(r.ok).toBe(true);
    expect(f.calls[0]!.url).toBe("http://localhost:3000/api/v1/applications/a1/fit");
    expect(f.calls[0]!.init.method).toBe("POST");
  });

  it("resolveFillAction POSTs the action to the task's resolve route", async () => {
    const f = fakeFetch(200, ok({}));
    const r = await resolveFillAction("t1", "applied-manually", f.fn);
    expect(r.ok).toBe(true);
    expect(f.calls[0]!.url).toBe("http://localhost:3000/api/v1/agent/tasks/t1/fill/resolve");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ action: "applied-manually" });
  });
});

describe("tailorResume", () => {
  it("POSTs to the task's tailor route and unwraps the envelope", async () => {
    const f = fakeFetch(200, ok({}));
    const r = await tailorResume("t1", f.fn);
    expect(r.ok).toBe(true);
    expect(f.calls[0]!.url).toBe("http://localhost:3000/api/v1/agent/tasks/t1/tailor");
    expect(f.calls[0]!.init.method).toBe("POST");
  });

  it("maps an error envelope to { ok: false }", async () => {
    const f = fakeFetch(200, err(42000, "no key"));
    const r = await tailorResume("t1", f.fn);
    expect(r).toEqual({ ok: false, error: "no key" });
  });
});

describe("instantFill", () => {
  it("POSTs the jobInfo payload to the instant route and unwraps the bundle", async () => {
    const bundle = { handoffId: "h1", taskId: "t1", applicationId: "a1" };
    const f = fakeFetch(200, ok(bundle));
    const r = await instantFill(
      { jobTitle: "SWE", companyName: "Acme", jobUrl: "https://boards.greenhouse.io/acme/jobs/1", jdText: "We need a SWE." },
      f.fn,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject(bundle);
    expect(f.calls[0]!.url).toBe("http://localhost:3000/api/v1/agent/fill/instant");
    expect(f.calls[0]!.init.method).toBe("POST");
    const body = JSON.parse(String(f.calls[0]!.init.body));
    expect(body.jobInfo).toMatchObject({
      jobTitle: "SWE",
      companyName: "Acme",
      applyLink: "https://boards.greenhouse.io/acme/jobs/1",
    });
    expect(typeof body.jobInfo.jobId).toBe("string");
    expect(body.jdText).toBe("We need a SWE.");
  });

  it("maps a refused claim envelope to { ok: false } with the server's message", async () => {
    const f = fakeFetch(200, err(40000, "already tracked in OfferOS — open the application workspace"));
    const r = await instantFill(
      { jobTitle: "SWE", companyName: "Acme", jobUrl: "https://x.greenhouse.io/1", jdText: "" },
      f.fn,
    );
    expect(r).toEqual({ ok: false, error: "already tracked in OfferOS — open the application workspace" });
  });
});
