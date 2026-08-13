import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { listAnswers } from "../../repositories/answer-repo";
import { listEvents } from "../../repositories/application-event-repo";
import { ANSWER_BANK_SCOPE, editAnswer, removeAnswer, saveAnswer } from "../answer-service";

/**
 * The incident behind these: the Equal Employment section and the Answers list
 * were two front-ends onto one bank, the user deleted from the list what looked
 * like duplicates, and the only copy went with them. Nothing recorded it, so
 * afterwards there was nothing to look at.
 */

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-answers-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const veteran = {
  questionPatterns: ["Are you a veteran?", "veteran"],
  answer: "I am not a protected veteran",
  type: "enum" as const,
  category: "eeo" as const,
};

describe("saveAnswer", () => {
  it("creates the first answer to a question", () => {
    const saved = saveAnswer(db, veteran);
    expect(saved.answer).toBe("I am not a protected veteran");
    expect(listAnswers(db)).toHaveLength(1);
  });

  it("updates the entry for a question the bank already answers", () => {
    const first = saveAnswer(db, veteran);
    const second = saveAnswer(db, { ...veteran, answer: "I don't wish to answer" });
    expect(second.id).toBe(first.id);
    expect(listAnswers(db)).toHaveLength(1);
    expect(listAnswers(db)[0]!.answer).toBe("I don't wish to answer");
  });

  it("matches on any shared pattern, not just the first one", () => {
    saveAnswer(db, veteran);
    // A form's own wording, arriving from the panel with only the short key in
    // common. Two entries here would leave the fill engine picking one.
    saveAnswer(db, {
      ...veteran,
      questionPatterns: ["Have you served in the U.S. military?", "veteran"],
      answer: "I don't wish to answer",
    });
    expect(listAnswers(db)).toHaveLength(1);
    expect(listAnswers(db)[0]!.questionPatterns).toEqual(
      expect.arrayContaining([
        "Are you a veteran?",
        "veteran",
        "Have you served in the U.S. military?",
      ]),
    );
  });

  it("ignores case and punctuation when deciding it is the same question", () => {
    saveAnswer(db, veteran);
    saveAnswer(db, { ...veteran, questionPatterns: ["are you a veteran"], answer: "Yes" });
    expect(listAnswers(db)).toHaveLength(1);
  });

  it("keeps different categories apart", () => {
    saveAnswer(db, {
      questionPatterns: ["Work authorization"],
      answer: "Yes",
      type: "text",
      category: "screening",
    });
    saveAnswer(db, {
      questionPatterns: ["Work authorization"],
      answer: "No",
      type: "text",
      category: "eeo",
    });
    // Same words, two different questions on a form. Merging them would put an
    // answer where the user never put one.
    expect(listAnswers(db)).toHaveLength(2);
  });
});

describe("the audit trail", () => {
  const trail = () => listEvents(db, ANSWER_BANK_SCOPE);

  it("records a create, an update and a delete", () => {
    const saved = saveAnswer(db, veteran);
    saveAnswer(db, { ...veteran, answer: "I don't wish to answer" });
    editAnswer(db, saved.id, { answer: "I am not a protected veteran" });
    removeAnswer(db, saved.id);
    expect(trail().map((e) => e.kind)).toEqual([
      "answer.created",
      "answer.updated",
      "answer.updated",
      "answer.deleted",
    ]);
  });

  it("says which question it was, so a wiped answer leaves a trace", () => {
    const saved = saveAnswer(db, veteran);
    removeAnswer(db, saved.id);
    const deleted = trail().find((e) => e.kind === "answer.deleted")!;
    expect(deleted.payload).toMatchObject({
      answerId: saved.id,
      question: "Are you a veteran?",
      category: "eeo",
    });
  });

  it("does not copy the answer itself into the trail", () => {
    const saved = saveAnswer(db, veteran);
    removeAnswer(db, saved.id);
    // An audit row is a record that something changed, not a second copy of
    // what someone said about their veteran or disability status.
    expect(JSON.stringify(trail())).not.toContain("I am not a protected veteran");
  });

  it("records nothing for a delete that deleted nothing", () => {
    expect(removeAnswer(db, "no-such-id")).toBe(false);
    expect(trail()).toHaveLength(0);
  });
});
