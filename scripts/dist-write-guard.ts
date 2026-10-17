/**
 * Purpose: prove that no test wrote `dist/lore` during a run (task-skill-implement-tg-24).
 * Public surface: {@link snapshotBinary}, {@link assertBinaryUnchanged}, {@link DistWrittenDuringRunError}.
 * Invariants: a snapshot is (size, mtimeMs, sha256 of the bytes); ANY difference, including a rewrite of
 * identical bytes (mtime moves, which is what trips the stale-binary check of a parallel compiled test),
 * counts as a write. A missing binary fails loud, never a placeholder snapshot.
 * Side-effect class: IO (reads the binary).
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Environment marker the OUTER run's global setup sets so any vitest a test spawns (it inherits the
 * environment) knows it is nested and must neither build nor snapshot dist/lore. A nested
 * `vitest run` loads the same vitest.shared.ts, so without this its global setup would rebuild a
 * "stale" dist/lore in the middle of the outer run.
 */
export const TEST_RUN_ACTIVE_ENV = "LORE_TEST_RUN_ACTIVE";

/** True when `env` says an outer test run is already active. */
export function isNestedTestRun(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[TEST_RUN_ACTIVE_ENV] === "1";
}

/** Path -> mtimeMs of every `.ts` file under the snapshotted source directories. */
export type SourceTreeSnapshot = ReadonlyMap<string, number>;

/** Raised when a `.ts` file under the source dirs was added, removed or touched during the run. */
export class SourceTreeWrittenDuringRunError extends Error {
  constructor(readonly changedPaths: readonly string[]) {
    super(
      `a test run changed ${changedPaths.length} source file(s) the stale-binary check compares against dist/lore: ` +
        `${changedPaths.join(", ")}. Any such write makes every compiled test fail with "dist/lore is stale". ` +
        `No test may write packages/*/src; a test that needs a built tree works in a mkdtemp copy.`,
    );
    this.name = "SourceTreeWrittenDuringRunError";
  }
}

function collectTsMtimes(dir: string, into: Map<string, number>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collectTsMtimes(path, into);
    else if (entry.isFile() && entry.name.endsWith(".ts")) into.set(path, statSync(path).mtimeMs);
  }
}

/**
 * Records the mtime of every `.ts` file under `dirs` (the dirs tests/integration/helpers/
 * assert-fresh-binary.ts compares against dist/lore).
 *
 * @throws {Error} when a directory does not exist.
 */
export function snapshotSourceTree(dirs: readonly string[]): SourceTreeSnapshot {
  const into = new Map<string, number>();
  for (const dir of dirs) {
    if (!existsSync(dir)) throw new Error(`cannot snapshot source dir ${dir}: it does not exist`);
    collectTsMtimes(dir, into);
  }
  return into;
}

/**
 * Throws when any `.ts` file under `dirs` was added, removed, or has a different mtime than in `before`.
 *
 * @throws {SourceTreeWrittenDuringRunError} naming every such path, sorted.
 */
export function assertSourceTreeUnchanged(before: SourceTreeSnapshot, dirs: readonly string[]): void {
  const after = snapshotSourceTree(dirs);
  const changed = new Set<string>();
  for (const [path, mtime] of after) if (before.get(path) !== mtime) changed.add(path);
  for (const path of before.keys()) if (!after.has(path)) changed.add(path);
  if (changed.size > 0) throw new SourceTreeWrittenDuringRunError([...changed].sort());
}

/** What a binary looked like at one instant. */
export interface BinarySnapshot {
  readonly path: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly sha256: string;
}

/** Raised when `dist/lore` differs from its snapshot taken before the tests ran. */
export class DistWrittenDuringRunError extends Error {
  constructor(
    readonly path: string,
    readonly differences: readonly string[],
  ) {
    super(
      `a test run wrote ${path}: ${differences.join("; ")}. dist/lore is built once, before any test ` +
        `(scripts/test-global-setup.ts); a test that needs its own binary builds it into a mkdtemp dir ` +
        `(\`bun scripts/build.ts --outfile <abs path>\`).`,
    );
    this.name = "DistWrittenDuringRunError";
  }
}

/**
 * Records size, mtime and content hash of `path`.
 *
 * @param path - Absolute path of the binary.
 * @throws {Error} when the file does not exist.
 * @example
 * const before = snapshotBinary("/repo/dist/lore");
 */
export function snapshotBinary(path: string): BinarySnapshot {
  if (!existsSync(path)) {
    throw new Error(`cannot snapshot ${path}: it does not exist (the one build before the tests did not produce it)`);
  }
  const stats = statSync(path);
  return {
    path,
    sizeBytes: stats.size,
    mtimeMs: stats.mtimeMs,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

/**
 * Throws when `path` no longer matches `before`.
 *
 * @param before - Snapshot from {@link snapshotBinary}, taken before the tests.
 * @param path - Same path, re-read now.
 * @throws {DistWrittenDuringRunError} naming each difference (missing, size, mtime, content).
 */
export function assertBinaryUnchanged(before: BinarySnapshot, path: string): void {
  if (!existsSync(path)) {
    throw new DistWrittenDuringRunError(path, ["the binary was deleted"]);
  }
  const after = snapshotBinary(path);
  const differences: string[] = [];
  if (after.sizeBytes !== before.sizeBytes) differences.push(`size ${before.sizeBytes} -> ${after.sizeBytes}`);
  if (after.mtimeMs !== before.mtimeMs) differences.push(`mtime ${before.mtimeMs} -> ${after.mtimeMs}`);
  if (after.sha256 !== before.sha256) differences.push(`content sha256 ${before.sha256.slice(0, 12)} -> ${after.sha256.slice(0, 12)}`);
  if (differences.length > 0) throw new DistWrittenDuringRunError(path, differences);
}
