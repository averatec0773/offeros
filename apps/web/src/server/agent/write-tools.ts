import { getApplication, updateApplication } from "../repositories/application-repo";
import { getProfile, saveProfile } from "../repositories/profile-repo";
import { createAnswer, deleteAnswer, listAnswers, updateAnswer } from "../repositories/answer-repo";
import { appendEvent } from "../repositories/application-event-repo";
import { normalizeQuestion } from "@offeros/autofill";
import type { Tool } from "./types";

/**
 * What the agent can CHANGE — the write family.
 *
 * The line these tools draw: everything here is REVERSIBLE, so it applies
 * immediately, verifies by re-reading the durable row, and leaves a timeline
 * event. The one irreversible act in this product (marking an application
 * submitted) is deliberately NOT here — it stays in the acting registry
 * behind its own gate. A tool that could be talked into an unrecoverable
 * state has no place in a loop a model drives.
 *
 * Verification discipline is the same as everywhere else in this repo: `run`
 * reports what it did, `verify` re-reads the database and refuses to take
 * run's word for it. `runTool` downgrades any write whose verify fails.
 */

const asString = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v.trim() === "")
    throw new Error(`${name} must be a non-empty string`);
  return v.trim();
};

// ---------------------------------------------------------------------------
// save_answer
// ---------------------------------------------------------------------------

export interface SaveAnswerInput {
  question: string;
  answer: string;
}

/**
 * Upsert into the answer bank, with the same rule the panel's Accept flow
 * follows: when an EXISTING entry already matches the question, only its
 * answer is updated — never its patterns, because a curated multi-pattern
 * entry clobbered by an object spread was a real bug once. A new question
 * becomes a new entry whose single pattern is the question itself.
 */
export const saveAnswerTool: Tool<SaveAnswerInput, { id: string; updated: boolean }> = {
  id: "save_answer",
  description:
    'Save the user\'s answer to an application question into the answer bank, so every future form that asks it gets it automatically. Input: {"question":"...","answer":"..."}. Updates the existing entry when the question is already known.',
  parse: (input) => {
    const o = (input ?? {}) as Record<string, unknown>;
    return { question: asString(o.question, "question"), answer: asString(o.answer, "answer") };
  },
  run: async (ctx, input) => {
    const normalized = normalizeQuestion(input.question);
    const existing = listAnswers(ctx.db).find((entry) =>
      entry.questionPatterns.some((p) => normalizeQuestion(p) === normalized),
    );
    const saved = existing
      ? updateAnswer(ctx.db, existing.id, { answer: input.answer })
      : createAnswer(ctx.db, {
          questionPatterns: [input.question],
          answer: input.answer,
          type: "text",
          category: "custom",
        });
    if (!saved)
      return {
        ok: false,
        summary: "could not save the answer",
        failure: { kind: "dependency", reason: "answer row did not persist" },
      };
    appendEvent(ctx.db, {
      applicationId: ctx.applicationId,
      kind: "answer-saved-by-agent",
      payload: { question: input.question },
    });
    return {
      ok: true,
      summary: existing
        ? `updated the stored answer for "${input.question}"`
        : `saved a new answer for "${input.question}"`,
      result: { id: saved.id, updated: Boolean(existing) },
    };
  },
  verify: async (ctx, input) => {
    const normalized = normalizeQuestion(input.question);
    const row = listAnswers(ctx.db).find((entry) =>
      entry.questionPatterns.some((p) => normalizeQuestion(p) === normalized),
    );
    return row !== undefined && row.answer === input.answer;
  },
};

// ---------------------------------------------------------------------------
// delete_answer
// ---------------------------------------------------------------------------

/**
 * Remove a stored answer. Exists because data must be takeable-back: this
 * project once shipped a bulk-defaults button whose rows outlived the button
 * and could not be cleared. Deletion is explicit — never an empty-string
 * side-channel on save.
 */
