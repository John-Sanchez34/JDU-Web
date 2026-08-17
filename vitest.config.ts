import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one Postgres database: the harness migrates it on
    // first use and TRUNCATEs it between tests. Vitest runs each test file in
    // its own worker process by default, so parallel files race — two workers
    // apply the same migration at once on a cold database, and one file's
    // TRUNCATE empties tables another file is mid-test on. Running files
    // sequentially is what makes a single shared database safe.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
});
