// OfferOS native messaging host. Chrome spawns this process on demand when the
// extension calls sendNativeMessage("com.offeros.host", …) — the same pattern
// password managers use for their browser bridges. No standing daemon: this
// process lives for one exchange, and the web server it starts is a detached
// child that runs until stopped.
//
// Wire protocol (Chrome native messaging): each message is a 4-byte little-
// endian length followed by that many bytes of UTF-8 JSON, both directions.
//
// Commands:
//   {cmd:"status"} → {ok, running}
//   {cmd:"start"}  → spawns `npm run dev:web` (detached, logged) unless the
//                    port already answers; returns immediately — the panel
//                    polls readiness itself. → {ok, running, started?}
//   {cmd:"stop"}   → kills the pidfile'd process group. → {ok}
//
// Also runnable as a plain CLI (no framing): `node offeros-host.mjs cli-stop`.
import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = path.join(homedir(), ".offeros");
const LOG = path.join(DIR, "logs", "web.log");
const PIDFILE = path.join(DIR, "web.pid");
const URL_PROBE = "http://localhost:3000/api/v1/agent/fill/pending";

async function isRunning() {
  try {
    const res = await fetch(URL_PROBE, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function startServer() {
  mkdirSync(path.dirname(LOG), { recursive: true });
  const log = openSync(LOG, "a");
  // zsh -lc so the user's real PATH (nvm etc.) resolves npm; detached +
  // unref'd so the server outlives this short-lived host process.
  const child = spawn("/bin/zsh", ["-lc", `cd ${JSON.stringify(REPO)} && exec npm run dev:web`], {
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  writeFileSync(PIDFILE, String(child.pid));
  return child.pid;
}

function stopServer() {
  try {
    const pid = Number(readFileSync(PIDFILE, "utf8").trim());
    if (pid > 0) process.kill(-pid, "SIGTERM"); // whole detached process group
    rmSync(PIDFILE, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function handle(msg) {
  const cmd = msg?.cmd;
  if (cmd === "status") return { ok: true, running: await isRunning() };
  if (cmd === "start") {
    if (await isRunning()) return { ok: true, running: true };
    startServer();
    return { ok: true, running: false, started: true };
  }
  if (cmd === "stop") return { ok: stopServer() };
  return { ok: false, error: `unknown cmd: ${String(cmd)}` };
}

// ---- CLI mode (no Chrome framing) --------------------------------------
if (process.argv[2] === "cli-stop") {
  console.log(stopServer() ? "stopped" : "nothing to stop (no pidfile)");
  process.exit(0);
}
if (process.argv[2] === "cli-status") {
  console.log((await isRunning()) ? "running" : "not running");
  process.exit(0);
}

// ---- Chrome native messaging mode --------------------------------------
function writeFrame(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) return;
    const body = buf.subarray(4, 4 + len);
    buf = buf.subarray(4 + len);
    void (async () => {
      let msg;
      try {
        msg = JSON.parse(body.toString("utf8"));
      } catch {
        writeFrame({ ok: false, error: "bad json" });
        return;
      }
      writeFrame(await handle(msg));
    })();
  }
});
process.stdin.on("end", () => process.exit(0));
