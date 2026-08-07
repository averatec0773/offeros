import { describe, expect, it } from "vitest";
import {
  isEngineScanRequest,
  isEngineFillRequest,
  isEngineCaptureJdRequest,
  isEngineAttachFileRequest,
  isEnginePageChanged,
} from "../src/lib/autofill/autofill-messaging";

describe("engine request guards", () => {
  it("isEngineScanRequest matches only the scan envelope", () => {
    expect(isEngineScanRequest({ kind: "OFFEROS_ENGINE_SCAN" })).toBe(true);
    expect(isEngineScanRequest({ kind: "OFFEROS_ENGINE_FILL", values: [] })).toBe(false);
    expect(isEngineScanRequest(null)).toBe(false);
  });

  it("isEngineFillRequest requires a values array", () => {
    expect(isEngineFillRequest({ kind: "OFFEROS_ENGINE_FILL", values: [] })).toBe(true);
    expect(isEngineFillRequest({ kind: "OFFEROS_ENGINE_FILL" })).toBe(false);
    expect(isEngineFillRequest({ kind: "OFFEROS_ENGINE_SCAN" })).toBe(false);
  });

  it("isEngineCaptureJdRequest matches only the capture envelope", () => {
    expect(isEngineCaptureJdRequest({ kind: "OFFEROS_ENGINE_CAPTURE_JD" })).toBe(true);
    expect(isEngineCaptureJdRequest({ kind: "OFFEROS_ENGINE_SCAN" })).toBe(false);
  });

  it("isEngineAttachFileRequest requires fieldId, fileName, and bytesBase64", () => {
    expect(
      isEngineAttachFileRequest({
        kind: "OFFEROS_ENGINE_ATTACH_FILE",
        fieldId: "f1",
        fileName: "resume.pdf",
        mimeType: "application/pdf",
        bytesBase64: "AAA=",
      }),
    ).toBe(true);
    expect(isEngineAttachFileRequest({ kind: "OFFEROS_ENGINE_ATTACH_FILE", fieldId: "f1" })).toBe(false);
    expect(isEngineAttachFileRequest({ kind: "OFFEROS_ENGINE_SCAN" })).toBe(false);
    expect(isEngineAttachFileRequest(null)).toBe(false);
  });


  it("isEnginePageChanged matches only the page-changed push", () => {
    expect(isEnginePageChanged({ kind: "OFFEROS_ENGINE_PAGE_CHANGED" })).toBe(true);
    expect(isEnginePageChanged({ kind: "OFFEROS_ENGINE_SCAN" })).toBe(false);
    expect(isEnginePageChanged(null)).toBe(false);
  });
});
