import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    name: "@offeros/web",
    environment: "node",
    exclude: ["**/node_modules/**", "**/.git/**"],
  },
});
