// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageSignature, watchPage } from "../../src/lib/engine/page-watcher";

beforeEach(() => {
  document.body.innerHTML = "";
  mutationCallbacks = [];
});

// happy-dom doesn't fully support MutationObserver callbacks, so we mock it
let mutationCallbacks: (() => void)[] = [];
const OriginalMutationObserver = MutationObserver;
vi.stubGlobal(
  "MutationObserver",
  class MockMutationObserver {
    constructor(callback: MutationCallback) {
      mutationCallbacks.push(() => callback([], this as any));
    }
    observe() {}
    disconnect() {
      mutationCallbacks = [];
    }
    takeRecords() {
      return [];
    }
  } as any,
);

function triggerMutations() {
  mutationCallbacks.forEach((cb) => cb());
}

const FIELD_SELECTOR =
  "input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea";

describe("pageSignature", () => {
  it("includes URL, field count, and rolling hash of field names/ids", () => {
    document.body.innerHTML = `
      <input name="email" />
      <input name="phone" />
    `;
    const sig = pageSignature(document);
    expect(sig).toMatch(/\|2\|-?\d+/);
    expect(sig).toContain("|2|");
  });

  it("changes when a field is added", () => {
    document.body.innerHTML = `<input name="email" />`;
    const sig1 = pageSignature(document);
    const input = document.createElement("input");
    input.name = "phone";
    document.body.appendChild(input);
    const sig2 = pageSignature(document);
    expect(sig2).not.toBe(sig1);
  });

  it("does not change for non-field mutations (plain div)", () => {
    document.body.innerHTML = `<input name="email" />`;
    const sig1 = pageSignature(document);
    const div = document.createElement("div");
    document.body.appendChild(div);
    const sig2 = pageSignature(document);
    expect(sig2).toBe(sig1);
  });
});

describe("watchPage", () => {
  it("fires onChange once after a debounce delay when a field is added", () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `<input name="email" />`;
      const onChange = vi.fn();
      const unsub = watchPage(document, onChange, { debounceMs: 100 });

      const input = document.createElement("input");
      input.name = "phone";
      document.body.appendChild(input);
      triggerMutations();

      expect(onChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(101);
      expect(onChange).toHaveBeenCalledOnce();
      unsub();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire onChange for a non-signature mutation (plain div)", () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `<input name="email" />`;
      const onChange = vi.fn();
      const unsub = watchPage(document, onChange, { debounceMs: 100 });

      const div = document.createElement("div");
      document.body.appendChild(div);
      triggerMutations();

      vi.advanceTimersByTime(101);
      expect(onChange).not.toHaveBeenCalled();
      unsub();
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses two rapid field additions into one fire", () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `<input name="email" />`;
      const onChange = vi.fn();
      const unsub = watchPage(document, onChange, { debounceMs: 100 });

      const input1 = document.createElement("input");
      input1.name = "phone";
      document.body.appendChild(input1);
      triggerMutations();

      vi.advanceTimersByTime(50);

      const input2 = document.createElement("input");
      input2.name = "address";
      document.body.appendChild(input2);
      triggerMutations();

      expect(onChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(101);
      expect(onChange).toHaveBeenCalledOnce();
      unsub();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires onChange on popstate after the href changes (SPA back/forward nav)", () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `<input name="email" />`;
      const onChange = vi.fn();
      const unsub = watchPage(document, onChange, { debounceMs: 100 });

      history.replaceState({}, "", "/page-2");
      window.dispatchEvent(new Event("popstate"));

      expect(onChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(101);
      expect(onChange).toHaveBeenCalledOnce();
      unsub();
    } finally {
      vi.useRealTimers();
      history.replaceState({}, "", "/");
    }
  });

  it("unsubscribe stops further fires", () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `<input name="email" />`;
      const onChange = vi.fn();
      const unsubscribe = watchPage(document, onChange, { debounceMs: 100 });

      const input = document.createElement("input");
      input.name = "phone";
      document.body.appendChild(input);
      triggerMutations();

      unsubscribe();

      vi.advanceTimersByTime(101);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("effectiveDocOf (same-origin iframe hosting)", () => {
  it("picks the iframe document when it holds more fields", async () => {
    const { effectiveDocOf } = await import("../../src/lib/engine/page-watcher");
    document.body.innerHTML = "<input name='top1' />";
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const idoc = frame.contentDocument!;
    idoc.body.innerHTML = "<input name='a' /><input name='b' /><select name='c'></select>";
    expect(effectiveDocOf(document)).toBe(idoc);
  });

  it("stays on the top document when it has equal or more fields", async () => {
    const { effectiveDocOf } = await import("../../src/lib/engine/page-watcher");
    document.body.innerHTML = "<input name='t1' /><input name='t2' />";
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    frame.contentDocument!.body.innerHTML = "<input name='a' />";
    expect(effectiveDocOf(document)).toBe(document);
  });

  it("pageSignature reflects iframe field changes", async () => {
    const { pageSignature } = await import("../../src/lib/engine/page-watcher");
    document.body.innerHTML = "";
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const idoc = frame.contentDocument!;
    idoc.body.innerHTML = "<input name='a' /><input name='b' />";
    const before = pageSignature(document);
    idoc.body.innerHTML = "<input name='x' /><input name='y' /><input name='z' />";
    expect(pageSignature(document)).not.toBe(before);
  });
});
