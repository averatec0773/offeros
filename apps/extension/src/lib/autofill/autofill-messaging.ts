import type { FieldDescriptor } from "@offeros/autofill";
import type { AtsId } from "./recipes";
import type { FillValue } from "./dom-fill";

export type ScanResponse =
  | { ok: true; atsId: AtsId; url: string; company: string; title: string; descriptors: FieldDescriptor[] }
  | { ok: false; reason: "not_supported" | "no_form" };

export interface FillResponse {
  ok: true;
  filled: number;
  /**
   * Task-mode only: per-field write outcome for field reports. Ignored by standalone mode.
   * Encoded as entry tuples (not a Map) so it survives the JSON serialization that
   * runtime/tabs.sendMessage applies across the panel↔content boundary — a Map arrives as {}.
   */
  outcomes?: [string, "filled" | "failed"][];
}

export interface CaptureJdResponse {
  jd: string;
  source: string;
  company: string;
  title: string;
  url: string;
  /** JSON-LD-only structured fields from jd-capture (sanitized); undefined on DOM fallback. */
  structuredTitle?: string;
  structuredCompany?: string;
}

// Engine wire-contract: the side panel drives the active tab's content-script engine over
// tabs.sendMessage. There is no WATCH request — watch is always on in the content script, which
// pushes OFFEROS_ENGINE_PAGE_CHANGED so the panel re-scans.

export interface EngineScanRequest {
  kind: "OFFEROS_ENGINE_SCAN";
}
export interface EngineFillRequest {
  kind: "OFFEROS_ENGINE_FILL";
  values: FillValue[];
}
export interface EngineCaptureJdRequest {
  kind: "OFFEROS_ENGINE_CAPTURE_JD";
}
export interface EngineAttachFileRequest {
  kind: "OFFEROS_ENGINE_ATTACH_FILE";
  fieldId: string;
  fileName: string;
  mimeType: string;
  /** The file's bytes, base64-encoded — see base64.ts for why. */
  bytesBase64: string;
}
export interface EnginePageChangedMessage {
  kind: "OFFEROS_ENGINE_PAGE_CHANGED";
}

export interface AttachFileResponse {
  ok: boolean;
}

export type EngineRequest =
  | EngineScanRequest
  | EngineFillRequest
  | EngineCaptureJdRequest
  | EngineAttachFileRequest;

function hasKind(m: unknown, kind: string): boolean {
  return typeof m === "object" && m !== null && (m as { kind?: unknown }).kind === kind;
}

export function isEngineScanRequest(m: unknown): m is EngineScanRequest {
  return hasKind(m, "OFFEROS_ENGINE_SCAN");
}
export function isEngineFillRequest(m: unknown): m is EngineFillRequest {
  return hasKind(m, "OFFEROS_ENGINE_FILL") && Array.isArray((m as EngineFillRequest).values);
}
export function isEngineCaptureJdRequest(m: unknown): m is EngineCaptureJdRequest {
  return hasKind(m, "OFFEROS_ENGINE_CAPTURE_JD");
}
export function isEngineAttachFileRequest(m: unknown): m is EngineAttachFileRequest {
  return (
    hasKind(m, "OFFEROS_ENGINE_ATTACH_FILE") &&
    typeof (m as EngineAttachFileRequest).fieldId === "string" &&
    typeof (m as EngineAttachFileRequest).fileName === "string" &&
    typeof (m as EngineAttachFileRequest).bytesBase64 === "string"
  );
}
export function isEngineRequest(m: unknown): m is EngineRequest {
  return (
    isEngineScanRequest(m) ||
    isEngineFillRequest(m) ||
    isEngineCaptureJdRequest(m) ||
    isEngineAttachFileRequest(m)
  );
}
export function isEnginePageChanged(m: unknown): m is EnginePageChangedMessage {
  return hasKind(m, "OFFEROS_ENGINE_PAGE_CHANGED");
}

export async function sendEngineScan(tabId: number): Promise<ScanResponse> {
  return (await browser.tabs.sendMessage(tabId, { kind: "OFFEROS_ENGINE_SCAN" } satisfies EngineScanRequest)) as ScanResponse;
}
export async function sendEngineFill(tabId: number, values: FillValue[]): Promise<FillResponse> {
  return (await browser.tabs.sendMessage(tabId, { kind: "OFFEROS_ENGINE_FILL", values } satisfies EngineFillRequest)) as FillResponse;
}
export async function sendEngineCaptureJd(tabId: number): Promise<CaptureJdResponse> {
  return (await browser.tabs.sendMessage(tabId, { kind: "OFFEROS_ENGINE_CAPTURE_JD" } satisfies EngineCaptureJdRequest)) as CaptureJdResponse;
}
export async function sendEngineAttachFile(
  tabId: number,
  fieldId: string,
  fileName: string,
  mimeType: string,
  bytesBase64: string,
): Promise<AttachFileResponse> {
  return (await browser.tabs.sendMessage(tabId, {
    kind: "OFFEROS_ENGINE_ATTACH_FILE",
    fieldId,
    fileName,
    mimeType,
    bytesBase64,
  } satisfies EngineAttachFileRequest)) as AttachFileResponse;
}
export function sendEnginePageChanged(): void {
  void browser.runtime
    .sendMessage({ kind: "OFFEROS_ENGINE_PAGE_CHANGED" } satisfies EnginePageChangedMessage)
    .catch(() => {});
}
