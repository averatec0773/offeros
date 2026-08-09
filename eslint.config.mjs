import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/.next/**", "**/.output/**", "**/.wxt/**", "**/drizzle/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Node CLI scripts (capture-form.mjs, the extension's E2E harnesses) and
    // CommonJS build config run under Node, not the browser.
    files: ["scripts/**/*.{js,mjs}", "apps/extension/scripts/**", "**/*.cjs"],
    // The extension harnesses also carry page.evaluate() bodies, which run in
    // the page (and, inside the extension's own contexts, reach `chrome`).
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, chrome: "readonly" },
    },
  },
  {
    // Vitest suites: jsdom gives them the browser globals, the runner gives
    // them Node's. The extension went unlinted entirely until a refactor audit
    // found dead code in it that no check could have caught, so its tests are
    // in scope too rather than exempt.
    files: ["**/tests/**", "**/__tests__/**", "**/*.test.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  prettier,
);
