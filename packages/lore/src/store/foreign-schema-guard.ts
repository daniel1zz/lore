/**
 * Foreign-schema guard: refuses to let a linked git worktree run the main
 * checkout's corpus migrations.
 *
 * Purpose: `SQLiteStore`'s constructor unconditionally migrates a behind
 * `.lore/lore.db`. A worktree without its own `.lore/` resolves the MAIN
 * checkout's corpus (corpus-resolution.ts, SPEC M4), so a worktree running an
 * older or newer binary would silently rewrite main's schema. This guard runs
 * BEFORE `new SQLiteStore` on every adapter/composition path that opens a
 * discovered corpus.
 *
 * Public surface: {@link findForeignBehindSchema},
 * {@link assertNoForeignSchemaMigration}, {@link ForeignSchemaMigrationRefusedError}.
 *
 * Invariants:
 *   - Never writes: the version read is a readonly handle (`probeSchemaVersion`).
 *   - Only a corpus that is BOTH the main checkout's own `.lore/lore.db` AND
 *     opened from a linked worktree AND behind `LATEST_SCHEMA_VERSION` is refused.
 *     A worktree with its own `.lore/`, the main checkout itself, and a probe
 *     failure all pass through (a probe failure is surfaced loudly by the
 *     constructor's own open, so nothing is hidden).
 *   - The `SQLiteStore` constructor is deliberately unchanged (init paths rely
 *     on its migrate-on-open); callers opt in by calling this guard first.
 *
 * Side-effect class: IO (spawns `git rev-parse`, opens the db readonly).
 *
 * Source: spec-close-the-eight-verified-critical-defects-no-judge-listing §Design F5 (AC-CRIT-7).
 */

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { probeSchemaVersion } from "./schema-probe.js";
import { LATEST_SCHEMA_VERSION } from "./schema-version.js";

/** Facts about a refused open: main's corpus is behind and cwd is a linked worktree. */
export interface ForeignBehindSchema {
  readonly dbPath: string;
  readonly userVersion: number;
  readonly latestVersion: number;
  readonly message: string;
}

/**
 * Thrown by {@link assertNoForeignSchemaMigration} (composition-root callers).
 * Carries the structured facts; `message` is the user-facing sentence.
 */
export class ForeignSchemaMigrationRefusedError extends Error {
  readonly dbPath: string;
  readonly userVersion: number;
  readonly latestVersion: number;

  constructor(facts: ForeignBehindSchema) {
    super(facts.message);
    this.name = "ForeignSchemaMigrationRefusedError";
    this.dbPath = facts.dbPath;
    this.userVersion = facts.userVersion;
    this.latestVersion = facts.latestVersion;
  }
}

function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // reason: a path that does not exist cannot be a foreign corpus; the
    // lexical form is only used for an equality comparison that then fails.
    return resolve(path);
  }
}

/** Main checkout root when `cwd` is inside a LINKED worktree; `undefined` otherwise (primary checkout, non-git, probe failure). */
function mainCheckoutRootOfLinkedWorktree(cwd: string): string | undefined {
  const gitDir = spawnSync("git", ["rev-parse", "--git-dir"], { cwd, encoding: "utf8", timeout: 5000 });
  const commonDir = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8", timeout: 5000 });
  if (gitDir.status !== 0 || commonDir.status !== 0) return undefined;
  const gitDirText = gitDir.stdout?.trim();
  const commonDirText = commonDir.stdout?.trim();
  if (!gitDirText || !commonDirText) return undefined;
  const gitDirAbs = realOrResolved(resolve(cwd, gitDirText));
  const commonDirAbs = realOrResolved(resolve(cwd, commonDirText));
  if (gitDirAbs === commonDirAbs) return undefined;
  return dirname(commonDirAbs);
}

/**
 * Decides whether opening `dbPath` from `cwd` would migrate a foreign (main
 * checkout) corpus from a linked worktree.
 *
 * @param dbPath - the discovered `.lore/lore.db` about to be opened
 * @param cwd - defaults to `process.cwd()`; tests pass a fixture directory
 * @returns the refusal facts, or `null` when opening is safe
 * @example
 *   const behind = findForeignBehindSchema(findLoreDbPath());
 *   if (behind !== null) refuse(behind.message);
 */
export function findForeignBehindSchema(dbPath: string, cwd: string = process.cwd()): ForeignBehindSchema | null {
  const mainRoot = mainCheckoutRootOfLinkedWorktree(cwd);
  if (mainRoot === undefined) return null;
  const mainDb = join(mainRoot, ".lore", "lore.db");
  if (!existsSync(mainDb) || !existsSync(dbPath)) return null;
  if (realOrResolved(dbPath) !== realOrResolved(mainDb)) return null;

  const probe = probeSchemaVersion(dbPath);
  if (!probe.ok) return null;
  const userVersion = probe.value.user_version;
  if (userVersion >= LATEST_SCHEMA_VERSION) return null;
  return {
    dbPath,
    userVersion,
    latestVersion: LATEST_SCHEMA_VERSION,
    message:
      `schema mismatch: the main checkout's corpus at '${dbPath}' is at schema version ${userVersion}, ` +
      `this binary needs ${LATEST_SCHEMA_VERSION}; a linked worktree never migrates the main checkout's corpus — ` +
      `run any lore command once from the main checkout to migrate it, then retry`,
  };
}

/**
 * Throwing form of {@link findForeignBehindSchema} for composition roots.
 *
 * @throws ForeignSchemaMigrationRefusedError when the open would migrate a foreign corpus
 */
export function assertNoForeignSchemaMigration(dbPath: string, cwd: string = process.cwd()): void {
  const behind = findForeignBehindSchema(dbPath, cwd);
  if (behind !== null) throw new ForeignSchemaMigrationRefusedError(behind);
}
