/**
 * Purpose: prove that no test wrote `dist/lore` during a run (task-skill-implement-tg-24).
 * Public surface: {@link snapshotBinary}, {@link assertBinaryUnchanged}, {@link DistWrittenDuringRunError}.
 * Invariants: a snapshot is (size, mtimeMs, sha256 of the bytes); ANY difference, including a rewrite of
 * identical bytes (mtime moves, which is what trips the stale-binary check of a parallel compiled test),
 * counts as a write. A missing binary fails loud, never a placeholder snapshot.
 * Side-effect class: IO (reads the binary).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";

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
