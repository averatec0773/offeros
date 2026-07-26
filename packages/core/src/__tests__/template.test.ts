import { describe, it, expect } from "vitest";
import {
  templateSchema,
  injectBody,
  extractBodyRegion,
  BODY_START,
  BODY_END,
  TEMPLATE_KINDS,
  TEMPLATE_RENDERERS,
  TemplateError,
} from "../template";

describe("templateSchema", () => {
  it("round-trips a valid template", () => {
    const template = templateSchema.parse({
      id: "t1",
      name: "My Cover Letter",
      kind: "cover-letter",
      renderer: "latex",
      content: "\\documentclass{article}",
      scaffoldHints: "Formal salutation",
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(template.kind).toBe("cover-letter");
    expect(template.renderer).toBe("latex");
  });

  it("defaults scaffoldHints and isDefault when omitted", () => {
    const template = templateSchema.parse({
      id: "t1",
      name: "My Cover Letter",
      kind: "cover-letter",
      renderer: "latex",
      content: "x",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(template.scaffoldHints).toBe("");
    expect(template.isDefault).toBe(false);
  });

  it("accepts any non-empty string for kind/renderer (registry lists, not closed enums)", () => {
    const template = templateSchema.parse({
      id: "t1",
      name: "Future Kind",
      kind: "reference-letter",
      renderer: "docx",
      content: "x",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(template.kind).toBe("reference-letter");
    expect(template.renderer).toBe("docx");
  });

  it("rejects an empty kind or renderer", () => {
    const badKind = templateSchema.safeParse({
      id: "t1",
      name: "x",
      kind: "",
      renderer: "latex",
      content: "x",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(badKind.success).toBe(false);

    const badRenderer = templateSchema.safeParse({
      id: "t1",
      name: "x",
      kind: "cover-letter",
      renderer: "",
      content: "x",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(badRenderer.success).toBe(false);
  });

  it("exposes registry lists for service-layer validation", () => {
    expect(TEMPLATE_KINDS).toEqual(["cover-letter"]);
    expect(TEMPLATE_RENDERERS).toEqual(["latex", "builtin"]);
  });
});

describe("injectBody / extractBodyRegion", () => {
  const template = [
    "\\documentclass{article}",
    "\\begin{document}",
    BODY_START,
    "old body",
    BODY_END,
    "\\end{document}",
    "",
  ].join("\n");

  it("replaces only the marker region, leaving before/after byte-identical", () => {
    const result = injectBody(template, "new body");

    const before = template.slice(0, template.indexOf(BODY_START));
    const after = template.slice(template.indexOf(BODY_END));

    expect(result.startsWith(before)).toBe(true);
    expect(result.endsWith(after)).toBe(true);
    expect(result).toContain("new body");
    expect(result).not.toContain("old body");
  });

  it("retains the marker lines so re-injection is idempotent", () => {
    const once = injectBody(template, "new body");
    const twice = injectBody(once, "newer body");

    expect(twice).toContain(BODY_START);
    expect(twice).toContain(BODY_END);
    expect(twice).toContain("newer body");
    expect(twice).not.toContain("new body\n" + BODY_END); // old body content gone
    expect(extractBodyRegion(twice)).toBe("newer body");
  });

  it("double-injection converges: injecting the same body twice is a no-op on the third read", () => {
    const first = injectBody(template, "stable body");
    const second = injectBody(first, "stable body");
    expect(second).toBe(first);
  });

  it("throws a typed error when markers are absent", () => {
    expect.assertions(3);
    const noMarkers = "\\documentclass{article}\n\\begin{document}\nhello\n\\end{document}\n";
    expect(() => injectBody(noMarkers, "new body")).toThrow(TemplateError);
    try {
      injectBody(noMarkers, "new body");
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateError);
      expect((err as TemplateError).kind).toBe("no-body-markers");
    }
  });

  it("throws when BODY_END appears before BODY_START", () => {
    const reversed = [BODY_END, "content", BODY_START].join("\n");
    expect(() => injectBody(reversed, "x")).toThrow(TemplateError);
  });
});

describe("marker-collision resistance", () => {
  const template = [
    "\\documentclass{article}",
    "\\begin{document}",
    BODY_START,
    "old body",
    BODY_END,
    "\\end{document}",
    "",
  ].join("\n");

  it("strips a body line containing the literal BODY_END marker before injecting", () => {
    const evilBody = ["line one", `some text ${BODY_END} embedded`, "line two"].join("\n");
    const result = injectBody(template, evilBody);

    expect(extractBodyRegion(result)).toBe(["line one", "line two"].join("\n"));
    expect(result.split(BODY_END).length - 1).toBe(1); // exactly one real closing marker survives
    expect(result.split(BODY_START).length - 1).toBe(1);
  });

  it("strips a body line containing the literal BODY_START marker before injecting", () => {
    const evilBody = ["line one", `${BODY_START} fake`, "line two"].join("\n");
    const result = injectBody(template, evilBody);

    expect(extractBodyRegion(result)).toBe(["line one", "line two"].join("\n"));
    expect(result.split(BODY_START).length - 1).toBe(1); // exactly one real opening marker survives
  });

  it("stays idempotent across repeated injections even when the source body echoes a marker", () => {
    const evilBody = ["intro", `oops ${BODY_END} oops`, "outro"].join("\n");
    const first = injectBody(template, evilBody);
    const second = injectBody(first, evilBody);

    expect(second).toBe(first);
    expect(extractBodyRegion(second)).toBe(["intro", "outro"].join("\n"));
  });

  it("locates the real closing marker via last-occurrence when marker-like text already sits between the markers (defense in depth for content that predates this fix)", () => {
    const corrupted = [
      "\\documentclass{article}",
      "\\begin{document}",
      BODY_START,
      "real body start",
      `stray text mentioning ${BODY_END} inline`,
      "real body end",
      BODY_END,
      "\\end{document}",
      "",
    ].join("\n");

    expect(extractBodyRegion(corrupted)).toBe(
      ["real body start", `stray text mentioning ${BODY_END} inline`, "real body end"].join("\n"),
    );
  });
});

describe("extractBodyRegion", () => {
  it("returns the body between markers", () => {
    const template = [BODY_START, "hello body", BODY_END].join("\n");
    expect(extractBodyRegion(template)).toBe("hello body");
  });

  it("returns null when markers are absent", () => {
    expect(extractBodyRegion("no markers here")).toBeNull();
  });

  it("returns null when only one marker is present", () => {
    expect(extractBodyRegion(`${BODY_START}\nonly start`)).toBeNull();
  });
});
