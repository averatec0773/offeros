import { describe, expect, it } from "vitest";
import {
  fromSemanticId,
  groupFieldMeta,
  toControl,
  toFieldMeta,
  type RawFieldMeta,
} from "../field-meta";

/**
 * Every fixture below is a shape read off a live application form on 2026-08-09
 * (see docs/research/2026-08-09-field-metadata-probe.md), not invented. When a
 * platform changes its vocabulary these tests should be updated from a fresh
 * probe rather than from a guess about what it "probably" sends now.
 */

describe("control vocabulary", () => {
  it("translates each platform's own type names", () => {
    // Ashby
    expect(toControl("MultiValueSelect")).toBe("multi-select");
    expect(toControl("ValueSelect")).toBe("single-select");
    expect(toControl("LongText")).toBe("long-text");
    // Greenhouse
    expect(toControl("input_text")).toBe("text");
    expect(toControl("tel")).toBe("phone");
    // Workday
    expect(toControl("boolean")).toBe("boolean");
  });

  it("returns unknown rather than throwing for a type nobody has seen", () => {
    // Platforms add types. An unrecognised one must fall back to the existing
    // heuristics, not abort the scan.
    expect(toControl("SomeTypeShippedNextTuesday")).toBe("unknown");
    expect(toControl("")).toBe("unknown");
  });
});

describe("semantic ids (Workday)", () => {
  it("reads the field's identity out of its id path", () => {
    expect(fromSemanticId("name--legalName--firstName")).toEqual({
      question: "First name",
      control: "text",
      source: "semantic-id",
    });
    expect(fromSemanticId("address--city")?.question).toBe("City");
    expect(fromSemanticId("phoneNumber--phoneNumber")?.control).toBe("phone");
  });

  it("treats preferred and legal name paths as the same kind of field", () => {
    // The fill engine has no behaviour that distinguishes them.
    expect(fromSemanticId("name--preferredName--firstName")?.question).toBe(
      fromSemanticId("name--legalName--firstName")?.question,
    );
  });

  it("declines ids that merely contain a separator", () => {
    expect(fromSemanticId("some--random--widget")).toBeNull();
    expect(fromSemanticId("firstName")).toBeNull();
  });
});

describe("toFieldMeta", () => {
  const ashbyPronouns: RawFieldMeta = {
    question: "What pronouns do you use?",
    platformType: "MultiValueSelect",
    groupId: "21661363-2d8e-4f4f-8d8c-4c69d4e1d78d",
    required: true,
    options: ["She/her", "He/him", "They/them"],
    source: "props",
  };

  it("keeps the ATS's own question text rather than a scraped label", () => {
    const m = toFieldMeta(ashbyPronouns)!;
    expect(m.question).toBe("What pronouns do you use?");
    expect(m.control).toBe("multi-select");
    expect(m.options).toEqual(["She/her", "He/him", "They/them"]);
    expect(m.required).toBe(true);
  });

  it("falls back to the question as the group key when there is no id", () => {
    // Two controls the platform describes identically are one question, id or
    // not — Workday names its custom questions this way.
    const a = toFieldMeta({
      question: "Have you worked here before?",
      platformType: "boolean",
      source: "props",
    })!;
    const b = toFieldMeta({
      question: "Have you worked here before?",
      platformType: "boolean",
      source: "props",
    })!;
    expect(a.groupId).toBe(b.groupId);
  });

  it("returns null when the record says nothing useful", () => {
    // Better to leave the field to the heuristics than to label it "".
    expect(toFieldMeta({ source: "props" })).toBeNull();
    expect(toFieldMeta({ question: "   ", source: "props" })).toBeNull();
    expect(toFieldMeta({ semanticId: "not--a--known--path", source: "semantic-id" })).toBeNull();
  });
});

describe("groupFieldMeta", () => {
  const record = (question: string, groupId: string, opt?: string, required = false) => ({
    meta: toFieldMeta({
      question,
      platformType: "ValueSelect",
      groupId,
      required,
      options: opt ? [opt] : [],
      source: "props" as const,
    })!,
    el: `${groupId}:${opt ?? ""}`,
  });

  it("collapses one question's controls into a single entry", () => {
    // The measured failure: OpenAI's Ashby form renders Race as 8 checkboxes,
    // and every one of them arrived as its own unknown field.
    const race = [
      "American Indian",
      "Asian",
      "Black",
      "Hispanic",
      "Native Hawaiian",
      "White",
      "Two or More",
      "Decline",
    ];
    const grouped = groupFieldMeta(race.map((o) => record("Race", "race-field-id", o)));
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.members).toHaveLength(8);
    expect(grouped[0]!.meta.options).toEqual(race);
  });

  it("keeps distinct questions apart even when their options read alike", () => {
    const grouped = groupFieldMeta([
      record("Office preference", "loc", "Remote"),
      record("Willingness to relocate", "relo", "Remote"),
    ]);
    expect(grouped).toHaveLength(2);
  });

  it("a group is required when any of its controls is", () => {
    const grouped = groupFieldMeta([
      record("Gender", "g", "Male", false),
      record("Gender", "g", "Female", true),
    ]);
    expect(grouped[0]!.meta.required).toBe(true);
  });

  it("does not duplicate options a platform repeats on every control", () => {
    // Ashby puts the full selectableValues list on each member.
    const full = ["She/her", "He/him"];
    const grouped = groupFieldMeta(
      full.map((o) => ({
        meta: toFieldMeta({
          question: "Pronouns",
          platformType: "MultiValueSelect",
          groupId: "p",
          options: full,
          source: "props",
        })!,
        el: o,
      })),
    );
    expect(grouped[0]!.meta.options).toEqual(full);
  });
});