export const deleteAnswerTool: Tool<{ question: string }, { deleted: boolean }> = {
  id: "delete_answer",
  description:
    'Delete a stored answer from the answer bank, so forms stop receiving it. Input: {"question":"..."} — the question whose answer should be removed.',
  parse: (input) => ({
    question: asString((input as Record<string, unknown>)?.question, "question"),
  }),
  run: async (ctx, input) => {
    const normalized = normalizeQuestion(input.question);
    const existing = listAnswers(ctx.db).find((entry) =>
      entry.questionPatterns.some((p) => normalizeQuestion(p) === normalized),
    );
    if (!existing) {
      return {
        ok: false,
        summary: `no stored answer matches "${input.question}"`,
        failure: { kind: "precondition", reason: "nothing to delete" },
      };
    }
    deleteAnswer(ctx.db, existing.id);
    appendEvent(ctx.db, {
      applicationId: ctx.applicationId,
      kind: "answer-deleted-by-agent",
      payload: { question: input.question },
    });
    return {
      ok: true,
      summary: `deleted the stored answer for "${input.question}"`,
      result: { deleted: true },
    };
  },
  verify: async (ctx, input) => {
    const normalized = normalizeQuestion(input.question);
    return !listAnswers(ctx.db).some((entry) =>
      entry.questionPatterns.some((p) => normalizeQuestion(p) === normalized),
    );
  },
};

// ---------------------------------------------------------------------------
// update_application
// ---------------------------------------------------------------------------

/** Statuses the agent may set. "applied" is refused: submission is the gated,
 *  user-confirmed act of mark_submitted, and a status write must not be a
 *  side door around that gate. */
const AGENT_SETTABLE_STATUSES = new Set([
  "saved",
  "applying",
  "interview",
  "offer",
  "rejected",
  "archived",
]);

export interface UpdateApplicationInput {
  applicationId?: string;
  status?: string;
  notes?: string;
}

export const updateApplicationTool: Tool<
  UpdateApplicationInput,
  { status: string; notes?: string }
