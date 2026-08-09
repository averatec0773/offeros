// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useArtifactLane,
  type ArtifactLaneConfig,
} from "../../src/sidepanel/panel/use-artifact-lane";
import { CUSTOM_UPLOADER_REASON } from "../../src/lib/autofill/task-mode";

const FETCHED = {
  ok: true as const,
  bytes: new Uint8Array([1, 2, 3]).buffer,
  mimeType: "application/pdf",
  fileName: "resume.pdf",
};

/** happy-dom has no blob-URL plumbing; the lane only needs create/revoke to
 *  exist so it can hand a URL to the preview and take it back on reset. */
const revoked: string[] = [];
beforeEach(() => {
  revoked.length = 0;
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:${++n}`);
  URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u));
});

function lane(over: Partial<ArtifactLaneConfig> = {}) {
  const config: ArtifactLaneConfig = {
    generate: vi.fn(async () => ({ ok: true as const })),
    fetchPdf: vi.fn(async () => FETCHED),
    renderFailedError: "render failed",
    noFieldError: "no field",
    findField: () => "f1",
    attach: vi.fn(async () => ({ outcome: "filled" as const, value: "resume.pdf" })),
    recordAttached: vi.fn(async () => {}),
    taskId: () => "task-1",
    isFillPending: () => false,
    ...over,
  };
  return { config, hook: renderHook(() => useArtifactLane(config)) };
}

describe("useArtifactLane", () => {
  it("generates, previews, then attaches", async () => {
    const { config, hook } = lane();
    await act(() => hook.result.current.onGenerate());
    expect(hook.result.current.pdf).toEqual({ url: "blob:1", fileName: "resume.pdf" });
    expect(hook.result.current.hasGeneratedFor("task-1")).toBe(true);
    expect(hook.result.current.busy).toBe(false);

    await act(() => hook.result.current.onAttach());
    expect(hook.result.current.attached).toBe(true);
    expect(config.attach).toHaveBeenCalledWith("f1", FETCHED);
    expect(config.recordAttached).toHaveBeenCalledWith("f1", FETCHED);
    expect(hook.result.current.error).toBeNull();
  });

  it("reports a generation failure and produces no preview", async () => {
    const { hook } = lane({ generate: async () => ({ ok: false, error: "no API key" }) });
    await act(() => hook.result.current.onGenerate());
    expect(hook.result.current.error).toBe("no API key");
    expect(hook.result.current.pdf).toBeNull();
    // The step never ran, so nothing downstream may believe an artifact exists.
    expect(hook.result.current.hasGeneratedFor("task-1")).toBe(false);
  });

  it("separates 'the step failed' from 'the PDF would not render'", async () => {
    const { hook } = lane({ fetchPdf: async () => ({ ok: false as const, status: 400 }) });
    await act(() => hook.result.current.onGenerate());
    expect(hook.result.current.error).toBe("render failed");
    expect(hook.result.current.hasGeneratedFor("task-1")).toBe(false);
  });

  it("refuses to attach when this page has no field of the kind", async () => {
    const { config, hook } = lane({ findField: () => undefined });
    await act(() => hook.result.current.onGenerate());
    await act(() => hook.result.current.onAttach());
    expect(hook.result.current.error).toBe("no field");
    expect(hook.result.current.attached).toBe(false);
    expect(config.attach).not.toHaveBeenCalled();
  });

  it("surfaces an unverified attach as an error rather than as success", async () => {
    const { config, hook } = lane({
      attach: async () => ({ outcome: "needs-user" as const, reason: "custom uploader" }),
    });
    await act(() => hook.result.current.onGenerate());
    await act(() => hook.result.current.onAttach());
    expect(hook.result.current.attached).toBe(false);
    expect(hook.result.current.error).toBe("custom uploader");
    // The report must not be rewritten to "filled" for a file that never landed.
    expect(config.recordAttached).not.toHaveBeenCalled();
  });

  // A bare-string WriteOutcome is the older shape and carries no reason.
  it("falls back to the custom-uploader reason when the outcome carries none", async () => {
    const { hook } = lane({ attach: async () => "failed" });
    await act(() => hook.result.current.onGenerate());
    await act(() => hook.result.current.onAttach());
    expect(hook.result.current.error).toBe(CUSTOM_UPLOADER_REASON);
  });

  it("will not attach into a fill that is still running", async () => {
    const { config, hook } = lane({ isFillPending: () => true });
    await act(() => hook.result.current.onGenerate());
    await act(() => hook.result.current.onAttach());
    expect(config.attach).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBeNull();
  });

  it("runs one generation for two fast clicks", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const generate = vi.fn(async () => {
      await gate;
      return { ok: true as const };
    });
    const { hook } = lane({ generate });
    await act(async () => {
      void hook.result.current.onGenerate();
      void hook.result.current.onGenerate();
      release();
    });
    await waitFor(() => expect(hook.result.current.pdf).not.toBeNull());
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("regenerating revokes the old preview and clears the attached flag", async () => {
    const { hook } = lane();
    await act(() => hook.result.current.onGenerate());
    await act(() => hook.result.current.onAttach());
    expect(hook.result.current.attached).toBe(true);

    await act(() => hook.result.current.onGenerate());
    expect(revoked).toEqual(["blob:1"]);
    expect(hook.result.current.pdf?.url).toBe("blob:2");
    // The page still holds the PREVIOUS version, so "Attached" would be a lie.
    expect(hook.result.current.attached).toBe(false);
  });

  it("reset drops the preview, revokes its URL, and forgets the artifact", async () => {
    const { hook } = lane();
    await act(() => hook.result.current.onGenerate());
    act(() => hook.result.current.reset());
    expect(revoked).toEqual(["blob:1"]);
    expect(hook.result.current.pdf).toBeNull();
    expect(hook.result.current.hasGeneratedFor("task-1")).toBe(false);
    expect(hook.result.current.attached).toBe(false);
  });

  it("will not start a second attach while one is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const attach = vi.fn(async () => {
      await gate;
      return { outcome: "filled" as const, value: "resume.pdf" };
    });
    const { hook } = lane({ attach });
    await act(() => hook.result.current.onGenerate());
    await act(async () => {
      void hook.result.current.onAttach();
      void hook.result.current.onAttach();
      release();
    });
    await waitFor(() => expect(hook.result.current.attached).toBe(true));
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("clears a stale error when the user retries", async () => {
    const attach = vi
      .fn()
      .mockResolvedValueOnce({ outcome: "needs-user" as const, reason: "custom uploader" })
      .mockResolvedValueOnce({ outcome: "filled" as const, value: "resume.pdf" });
    const { hook } = lane({ attach });
    await act(() => hook.result.current.onGenerate());
    await act(() => hook.result.current.onAttach());
    expect(hook.result.current.error).toBe("custom uploader");
    await act(() => hook.result.current.onAttach());
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.attached).toBe(true);
  });

  it("a reset lane still generates for the next job", async () => {
    const { config, hook } = lane();
    await act(() => hook.result.current.onGenerate());
    act(() => hook.result.current.reset());
    await act(() => hook.result.current.onGenerate());
    expect(config.generate).toHaveBeenCalledTimes(2);
    expect(hook.result.current.pdf).toEqual({ url: "blob:2", fileName: "resume.pdf" });
  });

  it("attaching after a reset uploads nothing", async () => {
    const { config, hook } = lane();
    await act(() => hook.result.current.onGenerate());
    act(() => hook.result.current.reset());
    await act(() => hook.result.current.onAttach());
    expect(config.attach).not.toHaveBeenCalled();
  });

  // The job can change while a long generation is still running: the reset that
  // was meant to clear the lane happens first, and the generation lands after.
  it("refuses to attach an artifact belonging to a job the panel has left", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let taskId = "task-1";
    const { config, hook } = lane({
      taskId: () => taskId,
      generate: async () => {
        await gate;
        return { ok: true as const };
      },
    });
    await act(async () => {
      void hook.result.current.onGenerate();
      // The user moves to another posting mid-generation.
      hook.result.current.reset();
      taskId = "task-2";
      release();
    });
    await waitFor(() => expect(hook.result.current.pdf).not.toBeNull());

    // The stale preview is on screen; attaching it would upload the previous
    // job's file to this form and report it as filled.
    await act(() => hook.result.current.onAttach());
    expect(config.attach).not.toHaveBeenCalled();
    expect(config.recordAttached).not.toHaveBeenCalled();
    // And the fill loop must not believe this job has an artifact either.
    expect(hook.result.current.hasGeneratedFor("task-2")).toBe(false);
    expect(hook.result.current.hasGeneratedFor("task-1")).toBe(true);
  });

  it("revokes the preview URL when the panel unmounts", async () => {
    const { hook } = lane();
    await act(() => hook.result.current.onGenerate());
    hook.unmount();
    expect(revoked).toEqual(["blob:1"]);
  });

  it("does nothing without a claimed task", async () => {
    const { config, hook } = lane({ taskId: () => null });
    await act(() => hook.result.current.onGenerate());
    expect(config.generate).not.toHaveBeenCalled();
    expect(hook.result.current.busy).toBe(false);
  });

  it("runs afterGenerate only on success — it is how a lane tells the panel an artifact now exists", async () => {
    const afterGenerate = vi.fn();
    const failed = lane({ afterGenerate, generate: async () => ({ ok: false, error: "x" }) });
    await act(() => failed.hook.result.current.onGenerate());
    expect(afterGenerate).not.toHaveBeenCalled();

    const okLane = lane({ afterGenerate });
    await act(() => okLane.hook.result.current.onGenerate());
    expect(afterGenerate).toHaveBeenCalledTimes(1);
  });
});
