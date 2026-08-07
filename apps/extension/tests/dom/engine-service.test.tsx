// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://boards.greenhouse.io/acme/jobs/1" }
import { afterEach, describe, expect, it } from "vitest";
import {
  createEngine,
  registerEngine,
  type EngineContext,
} from "../../src/lib/engine/engine-service";
import type {
  ScanResponse,
  FillResponse,
  CaptureJdResponse,
  AttachFileResponse,
} from "../../src/lib/autofill/autofill-messaging";
import { bytesToBase64 } from "../../src/lib/autofill/base64";

const greenhouseUrl = "https://boards.greenhouse.io/acme/jobs/1";

// Collect the content-script teardown so listeners don't leak across tests.
const disposers: (() => void)[] = [];
const ctx = (): EngineContext => ({ onInvalidated: (cb) => disposers.push(cb) });
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  document.body.innerHTML = "";
});

const seedForm = () => {
  history.replaceState(null, "", greenhouseUrl);
  document.body.innerHTML = `<main><h1>Staff Engineer</h1><form>
    <label for="e">Email</label><input id="e" name="email" autocomplete="email" type="email" />
    <label for="n">Full name</label><input id="n" name="name" type="text" />
  </form></main>`;
};

describe("engine SCAN handler", () => {
  it("returns descriptors + meta from a seeded ATS form", async () => {
    seedForm();
    registerEngine(document, ctx());
    const res = (await browser.runtime.sendMessage({
      kind: "OFFEROS_ENGINE_SCAN",
    })) as ScanResponse;
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.atsId).toBe("greenhouse");
      expect(res.url).toBe(greenhouseUrl);
      expect(res.title).toBe("Staff Engineer");
      expect(res.descriptors.map((d) => d.name)).toEqual(["email", "name"]);
    }
  });

  it("returns no_form for a supported host with no fields", async () => {
    history.replaceState(null, "", greenhouseUrl);
    document.body.innerHTML = `<main><h1>Nothing here</h1></main>`;
    const res = await createEngine(document).scan();
    expect(res).toEqual({ ok: false, reason: "no_form" });
  });

  it("returns not_supported for an unsupported url", async () => {
    // matchAts fails on the URL alone, before the DOM is touched; a stub doc
    // sidesteps happy-dom's cross-origin replaceState guard.
    const stub = { location: { href: "https://example.com/careers" } } as unknown as Document;
    const res = await createEngine(stub).scan();
    expect(res).toEqual({ ok: false, reason: "not_supported" });
  });
});

describe("engine FILL handler", () => {
  it("writes values and returns JSON-safe outcome entries", async () => {
    seedForm();
    registerEngine(document, ctx());
    const scan = (await browser.runtime.sendMessage({
      kind: "OFFEROS_ENGINE_SCAN",
    })) as ScanResponse;
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    const emailId = scan.descriptors.find((d) => d.name === "email")!.fieldId;

    const res = (await browser.runtime.sendMessage({
      kind: "OFFEROS_ENGINE_FILL",
      values: [{ fieldId: emailId, value: "a@b.com" }],
    })) as FillResponse;

    expect(res.filled).toBe(1);
    expect(Array.isArray(res.outcomes)).toBe(true);
    expect(res.outcomes).toEqual([[emailId, "filled"]]);
    expect(document.querySelector<HTMLInputElement>('input[name="email"]')!.value).toBe("a@b.com");
  });
});

describe("engine ATTACH_FILE handler", () => {
  const seedFileForm = () => {
    history.replaceState(null, "", greenhouseUrl);
    document.body.innerHTML = `<main><h1>Staff Engineer</h1><form>
      <label for="r">Resume</label><input id="r" type="file" name="resume" />
      <label for="n">Full name</label><input id="n" name="name" type="text" />
    </form></main>`;
  };

  it("decodes the base64 payload, attaches it to the file input, and verifies", async () => {
    seedFileForm();
    registerEngine(document, ctx());
    const scan = (await browser.runtime.sendMessage({ kind: "OFFEROS_ENGINE_SCAN" })) as ScanResponse;
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    const resumeId = scan.descriptors.find((d) => d.name === "resume")!.fieldId;

    const bytes = new Uint8Array([37, 80, 68, 70]); // "%PDF"
    const res = (await browser.runtime.sendMessage({
      kind: "OFFEROS_ENGINE_ATTACH_FILE",
      fieldId: resumeId,
      fileName: "Jordan_Rivera_Resume.pdf",
      mimeType: "application/pdf",
      bytesBase64: bytesToBase64(bytes),
    })) as AttachFileResponse;

    expect(res.ok).toBe(true);
    const input = document.querySelector<HTMLInputElement>('input[name="resume"]')!;
    expect(input.files).toHaveLength(1);
    expect(input.files?.[0]?.name).toBe("Jordan_Rivera_Resume.pdf");
  });

  it("returns ok:false for a fieldId that doesn't resolve to a file input", async () => {
    seedFileForm();
    registerEngine(document, ctx());
    const scan = (await browser.runtime.sendMessage({ kind: "OFFEROS_ENGINE_SCAN" })) as ScanResponse;
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    const nameId = scan.descriptors.find((d) => d.name === "name")!.fieldId;

    const res = (await browser.runtime.sendMessage({
      kind: "OFFEROS_ENGINE_ATTACH_FILE",
      fieldId: nameId,
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      bytesBase64: bytesToBase64(new Uint8Array([1])),
    })) as AttachFileResponse;

    expect(res.ok).toBe(false);
  });

  it("returns ok:false for a fieldId with no matching element", async () => {
    seedFileForm();
    registerEngine(document, ctx());
    const res = (await browser.runtime.sendMessage({
      kind: "OFFEROS_ENGINE_ATTACH_FILE",
      fieldId: "no-such-field",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      bytesBase64: bytesToBase64(new Uint8Array([1])),
    })) as AttachFileResponse;

    expect(res.ok).toBe(false);
  });
});

