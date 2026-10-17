/**
 * The ONE test runner config (TG-23): vitest on the Bun runtime — `bunx --bun vitest run`.
 * Runs every test file on disk except the few listed BY FILE in vitest.node-files.ts, which
 * `vitest.node.config.ts` runs under Node (each with its reason). scripts/check-test-file-census.ts
 * proves files on disk == files run across the two invocations.
 */
import { createConfig, ALL_TEST_GLOBS } from "./vitest.shared";
import { NODE_PROJECT_FILES } from "./vitest.node-files";

export default createConfig({
  include: ALL_TEST_GLOBS,
  // reason: the former `*.bun.test.ts` files run here too; "**/*.pw.ts" (Playwright specs) can
  // never be pulled in by an include-glob change. SPEC-022 §9.7.
  exclude: ["**/*.pw.ts", "node_modules/**", ...Object.keys(NODE_PROJECT_FILES)],
});
