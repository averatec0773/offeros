import { beforeEach, describe, expect, it } from "vitest";
import {
  scoreTitleMatch,
  rankPostingLinks,
  pickPostingLink,
  isSameTarget,
  mayAttemptRescue,
  noteRescueAttempt,
  clearRescueLog,
} from "../src/lib/autofill/rescue";

const BOARD = [
  { href: "https://x.test/co/1", text: "Senior Software Engineer, Data" },
  { href: "https://x.test/co/2", text: "Design Operations Manager" },
  { href: "https://x.test/co/3", text: "Senior Product Designer" },
  { href: "https://x.test/co/4", text: "Software Engineer - Early Career" },
];

describe("scoreTitleMatch", () => {
  it("is 1 for an exact-token match and 0 for disjoint text", () => {
    expect(scoreTitleMatch("Senior Software Engineer, Data", "Senior Software Engineer, Data")).toBe(1);
    expect(scoreTitleMatch("Senior Software Engineer, Data", "Head of Marketing")).toBe(0);
  });

  it("is punctuation- and case-insensitive", () => {
    expect(scoreTitleMatch("senior software engineer data", "Senior Software Engineer, Data")).toBe(1);
  });
});

describe("pickPostingLink", () => {
  it("auto-picks the confident match for the held job", () => {
    const pick = pickPostingLink(BOARD, "Senior Software Engineer, Data");
    expect(pick?.href).toBe("https://x.test/co/1");
  });

  it("never auto-picks on a single shared generic token", () => {
    // "Engineer" alone overlaps two postings — not enough to navigate anywhere.
    expect(pickPostingLink(BOARD, "Engineer")).toBeNull();
  });

  it("returns null when nothing clears the confidence threshold", () => {
    expect(pickPostingLink(BOARD, "Chief Financial Officer")).toBeNull();
  });

  it("ranks all candidates best-first for the human list", () => {
    const ranked = rankPostingLinks(BOARD, "Senior Software Engineer, Data");
    expect(ranked[0]!.href).toBe("https://x.test/co/1");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });
});

describe("isSameTarget", () => {
  it("ignores trailing slashes and hashes so a self-link is recognized", () => {
    expect(isSameTarget("https://x.test/co/1/application", "https://x.test/co/1/application/")).toBe(true);
    expect(isSameTarget("https://x.test/co/1/application#top", "https://x.test/co/1/application")).toBe(true);
    expect(isSameTarget("https://x.test/co/1/application", "https://x.test/co/1")).toBe(false);
  });
});

describe("rescue budget (per tab, survives the remount each jump causes)", () => {
  // A minimal in-memory Storage stand-in.
  const makeStore = (): Storage => {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (k: string) => map.get(k) ?? null,
      key: (i: number) => [...map.keys()][i] ?? null,
      removeItem: (k: string) => void map.delete(k),
      setItem: (k: string, v: string) => void map.set(k, v),
    } as Storage;
  };

  let store: Storage;
  beforeEach(() => {
    store = makeStore();
  });

  it("refuses a target already attempted, even after the panel remounts", () => {
    const target = "https://x.test/co/1/application";
    expect(mayAttemptRescue(store, target)).toBe(true);
    noteRescueAttempt(store, target);
    // A fresh panel instance (new in-memory state) reads the same tab log.
    expect(mayAttemptRescue(store, target)).toBe(false);
    expect(mayAttemptRescue(store, `${target}/`)).toBe(false); // normalized
  });

  it("caps total jumps per tab so a form-less page can never loop", () => {
    for (const n of [1, 2, 3]) noteRescueAttempt(store, `https://x.test/co/${n}`);
    expect(mayAttemptRescue(store, "https://x.test/co/4")).toBe(false);
  });

  it("landing on a real form clears the log for the next job", () => {
    noteRescueAttempt(store, "https://x.test/co/1");
    clearRescueLog(store);
    expect(mayAttemptRescue(store, "https://x.test/co/1")).toBe(true);
  });

  it("degrades safely when storage is unavailable", () => {
    expect(mayAttemptRescue(undefined, "https://x.test/co/1")).toBe(true);
    expect(() => noteRescueAttempt(undefined, "https://x.test/co/1")).not.toThrow();
    expect(() => clearRescueLog(undefined)).not.toThrow();
  });
});
