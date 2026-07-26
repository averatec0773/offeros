import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Template } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import {
  clearDefaultForKind,
  deleteTemplateRow,
  findTemplateByName,
  getDefaultTemplate,
  getTemplate,
  listTemplates,
  upsertTemplate,
} from "../template-repo";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-template-repo-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tpl(over: Partial<Template>): Template {
  const now = Date.now();
  return {
    id: over.id ?? "id1",
    name: over.name ?? "n",
    kind: over.kind ?? "cover-letter",
    renderer: over.renderer ?? "latex",
    content: over.content ?? "c",
    scaffoldHints: over.scaffoldHints ?? "",
    isDefault: over.isDefault ?? false,
    createdAt: over.createdAt ?? now,
    updatedAt: over.updatedAt ?? now,
  };
}

describe("template repo", () => {
  it("upserts, reads, lists, finds by name, deletes", () => {
    expect(listTemplates(db)).toEqual([]);
    upsertTemplate(db, tpl({ id: "a", name: "Alpha" }));
    expect(getTemplate(db, "a")!.name).toBe("Alpha");
    expect(getTemplate(db, "missing")).toBeNull();
    expect(findTemplateByName(db, "Alpha")!.id).toBe("a");

    upsertTemplate(db, tpl({ id: "a", name: "Alpha", content: "updated" }));
    expect(getTemplate(db, "a")!.content).toBe("updated");
    expect(listTemplates(db)).toHaveLength(1);

    expect(deleteTemplateRow(db, "a")).toBe(true);
    expect(deleteTemplateRow(db, "a")).toBe(false);
  });

  it("clearDefaultForKind clears only the same kind, sparing exceptId", () => {
    upsertTemplate(db, tpl({ id: "a", kind: "cover-letter", isDefault: true }));
    upsertTemplate(db, tpl({ id: "b", kind: "cover-letter", isDefault: true }));
    clearDefaultForKind(db, "cover-letter", "b");
    expect(getTemplate(db, "a")!.isDefault).toBe(false);
    expect(getTemplate(db, "b")!.isDefault).toBe(true);
  });

  it("getDefaultTemplate returns the default template of a kind, or null", () => {
    expect(getDefaultTemplate(db, "cover-letter")).toBeNull();
    upsertTemplate(db, tpl({ id: "a", kind: "cover-letter", isDefault: false }));
    expect(getDefaultTemplate(db, "cover-letter")).toBeNull();
    upsertTemplate(db, tpl({ id: "b", kind: "cover-letter", isDefault: true }));
    expect(getDefaultTemplate(db, "cover-letter")!.id).toBe("b");
    expect(getDefaultTemplate(db, "resume")).toBeNull();
  });
});
