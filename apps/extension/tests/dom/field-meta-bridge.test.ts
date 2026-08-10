// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { readFieldMeta } from "../../src/lib/autofill/field-meta-bridge";
import { META_INDEX_ATTR, META_PAYLOAD_ID } from "../../src/lib/autofill/read-field-meta";
import { READ_META_RESULT, isReadMetaMsg } from "../../src/lib/autofill/combobox-protocol";

/**
 * The bridge asks the MAIN world for field metadata and reads the answer back
 * through the DOM. Both halves of that need pinning: what it does when nobody
 * answers, and how long it is willing to wait — a scan runs on every page load,
 * so a timeout sized for a network call would be paid over and over by pages
 * that simply do not have the script.
 */

// A stub listener and its published payload both outlive one test, so both are
// torn down — otherwise the "nobody answers" case is answered by the previous
// test and silently passes for the wrong reason.
let stub: ((ev: MessageEvent) => void) | null = null;

afterEach(() => {
  if (stub) window.removeEventListener("message", stub);
  stub = null;
  document.getElementById(META_PAYLOAD_ID)?.remove();
  document.body.innerHTML = "";
});

function stubMainWorld(records: unknown[]) {
  stub = (ev: MessageEvent) => {
    const d: unknown = ev.data;
    if (!isReadMetaMsg(d)) return;
    const holder = document.createElement("script");
    holder.id = META_PAYLOAD_ID;
    holder.textContent = JSON.stringify(records);
    document.documentElement.appendChild(holder);
    document
      .querySelectorAll("input")
      .forEach((el, i) => el.setAttribute(META_INDEX_ATTR, String(i)));
    window.postMessage({ kind: READ_META_RESULT, described: records.length, nonce: d.nonce }, "*");
  };
  window.addEventListener("message", stub);
}

describe("readFieldMeta", () => {
  it("joins the stamped elements to the published records", async () => {
    document.body.innerHTML = `<input id="a"><input id="b">`;
    stubMainWorld([
      { question: "First name", platformType: "String", groupId: "g1", source: "props" },
      { question: "Last name", platformType: "String", groupId: "g2", source: "props" },
    ]);

    const meta = await readFieldMeta(document, "input");

    expect(meta.size).toBe(2);
    expect(meta.get(document.getElementById("a")!)?.question).toBe("First name");
    expect(meta.get(document.getElementById("b")!)?.control).toBe("text");
  });

  it("gives up quickly when nothing answers, so a scan is not held hostage", async () => {
    // No listener: this is every page the MAIN-world script did not reach.
    document.body.innerHTML = `<input id="a">`;
    const started = Date.now();
    const meta = await readFieldMeta(document, "input");
    const waited = Date.now() - started;

    expect(meta.size).toBe(0);
    // The reply is a same-document postMessage — sub-millisecond when it comes
    // at all. A budget in the hundreds of milliseconds is already generous; a
    // second would be a second added to every such scan.
    expect(waited).toBeLessThan(500);
  });
});
