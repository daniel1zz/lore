/**
 * Purpose: prove that a test-runner invocation wrote nothing into the repository tree (AC-TG-3,
 * task-skill-implement-tg-5). Extends the dist/src write guard (scripts/dist-write-guard.ts) to every
 * non-ignored path: the snapshot is `git status --porcelain --untracked-files=all` plus a sha256 of each
 * listed file, so tracked-modified, tracked-deleted and untracked files are all covered while gitignored
 * build output (dist/, generated assets, .tanstack scratch, .lore db) is out of scope by construction.
 * Public surface: {@link snapshotRepoTree}, {@link assertRepoTreeUnchanged}, {@link readIsolationLedger},
 * {@link TreeWrittenDuringRunError}, {@link IsolationLedgerError}, {@link IsolationLedgerEntry}.
 * Invariants: a path's fingerprint is its content hash, "deleted", or (absent from status) "clean"; any
 * difference between the before and after fingerprint is a write. A ledger entry excuses exactly its path and
 * needs a non-empty reason; an entry whose path is neither in the tree nor on disk is stale and fails.
 * Side-effect class: IO (spawns `git status`, reads files named by it).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** Path (repo-relative, forward slashes) -> content fingerprint of every non-ignored path git reports dirty. */
export type RepoTreeSnapshot = ReadonlyMap<string, string>;

/** Raised when paths changed during the run and the ledger does not excuse them. */
export class TreeWrittenDuringRunError extends Error {
  constructor(readonly changedPaths: readonly string[]) {
    super(
      `a test run created or modified ${changedPaths.length} file(s) in the repository tree: ${changedPaths.join(", ")}. ` +
        `Tests write under mkdtemp (os.tmpdir()), never into the repo; a write that cannot move gets a row ` +
        `{path, rule, reason, bound_ac} in scripts/test-isolation-ledger.json.`,
    );
    this.name = "TreeWrittenDuringRunError";
  }
}

/** Raised when scripts/test-isolation-ledger.json is malformed or holds a stale or reason-less row. */
export class IsolationLedgerError extends Error {
  constructor(
    readonly ledgerPath: string,
    readonly problems: readonly string[],
  ) {
    super(`${ledgerPath} is invalid: ${problems.join("; ")}`);
    this.name = "IsolationLedgerError";
  }
}

const IsolationLedgerEntrySchema = z.object({
  path: z.string().min(1),
  rule: z.string().min(1),
  reason: z.string().min(1),
  bound_ac: z.string().min(1),
});
/** One excused write: the repo-relative path, the rule it would break, why, and the AC it is bound to. */
export type IsolationLedgerEntry = z.infer<typeof IsolationLedgerEntrySchema>;
const IsolationLedgerSchema = z.array(IsolationLedgerEntrySchema);

/**
 * Reads and validates the ledger.
 *
 * @throws {IsolationLedgerError} when the file is missing, is not valid JSON, or a row has an empty field.
 */
export function readIsolationLedger(ledgerPath: string): readonly IsolationLedgerEntry[] {
  if (!existsSync(ledgerPath)) throw new IsolationLedgerError(ledgerPath, ["the file does not exist"]);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch (cause) {
    throw new IsolationLedgerError(ledgerPath, [`not valid JSON (${cause instanceof Error ? cause.message : String(cause)})`]);
  }
  const parsed = IsolationLedgerSchema.safeParse(raw);
  if (!parsed.success) {
    throw new IsolationLedgerError(ledgerPath, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  return parsed.data;
}

function runGitStatus(root: string): string[] {
  // reason: --no-renames keeps one path per record under -z; --untracked-files=all lists files, not dirs.
  const git = spawnSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (git.status !== 0) {
    throw new Error(`git status failed in ${root} (exit ${String(git.status)}): ${git.stderr}; the tree snapshot cannot be taken`);
  }
  return git.stdout.split("\0").filter((record) => record.length > 0);
}

/**
 * Snapshots every non-ignored dirty path under `root` with a content hash.
 *
 * @param root - Absolute repository root (a git work tree).
 * @throws {Error} when `git status` fails.
 */
export function snapshotRepoTree(root: string): RepoTreeSnapshot {
  const snapshot = new Map<string, string>();
  for (const record of runGitStatus(root)) {
    const path = record.slice(3);
    const absolute = join(root, path);
    snapshot.set(path, fingerprintPath(absolute));
  }
  return snapshot;
}

/** Content hash of a file, the link target of a symlink (never followed: node_modules may be one), or "deleted". */
function fingerprintPath(absolute: string): string {
  let stats;
  try {
    stats = lstatSync(absolute);
  } catch {
    // reason: ENOENT is the expected shape of a tracked file deleted in the work tree, not a failure.
    return "deleted";
  }
  if (stats.isSymbolicLink()) return `symlink:${readlinkSync(absolute)}`;
  if (stats.isDirectory()) return "directory";
  return createHash("sha256").update(readFileSync(absolute)).digest("hex");
}

/**
 * Throws when the tree differs from `before` in any path the ledger does not list, or when the ledger is stale.
 *
 * @param before - Snapshot taken after the one build, before the tests.
 * @param root - Absolute repository root, re-read now.
 * @param ledger - Validated ledger rows.
 * @param ledgerPath - Only used to name the ledger in errors.
 * @throws {TreeWrittenDuringRunError} naming every unexcused changed path, sorted.
 * @throws {IsolationLedgerError} naming every row whose path is neither in the tree nor on disk.
 */
export function assertRepoTreeUnchanged(
  before: RepoTreeSnapshot,
  root: string,
  ledger: readonly IsolationLedgerEntry[],
  ledgerPath: string,
): void {
  const after = snapshotRepoTree(root);
  const changed = new Set<string>();
  for (const [path, fingerprint] of after) if ((before.get(path) ?? "clean") !== fingerprint) changed.add(path);
  for (const path of before.keys()) if (!after.has(path)) changed.add(path);

  const excused = new Set(ledger.map((row) => row.path));
  const stale = ledger.filter((row) => !existsSync(join(root, row.path)) && !changed.has(row.path)).map((row) => row.path);
  if (stale.length > 0) {
    throw new IsolationLedgerError(ledgerPath, stale.map((path) => `row for ${path} is stale: no such file in the tree`));
  }
  const unexcused = [...changed].filter((path) => !excused.has(path)).sort();
  if (unexcused.length > 0) throw new TreeWrittenDuringRunError(unexcused);
}
