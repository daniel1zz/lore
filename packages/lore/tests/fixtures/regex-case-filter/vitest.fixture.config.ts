/**
 * Isolated vitest config for `literal-ac-titles.fixture.ts`
 * (task-a-t-filter-is-a-regex-so-this-repo-s-own-ac-titles).
 *
 * Exists so the guard test can run a REAL vitest process against exactly one
 * fixture file without that file being discoverable by the root
 * `vitest.config.ts` (whose include globs would otherwise enrol it in every
 * full-suite run — and an explicit `vitest run <path>` argument only FILTERS
 * the globbed set, it never adds a file outside it, so the fixture needs a
 * config of its own rather than a bare path argument).
 *
 * `root` is pinned to THIS file's directory, not left to default: vitest
 * resolves `root` from `process.cwd()`, so a bare include glob would be
 * evaluated against whatever directory the spawning test happened to run in
 * and report "No test files found, exiting with code 1" (measured). Pinning it
 * makes the child run independent of the parent's cwd.
 *
 * Deliberately minimal otherwise: no setupFiles, no aliases, no worker caps —
 * the fixture asserts constants only, and every option omitted here is one
 * fewer reason for the child run's matched count to differ from the parent's.
 */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: ["*.fixture.ts"],
    environment: "node",
    globals: false,
  },
});
