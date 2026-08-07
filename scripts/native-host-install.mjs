// Register the OfferOS native messaging host with Chrome so the side panel
// can start the local web app on demand (Chrome spawns the host per call — no
// standing daemon, nothing at login).
//
//   node scripts/native-host-install.mjs            # install / refresh
//   node scripts/native-host-install.mjs uninstall
//
// Zero-config: the unpacked extension's ID is derived from its load path, so
// this reads Chrome's profile Preferences to find every profile that has
// .output/chrome-mv3 loaded and allowlists those IDs. Re-run after moving the
// repo or loading the extension into a new profile. macOS + Chrome stable.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "com.offeros.host";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT_PATH = path.join(REPO, "apps", "extension", ".output", "chrome-mv3");
const CHROME_DIR = path.join(homedir(), "Library", "Application Support", "Google", "Chrome");
const MANIFEST = path.join(CHROME_DIR, "NativeMessagingHosts", `${HOST}.json`);
const WRAPPER_DIR = path.join(homedir(), ".offeros", "bin");
const WRAPPER = path.join(WRAPPER_DIR, "offeros-host");

if (process.platform !== "darwin") {
  console.error("macOS only for now — adapt the manifest path for your OS.");
  process.exit(1);
}

if (process.argv[2] === "uninstall") {
  rmSync(MANIFEST, { force: true });
  rmSync(WRAPPER, { force: true });
  console.log("native host unregistered");
  process.exit(0);
}

/** Every extension ID (across profiles) whose unpacked load path is ours. */
function findExtensionIds() {
  const ids = new Set();
  const profiles = readdirSync(CHROME_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (d.name === "Default" || d.name.startsWith("Profile ")))
    .map((d) => d.name);
  for (const profile of profiles) {
    // Unpacked-extension entries live in "Secure Preferences" on current
    // Chrome; check plain "Preferences" too for older layouts.
    for (const file of ["Secure Preferences", "Preferences"]) {
      const prefPath = path.join(CHROME_DIR, profile, file);
      if (!existsSync(prefPath)) continue;
      try {
        const prefs = JSON.parse(readFileSync(prefPath, "utf8"));
        const settings = prefs?.extensions?.settings ?? {};
        for (const [id, entry] of Object.entries(settings)) {
          if (typeof entry?.path === "string" && path.resolve(entry.path) === EXT_PATH) ids.add(id);
        }
      } catch {
        // unreadable profile — skip
      }
    }
  }
  return [...ids];
}

const ids = findExtensionIds();
if (ids.length === 0) {
  console.error(`No Chrome profile has the unpacked extension loaded from:\n  ${EXT_PATH}`);
  console.error("Load it via chrome://extensions → Load unpacked, then re-run this script.");
  process.exit(1);
}

mkdirSync(WRAPPER_DIR, { recursive: true });
writeFileSync(
  WRAPPER,
  `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(
    path.join(REPO, "scripts", "native-host", "offeros-host.mjs"),
  )}\n`,
);
chmodSync(WRAPPER, 0o755);

mkdirSync(path.dirname(MANIFEST), { recursive: true });
writeFileSync(
  MANIFEST,
  JSON.stringify(
    {
      name: HOST,
      description: "OfferOS local web-app launcher",
      path: WRAPPER,
      type: "stdio",
      allowed_origins: ids.map((id) => `chrome-extension://${id}/`),
    },
    null,
    2,
  ) + "\n",
);
console.log(`registered ${HOST} for extension id(s): ${ids.join(", ")}`);
console.log(`wrapper: ${WRAPPER}`);