describe("engine SCROLL_TO_FIELD handler", () => {
  it("resolves the field, applies the highlight, and returns ok", async () => {
    seedForm();
    registerEngine(document, ctx());
    const scan = (await browser.runtime.sendMessage({ kind: "OFFEROS_ENGINE_SCAN" })) as ScanResponse;
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    const emailId = scan.descriptors.find((d) => d.name === "email")!.fieldId;

    const res = (await browser.runtime.sendMessage({
      kind: "OFFEROS_ENGINE_SCROLL_TO_FIELD",
      fieldId: emailId,
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
    const el = document.querySelector('input[name="email"]')!;
    expect(el.classList.contains("offeros-filled")).toBe(true);
  });

  it("returns ok:false for an unknown fieldId", async () => {
    seedForm();
    registerEngine(document, ctx());
    const res = (await browser.runtime.sendMessage({
      kind: "OFFEROS_ENGINE_SCROLL_TO_FIELD",
      fieldId: "offeros-nope",
    })) as { ok: boolean };
    expect(res.ok).toBe(false);
  });
});

describe("engine teardown", () => {
  it("stops handling messages after onInvalidated fires", async () => {
    seedForm();
    registerEngine(document, ctx());
    // Tear down (mirrors ctx.onInvalidated on content-script unload).
    for (const d of disposers.splice(0)) d();
    // The engine listener is gone: fakeBrowser reports no listeners for the scan.
    await expect(browser.runtime.sendMessage({ kind: "OFFEROS_ENGINE_SCAN" })).rejects.toThrow(
      /No listeners/,
    );
  });
});

describe("engine CAPTURE_JD handler", () => {
  it("returns a CaptureJdResponse shape", async () => {
    history.replaceState(null, "", greenhouseUrl);
    document.body.innerHTML = `<main><h1>Staff Engineer</h1><p>${"We are hiring a staff engineer to build the platform. ".repeat(6)}</p></main>`;
    registerEngine(document, ctx());
    const res = (await browser.runtime.sendMessage({
      kind: "OFFEROS_ENGINE_CAPTURE_JD",
    })) as CaptureJdResponse;
    expect(res.jd).toContain("staff engineer");
    expect(res.source).toBe("dom");
    expect(res.metaTitle).toBe("Staff Engineer");
    expect(res.metaCompany).toBe("acme");
    expect(res.url).toBe(greenhouseUrl);
    expect(res).toHaveProperty("jd");
    expect(res).toHaveProperty("source");
    expect(res).toHaveProperty("metaCompany");
    expect(res).toHaveProperty("metaTitle");
    expect(res).toHaveProperty("url");
    // No JSON-LD on this fixture — structured fields carry through as undefined.
    expect(res.structuredTitle).toBeUndefined();
    expect(res.structuredCompany).toBeUndefined();
  });

  it("derives the company from the doc-title convention when JSON-LD and og:site_name are absent", async () => {
    history.replaceState(null, "", greenhouseUrl);
    document.title = "Job Application for AI Engineer at Forward";
    document.body.innerHTML = `<main><h1>AI Engineer</h1><p>${"Build AI systems for network verification at scale. ".repeat(6)}</p></main>`;
    registerEngine(document, ctx());
    const res = (await browser.runtime.sendMessage({
      kind: "OFFEROS_ENGINE_CAPTURE_JD",
    })) as CaptureJdResponse;
    expect(res.source).toBe("dom");
    expect(res.metaCompany).toBe("Forward");
    expect(res.metaTitle).toBe("AI Engineer");
    document.title = "";
  });

  it("sanitizes the page-meta title (control chars flattened) the same way jd-capture sanitizes structured fields", async () => {
    history.replaceState(null, "", greenhouseUrl);
    document.body.innerHTML = `<main><h1>Staff\tEngineer\nRole</h1><p>${"We are hiring a staff engineer to build the platform. ".repeat(6)}</p></main>`;
    registerEngine(document, ctx());
    const res = (await browser.runtime.sendMessage({
      kind: "OFFEROS_ENGINE_CAPTURE_JD",
    })) as CaptureJdResponse;
    expect(res.metaTitle).not.toMatch(/[\t\n]/);
    expect(res.metaTitle).toBe("Staff Engineer Role");
  });

  it("carries jd-capture's structured title/company through when JSON-LD is present", async () => {
    history.replaceState(null, "", greenhouseUrl);
    const ld = {
      "@type": "JobPosting",
      title: "Staff Engineer",
      hiringOrganization: { name: "Acme" },
      description: "Build the platform reliably at scale for our growing engineering org.",
    };
    document.head.innerHTML = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    document.body.innerHTML = `<main><h1>Staff Engineer</h1></main>`;
    registerEngine(document, ctx());
    const res = (await browser.runtime.sendMessage({
      kind: "OFFEROS_ENGINE_CAPTURE_JD",
    })) as CaptureJdResponse;
    expect(res.source).toBe("jsonld");
    expect(res.structuredTitle).toBe("Staff Engineer");
    expect(res.structuredCompany).toBe("Acme");
  });
});
