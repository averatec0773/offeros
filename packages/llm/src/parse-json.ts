import { LlmError } from "./errors";

/**
 * Extract and parse JSON from a raw string, handling optional markdown code fences.
 * Strips leading/trailing ```json or ``` markers if present, then parses.
 * @throws LlmError with kind "bad_output" if parsing fails.
 */
export function extractJson(raw: string): unknown {
  let trimmed = raw.trim();

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  trimmed = trimmed.replace(/^```(?:json)?\s*\n?/, "");
  trimmed = trimmed.replace(/\n?```\s*$/, "");

  try {
    return JSON.parse(trimmed);
  } catch (err) {
    // Include a short prefix of the raw input for debugging
    const prefix = raw.slice(0, 80).replace(/\n/g, " ");
    throw new LlmError(
      "bad_output",
      `Invalid JSON response: ${err instanceof Error ? err.message : String(err)}. Prefix: "${prefix}"`,
    );
  }
}
