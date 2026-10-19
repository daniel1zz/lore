/**
 * Behind-schema guard: refuses to open a corpus that is older than this binary's schema, naming `lore migrate schema`.
 *
 * Purpose: a corpus upgrade runs ONLY through the explicit `lore migrate schema` command. This guard runs BEFORE
 * `new SQLiteStore` on every adapter/composition path that opens a discovered corpus (CLI loader, MCP server and
 * `lore serve` through it, `createApp`, the gate's audit open), so a read-only command, a hook or a linked worktree
 * can never rewrite a shared corpus as a side effect. The `SQLiteStore` constructor refuses too (the last line of
 * defence); this guard exists so the refusal is a validation error (exit 4) naming both versions and the command,
 * not a generic storage failure.
 *
 * (The file and symbol names say "foreign" for historical reasons: the guard began as the linked-worktree-only check
 * of spec-close-the-eight-verified-critical-defects-no-judge-listing §Design F5, AC-CRIT-7. It now covers every
 * corpus behind the binary, which includes the main checkout's corpus opened from a linked worktree. Renaming would
 * touch the loader and the gate, which other work owns.)
 *
 * Public surface: {@link findForeignBehindSchema}, {@link assertNoForeignSchemaMigration},
 * {@link ForeignSchemaMigrationRefusedError}.
 *
 * Invariants:
 *   - Never writes: the version read is a readonly handle (`probeSchemaVersion`).
 *   - A corpus that is behind `LATEST_SCHEMA_VERSION` is refused, from any working copy. A new/empty file
 *     (`user_version` 0), a corpus at or ahead of the binary, a missing file and a probe failure all pass through (a
 *     probe failure is surfaced loudly by the constructor's own open, so nothing is hidden).
 *
 * Side-effect class: IO (opens the db readonly).
 */

import { existsSync } from "node:fs";
import { probeSchemaVersion } from "./schema-probe.js";
import { isSchemaBehind, schemaBehindMessage } from "./schema-behind.js";
import { LATEST_SCHEMA_VERSION } from "./schema-version.js";

/** Facts about a refused open: the corpus is behind the binary's schema. */
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

/**
 * Decides whether opening `dbPath` would have to upgrade an older corpus.
 *
 * @param dbPath - the discovered `.lore/lore.db` about to be opened
 * @param _cwd - the directory the invocation runs in; unused now that every behind corpus is refused wherever it is
 *   opened from (kept so the loader and gate call sites keep their shape)
 * @returns the refusal facts, or `null` when opening is safe
 * @example
 *   const behind = findForeignBehindSchema(findLoreDbPath(), inv.cwd);
 *   if (behind !== null) refuse(behind.message);
 */
export function findForeignBehindSchema(dbPath: string, _cwd: string): ForeignBehindSchema | null {
  if (!existsSync(dbPath)) return null;
  const probe = probeSchemaVersion(dbPath);
  if (!probe.ok) return null;
  const userVersion = probe.value.user_version;
  if (!isSchemaBehind(userVersion, LATEST_SCHEMA_VERSION)) return null;
  return {
    dbPath,
    userVersion,
    latestVersion: LATEST_SCHEMA_VERSION,
    message: schemaBehindMessage(dbPath, userVersion, LATEST_SCHEMA_VERSION),
  };
}

/**
 * Throwing form of {@link findForeignBehindSchema} for composition roots.
 *
 * @throws ForeignSchemaMigrationRefusedError when the open would upgrade an older corpus
 */
export function assertNoForeignSchemaMigration(dbPath: string, cwd: string): void {
  const behind = findForeignBehindSchema(dbPath, cwd);
  if (behind !== null) throw new ForeignSchemaMigrationRefusedError(behind);
}
