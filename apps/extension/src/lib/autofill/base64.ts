/**
 * The wire hop for a file's bytes across `tabs.sendMessage`: the panel fetches
 * a résumé/cover-letter PDF as an ArrayBuffer, but the messaging bridge JSON-
 * serializes payloads (see autofill-messaging.ts's FillResponse.outcomes
 * comment — a Map/typed-array arrives mangled), so bytes cross as a plain
 * base64 string rather than the ArrayBuffer or a `number[]` (which would
 * bloat a multi-hundred-KB PDF into a huge JSON array). Decoded back into a
 * Uint8Array on the content-script side to build the File for attachFile.
 */
export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
