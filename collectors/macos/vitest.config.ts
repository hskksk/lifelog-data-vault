import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const ingestCore = fileURLToPath(new URL("../../packages/ingest-core/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@lifelog/ingest-core": ingestCore,
    },
  },
});
