import { describe, expect, it, vi } from "vitest";
import { startDevReload } from "../src/lib/dev-reload";

const stampFetch = (texts: string[], ok = true) => {
  let i = 0;
  return vi.fn(async () => {
    const text = texts[Math.min(i, texts.length - 1)]!;
    i += 1;
    return new Response(text, { status: ok ? 200 : 404 });
  }) as unknown as typeof fetch;
};

const flushUntil = async (cond: () => boolean, ms = 500) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("startDevReload", () => {
  it("fires onChange when the stamp content changes", async () => {
    const onChange = vi.fn();
    const stop = await startDevReload(onChange, {
      intervalMs: 15,
      fetchImpl: stampFetch(['{"builtAt":"a"}', '{"builtAt":"a"}', '{"builtAt":"b"}']),
    });
    await flushUntil(() => onChange.mock.calls.length > 0);
    stop();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not fire while the stamp is unchanged", async () => {
    const onChange = vi.fn();
    const stop = await startDevReload(onChange, {
      intervalMs: 15,
      fetchImpl: stampFetch(['{"builtAt":"a"}']),
    });
    await new Promise((r) => setTimeout(r, 80));
    stop();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is inert when no stamp exists (production-style build)", async () => {
    const onChange = vi.fn();
    const fetchImpl = stampFetch(["nope"], false);
    const stop = await startDevReload(onChange, { intervalMs: 15, fetchImpl });
    await new Promise((r) => setTimeout(r, 60));
    stop();
    expect(onChange).not.toHaveBeenCalled();
    // Only the initial existence probe ran — nothing was scheduled.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("keeps polling through a transient fetch failure mid-rebuild", async () => {
    const onChange = vi.fn();
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      i += 1;
      if (i === 2) throw new Error("EBUSY");
      return new Response(i <= 2 ? "a" : "b", { status: 200 });
    }) as unknown as typeof fetch;
    const stop = await startDevReload(onChange, { intervalMs: 15, fetchImpl });
    await flushUntil(() => onChange.mock.calls.length > 0);
    stop();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
