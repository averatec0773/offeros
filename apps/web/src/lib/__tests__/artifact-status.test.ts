import { describe, it, expect } from "vitest";
import type { ApplicationEvent, Artifact } from "@offeros/core";
import { docStatus, relativeTime } from "../artifact-status";

/**
 * Two surfaces read this — the materials card and the workbench — so the one
 * thing that must not happen is the two of them disagreeing about whether a
 * document has been accepted.
 */

const artifact = (versions: { id: string; createdAt: number }[], currentId?: string): Artifact => ({
  id: "a1",
  taskId: "t1",
  kind: "resume",
  versions: versions.map((v) => ({
    ...v,
    content: "body",
    rationale: "why",
    createdAt: v.createdAt,
  })),
  currentVersionId: currentId ?? versions[versions.length - 1]!.id,
  createdAt: 1,
  updatedAt: 1,
});

const approvedAt = (at: number, kind = "resume"): ApplicationEvent => ({
  id: `e-${at}`,
  applicationId: "app-1",
  kind: "artifact-approved",
  at,
  payload: { kind },
});

describe("docStatus", () => {
  it("is 'none' with no artifact at all", () => {
    expect(docStatus(null, "resume", [])).toMatchObject({ state: "none", version: 0 });
  });

  it("is a draft once generated, numbered and dated from the current version", () => {
    const status = docStatus(artifact([{ id: "v1", createdAt: 100 }]), "resume", []);
    expect(status).toMatchObject({ state: "draft", version: 1, updatedAt: 100 });
  });

  it("is accepted once an approval lands after the current version", () => {
    const status = docStatus(artifact([{ id: "v1", createdAt: 100 }]), "resume", [approvedAt(200)]);
    expect(status.state).toBe("accepted");
  });

  it("goes back to a draft when the document is revised after being accepted", () => {
    // An acceptance is of a VERSION. A newer version has not been accepted,
    // and saying otherwise would be the card lying about the document.
    const status = docStatus(
      artifact([
        { id: "v1", createdAt: 100 },
        { id: "v2", createdAt: 300 },
      ]),
      "resume",
      [approvedAt(200)],
    );
    expect(status).toMatchObject({ state: "draft", version: 2 });
  });

  it("does not read another document's approval", () => {
    const status = docStatus(artifact([{ id: "v1", createdAt: 100 }]), "resume", [
      approvedAt(200, "cover-letter"),
    ]);
    expect(status.state).toBe("draft");
  });

  it("numbers and dates by the CURRENT version, not the newest row", () => {
    const status = docStatus(
      artifact(
        [
          { id: "v1", createdAt: 100 },
          { id: "v2", createdAt: 300 },
        ],
        "v1",
      ),
      "resume",
      [],
    );
    expect(status).toMatchObject({ version: 1, updatedAt: 100 });
  });
});

describe("relativeTime", () => {
  const now = 1_000_000_000_000;
  it("reads the way a person would say it", () => {
    expect(relativeTime(now - 5_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 4 * 86_400_000, now)).toBe("4d ago");
    expect(relativeTime(now - 60 * 86_400_000, now)).toBe("2mo ago");
    expect(relativeTime(now - 400 * 86_400_000, now)).toBe("1y ago");
  });
});