> = {
  id: "update_application",
  description:
    'Update an application\'s tracking status or notes — e.g. record an interview, an offer, a rejection, or a note the user dictated. Input: {"applicationId"?: "...", "status"?: "saved|applying|interview|offer|rejected|archived", "notes"?: "..."}. Cannot set "applied" — that is the submit gate\'s job.',
  parse: (input) => {
    const o = (input ?? {}) as Record<string, unknown>;
    const out: UpdateApplicationInput = {};
    if (o.applicationId !== undefined)
      out.applicationId = asString(o.applicationId, "applicationId");
    if (o.status !== undefined) {
      const status = asString(o.status, "status");
      if (status === "applied") {
        throw new Error(
          'setting status "applied" is the submit gate\'s job — use mark_submitted, which asks the user',
        );
      }
      if (!AGENT_SETTABLE_STATUSES.has(status)) {
        throw new Error(`status must be one of: ${[...AGENT_SETTABLE_STATUSES].join(", ")}`);
      }
      out.status = status;
    }
    if (o.notes !== undefined) out.notes = asString(o.notes, "notes");
    if (out.status === undefined && out.notes === undefined) {
      throw new Error("nothing to update — provide status and/or notes");
    }
    return out;
  },
  run: async (ctx, input) => {
    const id = input.applicationId ?? ctx.applicationId;
    const before = getApplication(ctx.db, id);
    if (!before) {
      return {
        ok: false,
        summary: `application ${id} not found`,
        failure: { kind: "precondition", reason: "unknown application" },
      };
    }
    updateApplication(ctx.db, id, {
      ...(input.status ? { status: input.status as never } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });
    appendEvent(ctx.db, {
      applicationId: id,
      kind: "application-updated-by-agent",
      payload: {
        ...(input.status ? { status: input.status, prevStatus: before.status } : {}),
        ...(input.notes !== undefined ? { notesChanged: true } : {}),
      },
    });
    const after = getApplication(ctx.db, id)!;
    return {
      ok: true,
      summary: input.status
        ? `status: ${before.status} → ${after.status}${input.notes !== undefined ? "; notes updated" : ""}`
        : "notes updated",
      result: { status: after.status, ...(after.notes ? { notes: after.notes } : {}) },
    };
  },
  verify: async (ctx, input) => {
    const row = getApplication(ctx.db, input.applicationId ?? ctx.applicationId);
    if (!row) return false;
    if (input.status && row.status !== input.status) return false;
    if (input.notes !== undefined && row.notes !== input.notes) return false;
    return true;
  },
};

// ---------------------------------------------------------------------------
// update_profile
// ---------------------------------------------------------------------------

/** The personal fields the agent may patch — the flat, unambiguous ones. The
 *  structured lists (experience, education) stay in the profile editor where
 *  the user can see what they are reshaping. */
const PATCHABLE_PERSONAL = new Set([
  "name",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "country",
  "postalCode",
] as const);
type PatchablePersonal = typeof PATCHABLE_PERSONAL extends Set<infer T> ? T : never;

export interface UpdateProfileInput {
  personal?: Partial<Record<PatchablePersonal, string>>;
  addSkills?: string[];
  removeSkills?: string[];
}

export const updateProfileTool: Tool<UpdateProfileInput, { skills: number }> = {
  id: "update_profile",
  description:
    'Update the user\'s profile: patch personal contact fields and/or add/remove skills. Input: {"personal"?: {"phone":"...", "city":"...", ...}, "addSkills"?: ["..."], "removeSkills"?: ["..."]}. Structured sections (experience, education) are edited on the Profile page, not here.',
  parse: (input) => {
    const o = (input ?? {}) as Record<string, unknown>;
    const out: UpdateProfileInput = {};
    if (o.personal !== undefined) {
      const personal: Record<string, string> = {};
      for (const [key, value] of Object.entries(o.personal as Record<string, unknown>)) {
        if (!PATCHABLE_PERSONAL.has(key as PatchablePersonal)) {
          throw new Error(
            `personal.${key} is not agent-patchable (allowed: ${[...PATCHABLE_PERSONAL].join(", ")})`,
          );
        }
        personal[key] = asString(value, `personal.${key}`);
      }
      if (Object.keys(personal).length > 0) out.personal = personal;
    }
    if (o.addSkills !== undefined) {
      out.addSkills = (o.addSkills as unknown[]).map((s, i) => asString(s, `addSkills[${i}]`));
    }
    if (o.removeSkills !== undefined) {
      out.removeSkills = (o.removeSkills as unknown[]).map((s, i) =>
        asString(s, `removeSkills[${i}]`),
      );
    }
    if (!out.personal && !out.addSkills?.length && !out.removeSkills?.length) {
      throw new Error("nothing to update — provide personal fields and/or skill changes");
    }
    return out;
  },
  run: async (ctx, input) => {
    const profile = getProfile(ctx.db);
    if (!profile) {
      return {
        ok: false,
        summary: "no profile exists yet — the user sets one up on the Profile page first",
        failure: { kind: "precondition", reason: "profile missing" },
      };
    }
    const removals = new Set((input.removeSkills ?? []).map((s) => s.toLowerCase()));
    const kept = profile.skills.filter((s) => !removals.has(s.toLowerCase()));
    const additions = (input.addSkills ?? []).filter(
      (s) => !kept.some((k) => k.toLowerCase() === s.toLowerCase()),
    );
    const next = {
      ...profile,
      personal: { ...profile.personal, ...(input.personal ?? {}) },
      skills: [...kept, ...additions],
    };
    saveProfile(ctx.db, next);
    appendEvent(ctx.db, {
      applicationId: ctx.applicationId,
      kind: "profile-updated-by-agent",
      payload: {
        ...(input.personal ? { personalFields: Object.keys(input.personal) } : {}),
        ...(additions.length ? { addedSkills: additions } : {}),
        ...(input.removeSkills?.length ? { removedSkills: input.removeSkills } : {}),
      },
    });
    const changed = [
      ...(input.personal ? Object.keys(input.personal) : []),
      ...(additions.length ? [`+${additions.length} skills`] : []),
      ...(removals.size ? [`-${removals.size} skills`] : []),
    ];
    return {
      ok: true,
      summary: `profile updated: ${changed.join(", ")}`,
      result: { skills: next.skills.length },
    };
  },
  verify: async (ctx, input) => {
    const profile = getProfile(ctx.db);
    if (!profile) return false;
    for (const [key, value] of Object.entries(input.personal ?? {})) {
      if ((profile.personal as Record<string, unknown>)[key] !== value) return false;
    }
    for (const skill of input.addSkills ?? []) {
      if (!profile.skills.some((s) => s.toLowerCase() === skill.toLowerCase())) return false;
    }
    for (const skill of input.removeSkills ?? []) {
      if (profile.skills.some((s) => s.toLowerCase() === skill.toLowerCase())) return false;
    }
    return true;
  },
};

export const WRITE_TOOLS = {
  save_answer: saveAnswerTool,
  delete_answer: deleteAnswerTool,
  update_application: updateApplicationTool,
  update_profile: updateProfileTool,
} as const;
