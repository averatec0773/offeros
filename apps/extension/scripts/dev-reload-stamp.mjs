// Post-build: write a build stamp into the unpacked output. Chrome serves
// unpacked-extension files straight from disk, so the running extension can
// poll its own stamp (src/lib/dev-reload.ts) and reload itself when a new
// build lands — no CDP, no relaunch, no store impact (`wxt zip` runs its own
// internal build and never chains this script, so zips carry no stamp and
// the watcher stays inert).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.output/chrome-mv3/dev-reload-stamp.json",
);
writeFileSync(out, JSON.stringify({ builtAt: new Date().toISOString() }));
console.log(`dev-reload stamp written: ${out}`);
