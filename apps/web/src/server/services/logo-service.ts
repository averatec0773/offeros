import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultDbPath } from "../db/client";
import { safeFetch } from "../net/safe-fetch";

/**
 * A company logo, fetched once and kept on this machine.
 *
 * Two rules shape everything here.
 *
 * It is fetched from the EMPLOYER's own domain — the same host reconnaissance
 * is already talking to — and never from a logo service. Handing a third party
 * the list of companies someone is applying to, one lookup at a time, is
 * exactly the profile this app exists not to build.
 *
 * And it is only ever READ back from disk. The page renders a local route, so
 * an employer's server is never contacted while someone browses their own
 * applications.
 *
 * Everything about it is best-effort. A failure is silent and permanent for
 * that run: the letter avatar is not a degraded state, it is the floor, and it
 * is fine.
 */

/** Small: these render at 40px. Anything larger is not a favicon. */
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 3000;

/** Ids come from randomUUID, so this is what a legitimate one looks like.
 *  Everything else is refused before it can reach a path. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function logosDir(): string {
  return join(dirname(defaultDbPath()), "logos");
}

/** Recognised image signatures, and the extension we store each under. Magic
 *  bytes rather than the served content-type: a server can claim anything. */
function sniff(bytes: Uint8Array): { ext: string; mime: string } | null {
  const b = bytes;
  if (b.length < 8) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { ext: "png", mime: "image/png" };
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { ext: "gif", mime: "image/gif" };
  // ICO: reserved 0, type 1 (icon).
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) {
    return { ext: "ico", mime: "image/x-icon" };
  }
  // WEBP: "RIFF"…"WEBP"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) {
    const tag = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    if (tag === "WEBP") return { ext: "webp", mime: "image/webp" };
  }
  // SVG is deliberately NOT accepted: it is a document that can carry script,
  // and nothing here needs vectors badly enough to take that.
  return null;
}

const EXTENSIONS = ["png", "jpg", "gif", "ico", "webp"] as const;

export interface StoredLogo {
  filePath: string;
  mime: string;
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  ico: "image/x-icon",
  webp: "image/webp",
};

/**
 * The cached logo for an application, if one was ever stored.
 *
 * The path is BUILT from a validated id and a fixed extension list — it is
 * never taken from input — so there is no traversal to defend against, only an
 * id shape to refuse.
 */
export function getLogo(applicationId: string): StoredLogo | null {
  if (!SAFE_ID.test(applicationId)) return null;
  for (const ext of EXTENSIONS) {
    const filePath = join(logosDir(), `${applicationId}.${ext}`);
    if (existsSync(filePath)) return { filePath, mime: MIME[ext]! };
  }
  return null;
}

export function readLogo(applicationId: string): { bytes: Uint8Array; mime: string } | null {
  const found = getLogo(applicationId);
  if (!found) return null;
  try {
    return { bytes: new Uint8Array(readFileSync(found.filePath)), mime: found.mime };
  } catch {
    return null;
  }
}

/**
 * Fetch and store the favicon for a posting's host. Returns true only when
 * something valid landed on disk.
 *
 * Never throws, never retries. Called fire-and-forget from reconnaissance,
 * where it must not be able to affect the verdict.
 */
export async function cacheLogo(
  applicationId: string,
  pageUrl: string,
  fetchImpl: typeof fetch = fetch,
  /** Injected alongside fetch so a test can decide what a host resolves to;
   *  the guard has to resolve names, or a public name pointing at 127.0.0.1
   *  would sail through. */
  resolve?: (hostname: string) => Promise<string[]>,
): Promise<boolean> {
  if (!SAFE_ID.test(applicationId)) return false;
  if (getLogo(applicationId)) return true; // already have one; do not re-fetch

  let origin: string;
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    origin = url.origin;
  } catch {
    return false;
  }

  // Through the shared guard: an employer's host is still a host a link chose
  // for us, and a favicon fetch is as good a way into the local network as any.
  const result = await safeFetch(`${origin}/favicon.ico`, {
    fetchImpl,
    ...(resolve ? { resolve } : {}),
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
  });
  if (!result.ok) return false;
  if (result.response.status >= 400) return false;
  const bytes = result.bytes;
  if (bytes.length === 0) return false;
  const kind = sniff(bytes);
  if (!kind) return false;

  try {
    const dir = logosDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, `${applicationId}.${kind.ext}`), bytes, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}
