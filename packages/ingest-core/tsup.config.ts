import { defineConfig } from "tsup";

/** Edge ingest loads dist/bronze.js (no node deps). Materialize imports src/*.ts via Deno. */
export default defineConfig({
  entry: { bronze: "src/entry/bronze.ts" },
  format: ["esm"],
  outDir: "dist",
  clean: true,
  dts: false,
  splitting: false,
});
