import { defineConfig } from "vitest/config";

// Root Vitest config: orchestrates workspace "projects" instead of the
// deprecated `vitest.workspace.ts` file (Vitest 4 uses `test.projects`).
// apps/extension is intentionally NOT a project here — it ships its own
// vitest.config.ts (WXT/jsdom environment) and must keep running via
// `npm run test -w @offeros/extension`. Including it here would run its
// 83 test files without that environment and produce spurious failures.
// The explicit exclude below is a belt-and-braces guard: apps/web's own
// vitest.config.ts also excludes apps/extension, but this keeps the root
// config correct even if that ever changes.
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/web"],
    exclude: ["**/node_modules/**", "**/.git/**", "apps/extension/**"],
  },
});
