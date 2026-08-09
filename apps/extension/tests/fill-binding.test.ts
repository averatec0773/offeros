import { describe, expect, it } from "vitest";
import {
  isOpenFillTabRequest,
  isGetFillBindingRequest,
  isOpenableFillUrl,
} from "../src/lib/fill-binding";

describe("fill-binding message guards", () => {
  it("accepts a well-formed open-fill-tab request", () => {
    expect(
      isOpenFillTabRequest({
        kind: "OFFEROS_OPEN_FILL_TAB",
        handoffId: "h1",
        url: "https://x.test/a",
      }),
    ).toBe(true);
  });

  it("rejects malformed open-fill-tab requests", () => {
    expect(isOpenFillTabRequest(null)).toBe(false);
    expect(isOpenFillTabRequest({ kind: "OFFEROS_OPEN_FILL_TAB" })).toBe(false);
    expect(
      isOpenFillTabRequest({ kind: "OFFEROS_OPEN_FILL_TAB", handoffId: "", url: "https://x.test" }),
    ).toBe(false);
    expect(
      isOpenFillTabRequest({ kind: "OFFEROS_OPEN_FILL_TAB", handoffId: 7, url: "https://x.test" }),
    ).toBe(false);
    expect(
      isOpenFillTabRequest({ kind: "SOMETHING_ELSE", handoffId: "h1", url: "https://x.test" }),
    ).toBe(false);
  });

  it("accepts get-binding requests with and without a tabId", () => {
    expect(isGetFillBindingRequest({ kind: "OFFEROS_GET_FILL_BINDING" })).toBe(true);
    expect(isGetFillBindingRequest({ kind: "OFFEROS_GET_FILL_BINDING", tabId: 4 })).toBe(true);
    expect(isGetFillBindingRequest({ kind: "OFFEROS_GET_FILL_BINDING", tabId: "4" })).toBe(false);
  });

  it("only http(s) urls are openable — never javascript:/chrome:/file:/data:", () => {
    expect(isOpenableFillUrl("https://jobs.ashbyhq.com/acme/1/application")).toBe(true);
    expect(isOpenableFillUrl("http://example.com")).toBe(true);
    // eslint-disable-next-line no-script-url
    expect(isOpenableFillUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableFillUrl("chrome://settings")).toBe(false);
    expect(isOpenableFillUrl("file:///etc/passwd")).toBe(false);
    expect(isOpenableFillUrl("data:text/html,hi")).toBe(false);
    expect(isOpenableFillUrl("not a url")).toBe(false);
    expect(isOpenableFillUrl("")).toBe(false);
  });
});
