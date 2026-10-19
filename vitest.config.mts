import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // scrypt-based account tests and jsdom UI tests exceed the 5 s default when
  // every file runs in parallel on a slower machine.
  test: { testTimeout: 30_000 },
});
