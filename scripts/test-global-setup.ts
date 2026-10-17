/**
 * Purpose: the ONE place dist/lore is built for a test run (task-skill-implement-tg-24), wired as
 * vitest `globalSetup` in vitest.shared.ts. Builds only when dist/lore is missing or older than the
 * sources (scripts/run-tests.ts builds unconditionally first, so a full run always starts from a
 * fresh binary; this covers a single-file `vitest run`). Then snapshots dist/lore and, at teardown,
 * fails the run loud if anything wrote it (scripts/dist-write-guard.ts).
 * Public surface: default export `setup()` returning the teardown function.
 * Invariants: a failed build throws before any test starts; no test may write dist/.
 * Side-effect class: IO (spawns `bun run build`, reads dist/lore).
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isBinaryStale } from "../packages/lore/tests/integration/helpers/assert-fresh-binary";
import { assertBinaryUnchanged, snapshotBinary } from "./dist-write-guard";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const DIST_LORE = join(ROOT, "dist", "lore");
const SOURCE_DIRS = [join(ROOT, "packages", "lore", "src"), join(ROOT, "packages", "core", "src")];

/** vitest globalSetup entry: build if needed, snapshot, return the teardown that asserts no write. */
export default function setup(): () => void {
  if (isBinaryStale(DIST_LORE, SOURCE_DIRS)) {
    console.log("[test-global-setup] dist/lore missing or stale: running `bun run build` once");
    const build = spawnSync("bun", ["run", "build"], { cwd: ROOT, stdio: "inherit", timeout: 600_000 });
    if (build.status !== 0) {
      throw new Error(
        `[test-global-setup] \`bun run build\` failed (exit ${String(build.status)}, signal ${String(build.signal)}); ` +
          `no test can run against a missing or stale dist/lore`,
      );
    }
  }
  const before = snapshotBinary(DIST_LORE);
  return () => assertBinaryUnchanged(before, DIST_LORE);
}
