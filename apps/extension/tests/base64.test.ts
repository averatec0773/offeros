import { describe, expect, it } from "vitest";
import { bytesToBase64, base64ToBytes } from "../src/lib/autofill/base64";

describe("bytesToBase64 / base64ToBytes", () => {
  it("round-trips small byte arrays", () => {
    const original = new Uint8Array([0, 1, 2, 253, 254, 255, 65, 66, 67]);
    const b64 = bytesToBase64(original);
    expect(typeof b64).toBe("string");
    expect(base64ToBytes(b64)).toEqual(original);
  });

  it("round-trips an ArrayBuffer", () => {
    const original = new Uint8Array([10, 20, 30]).buffer;
    const roundTripped = base64ToBytes(bytesToBase64(original));
    expect(Array.from(roundTripped)).toEqual([10, 20, 30]);
  });

  it("round-trips bytes larger than the internal chunk size (0x8000)", () => {
    const size = 0x8000 * 2 + 137;
    const original = new Uint8Array(size);
    for (let i = 0; i < size; i++) original[i] = i % 256;
    const roundTripped = base64ToBytes(bytesToBase64(original));
    expect(roundTripped).toEqual(original);
  });

  it("round-trips an empty byte array", () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  it("decodes a known base64 string to the expected bytes", () => {
    // "OfferOS" in ASCII
    const bytes = base64ToBytes("T2ZmZXJPUw==");
    expect(Buffer.from(bytes).toString("utf-8")).toBe("OfferOS");
  });
});
