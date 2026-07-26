import { describe, expect, it } from "vitest";
import { RESUME_CORPUS } from "./resume-corpus";
import { scoreResume } from "./score-adaptation";

const THRESHOLD = 90;

describe("autofill adaptation across a diverse resume corpus", () => {
  const scores = RESUME_CORPUS.map(scoreResume);

  it("reports the adaptation table", () => {
    const rows = scores.map(
      (s) =>
        `  ${s.id.padEnd(18)} ${String(s.percent).padStart(5)}%  (${s.correct}/${s.applicable})  ${s.archetype}`,
    );
    const totalCorrect = scores.reduce((a, s) => a + s.correct, 0);
    const totalApplicable = scores.reduce((a, s) => a + s.applicable, 0);
    const aggregate = Math.round((totalCorrect / totalApplicable) * 1000) / 10;
    console.log(
      `\nAutofill adaptation (${RESUME_CORPUS.length} resumes × ${5} ATS forms):\n` +
        rows.join("\n") +
        `\n  ${"AGGREGATE".padEnd(18)} ${String(aggregate).padStart(5)}%  (${totalCorrect}/${totalApplicable})\n`,
    );
    expect(scores.length).toBe(RESUME_CORPUS.length);
  });

  it("never fills a control it should leave alone (no false positives)", () => {
    const fp = scores.flatMap((s) =>
      s.falsePositives.map((m) => `${s.id}/${m.formId}: ${m.label}`),
    );
    expect(fp).toEqual([]);
  });

  it.each(RESUME_CORPUS.map((r) => r.id))("%s reaches the adaptation threshold", (id) => {
    const s = scores.find((x) => x.id === id)!;
    const detail = s.misses
      .map(
        (m) =>
          `    ${m.formId}/${m.target} "${m.label}": want "${m.expected}" got "${m.got}" [${m.gotStatus}]`,
      )
      .join("\n");
    expect(s.percent, `${id} below ${THRESHOLD}%:\n${detail}`).toBeGreaterThanOrEqual(THRESHOLD);
  });

  it("clears the threshold in aggregate", () => {
    const totalCorrect = scores.reduce((a, s) => a + s.correct, 0);
    const totalApplicable = scores.reduce((a, s) => a + s.applicable, 0);
    const aggregate = (totalCorrect / totalApplicable) * 100;
    expect(aggregate).toBeGreaterThanOrEqual(THRESHOLD);
  });
});
