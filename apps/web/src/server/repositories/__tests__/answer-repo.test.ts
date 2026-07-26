import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { listAnswers, createAnswer, updateAnswer, deleteAnswer } from "../answer-repo";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-answer-repo-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const INPUT = {
  questionPatterns: ["Are you legally authorized to work"],
  answer: "Yes",
  type: "boolean" as const,
  category: "eeo" as const,
};

describe("answer-repo", () => {
  it("lists nothing before any answer exists", () => {
    expect(listAnswers(db)).toEqual([]);
  });

  it("creates an answer with a generated id and lists it back", () => {
    const created = createAnswer(db, INPUT);
    expect(created.id).toBeTruthy();
    expect(created.answer).toBe("Yes");

    const listed = listAnswers(db);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(created);
  });

  it("updates an existing answer in place", () => {
    const created = createAnswer(db, INPUT);
    const updated = updateAnswer(db, created.id, { answer: "No" });
    expect(updated?.answer).toBe("No");
    expect(updated?.id).toBe(created.id);
    expect(listAnswers(db)).toHaveLength(1);
  });

  it("returns null when updating a missing answer", () => {
    expect(updateAnswer(db, "does-not-exist", { answer: "No" })).toBeNull();
  });

  it("deletes an existing answer and returns true", () => {
    const created = createAnswer(db, INPUT);
    expect(deleteAnswer(db, created.id)).toBe(true);
    expect(listAnswers(db)).toEqual([]);
  });

  it("returns false when deleting a missing answer", () => {
    expect(deleteAnswer(db, "does-not-exist")).toBe(false);
  });
});
