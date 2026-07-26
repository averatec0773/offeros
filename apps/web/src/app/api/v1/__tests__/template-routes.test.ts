import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Template } from "@offeros/core";

const dir = mkdtempSync(join(tmpdir(), "offeros-template-api-"));
process.env.OFFEROS_DB_PATH = join(dir, "templates.db");

const listRoute = await import("../templates/route");
const idRoute = await import("../templates/[id]/route");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Env<T> = { success: boolean; errorCode: number; errorMsg: string | null; result: T | null };
async function body<T>(res: Response): Promise<Env<T>> {
  return (await res.json()) as Env<T>;
}
function post(payload?: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const BASE = { name: "T1", kind: "cover-letter", renderer: "latex", content: "hello" };

describe("templates routes", () => {
  it("GET empty, POST create, GET list", async () => {
    const empty = await body<Template[]>(await listRoute.GET());
    expect(empty.result).toEqual([]);

    const created = await body<Template>(await listRoute.POST(post(BASE)));
    expect(created.success).toBe(true);
    expect(created.result!.name).toBe("T1");

    const list = await body<Template[]>(await listRoute.GET());
    expect(list.result).toHaveLength(1);
  });

  it("POST with unknown kind is a 400 ServiceError envelope", async () => {
    const res = await listRoute.POST(post({ ...BASE, name: "bad", kind: "resume" }));
    expect(res.status).toBe(400);
    const b = await body(res);
    expect(b.success).toBe(false);
  });

  it("PUT updates, DELETE removes, 404 for unknown id", async () => {
    const created = (await body<Template>(await listRoute.POST(post({ ...BASE, name: "T2" }))))
      .result!;

    const updated = await body<Template>(
      await idRoute.PUT(post({ ...BASE, name: "T2-renamed" }), idCtx(created.id)),
    );
    expect(updated.result!.name).toBe("T2-renamed");
    expect(updated.result!.id).toBe(created.id);

    const missing = await idRoute.PUT(post(BASE), idCtx("nope"));
    expect(missing.status).toBe(404);

    const del = await idRoute.DELETE(new Request("http://localhost"), idCtx(created.id));
    expect((await body<{ id: string }>(del)).result!.id).toBe(created.id);

    const delMissing = await idRoute.DELETE(new Request("http://localhost"), idCtx("nope"));
    expect(delMissing.status).toBe(404);
  });
});
