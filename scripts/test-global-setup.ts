/**
 * Purpose: the ONE place dist/lore is built for a test run (task-skill-implement-tg-24), wired as
 * vitest `globalSetup` in vitest.shared.ts. Builds only when dist/lore is missing or older than the
 * sources (scripts/run-tests.ts builds unconditionally first, so a full run always starts from a
 * fresh binary; this covers a single-file `vitest run`). Right after that build it snapshots dist/lore
 * AND every `.ts` mtime under packages/{lore,core}/src; at teardown it fails the run loud if either
 * moved (scripts/dist-write-guard.ts). While tests run it also polls both and remembers when each
 * change was FIRST seen, so the failure names the moment, not only the end state.
 * Public surface: default export `setup()` returning the teardown function.
 * Invariants: a failed build throws before any test starts; no test may write dist/ or any package's src dir;
 * a NESTED run (a vitest a test spawned, marked by LORE_TEST_RUN_ACTIVE) does nothing at all.
 * Side-effect class: IO (spawns `bun run build`, reads dist/lore and the source tree, sets one env var).
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isBinaryStale } from "../packages/lore/tests/integration/helpers/assert-fresh-binary";
import {
  DistWrittenDuringRunError,
  SourceTreeWrittenDuringRunError,
  TEST_RUN_ACTIVE_ENV,
  assertBinaryUnchanged,
  assertSourceTreeUnchanged,
  isNestedTestRun,
  snapshotBinary,
  snapshotSourceTree,
} from "./dist-write-guard";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const DIST_LORE = join(ROOT, "dist", "lore");
const SOURCE_DIRS = [join(ROOT, "packages", "lore", "src"), join(ROOT, "packages", "core", "src")];
const WATCH_INTERVAL_MS = 3_000;

/** vitest globalSetup entry: build if needed, snapshot, return the teardown that asserts no write. */
export default function setup(): () => void {
  if (isNestedTestRun(process.env)) {
    // reason: this vitest was spawned by a test of the outer run. Building here would rewrite dist/lore
    // under the outer run's feet; the outer run owns the build and the guard.
    return () => undefined;
  }
  process.env[TEST_RUN_ACTIVE_ENV] = "1";

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
  const binaryBefore = snapshotBinary(DIST_LORE);
  const sourceBefore = snapshotSourceTree(SOURCE_DIRS);

  const firstSeen: string[] = [];
  let reported = false;
  const watcher = setInterval(() => {
    if (reported) return;
    try {
      assertBinaryUnchanged(binaryBefore, DIST_LORE);
      assertSourceTreeUnchanged(sourceBefore, SOURCE_DIRS);
    } catch (caught) {
      reported = true;
      const message = caught instanceof Error ? caught.message : String(caught);
      firstSeen.push(`${new Date().toISOString()} (first noticed): ${message}`);
      console.error(`[test-global-setup] FIRST WRITE DETECTED ${firstSeen[0]}`);
    }
  }, WATCH_INTERVAL_MS);
  watcher.unref();

  return () => {
    clearInterval(watcher);
    const problems: string[] = [];
    for (const check of [
      () => assertBinaryUnchanged(binaryBefore, DIST_LORE),
      () => assertSourceTreeUnchanged(sourceBefore, SOURCE_DIRS),
    ]) {
      try {
        check();
      } catch (caught) {
        if (caught instanceof DistWrittenDuringRunError || caught instanceof SourceTreeWrittenDuringRunError) {
          problems.push(caught.message);
        } else {
          throw caught;
        }
      }
    }
    if (problems.length > 0) {
      throw new Error(`${problems.join("\n")}${firstSeen.length > 0 ? `\nfirst noticed during the run: ${firstSeen[0]}` : ""}`);
    }
  };
}
