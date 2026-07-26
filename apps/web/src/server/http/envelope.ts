import { ZodError } from "zod";

export const ERROR_CODES = {
  OK: 10000,
  BAD_REQUEST: 40000,
  NOT_FOUND: 40400,
  INTERNAL: 50000,
} as const;

export type ApiEnvelope<T> = {
  success: boolean;
  errorCode: number;
  errorMsg: string | null;
  result: T | null;
};

export function ok<T>(result: T): Response {
  const body: ApiEnvelope<T> = {
    success: true,
    errorCode: ERROR_CODES.OK,
    errorMsg: null,
    result,
  };
  return Response.json(body);
}

export function fail(
  code: number,
  message: string,
  httpStatus: number,
  detail?: unknown,
): Response {
  const body: ApiEnvelope<never> & { detail?: unknown } = {
    success: false,
    errorCode: code,
    errorMsg: message,
    result: null,
  };
  if (detail !== undefined) body.detail = detail;
  return Response.json(body, { status: httpStatus });
}

export function notFound(what: string): Response {
  return fail(ERROR_CODES.NOT_FOUND, `${what} not found`, 404);
}

export function badRequest(message: string, issues?: unknown): Response {
  return fail(ERROR_CODES.BAD_REQUEST, message, 400, issues);
}

/** Wrap a route handler so thrown errors become envelopes instead of stack traces. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ZodError) return badRequest("validation failed", error.issues);
    if (error instanceof SyntaxError) return badRequest("malformed JSON body");
    // A service precondition failure (bad task/ticket state). Matched by name to
    // keep this http helper decoupled from the services layer. Routes pre-check
    // entity existence and return notFound, so what reaches here is a 400.
    if (error instanceof Error && error.name === "ServiceError") return badRequest(error.message);
    const message = error instanceof Error ? error.message : "unexpected error";
    return fail(ERROR_CODES.INTERNAL, message, 500);
  }
}
