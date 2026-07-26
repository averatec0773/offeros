import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ok, notFound, badRequest, handle, ERROR_CODES } from "../envelope";

describe("envelope", () => {
  it("wraps a success result", async () => {
    const res = ok({ hello: "world" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      errorCode: ERROR_CODES.OK,
      errorMsg: null,
      result: { hello: "world" },
    });
  });

  it("reports not found with a 404", async () => {
    const res = notFound("application");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.errorCode).toBe(ERROR_CODES.NOT_FOUND);
    expect(body.result).toBeNull();
  });

  it("reports bad request with a 400", async () => {
    const res = badRequest("nope");
    expect(res.status).toBe(400);
    expect((await res.json()).errorCode).toBe(ERROR_CODES.BAD_REQUEST);
  });

  it("maps a ZodError to a 400 through handle()", async () => {
    const res = await handle(() => {
      z.object({ a: z.string() }).parse({});
      return ok(null);
    });
    expect(res.status).toBe(400);
    expect((await res.json()).errorCode).toBe(ERROR_CODES.BAD_REQUEST);
  });

  it("maps a SyntaxError to a 400 through handle()", async () => {
    const res = await handle(() => {
      throw new SyntaxError("Unexpected token n in JSON at position 0");
    });
    expect(res.status).toBe(400);
    expect((await res.json()).errorCode).toBe(ERROR_CODES.BAD_REQUEST);
  });

  it("maps an unexpected error to a 500 through handle()", async () => {
    const res = await handle(() => {
      throw new Error("boom");
    });
    expect(res.status).toBe(500);
    expect((await res.json()).errorCode).toBe(ERROR_CODES.INTERNAL);
  });
});
