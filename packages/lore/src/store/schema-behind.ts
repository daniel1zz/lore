/**
 * Schema-behind vocabulary: the one definition of "this corpus needs `lore migrate schema`".
 *
 * Purpose: a corpus schema upgrade runs ONLY through the explicit `lore migrate schema` command. Every other opener
 * (CLI, MCP server, `lore serve`, hooks) refuses an older corpus instead of rewriting it as a side effect, and all of
 * them name the same facts and the same command, built here.
 * Public surface: {@link MIGRATE_SCHEMA_COMMAND}, {@link isSchemaBehind}, {@link schemaBehindMessage},
 * {@link SchemaBehindError}, {@link pendingMigrationVersions}.
 * Invariants:
 *   - A corpus at `user_version` 0 is NEW (an empty file the opening binary builds at the latest schema), never behind.
 *   - A corpus ahead of the binary is not "behind": nothing here migrates or refuses it.
 *   - No `bun:sqlite` import (safe for any module graph).
 * Side-effect class: pure.
 */

/** The only command that upgrades a corpus schema; named in every refusal. */
export const MIGRATE_SCHEMA_COMMAND = "lore migrate schema";

/**
 * @param currentVersion - the corpus's `PRAGMA user_version`
 * @param requiredVersion - the schema this binary needs
 * @returns true when an existing corpus (version above 0) is older than `requiredVersion`
 */
export function isSchemaBehind(currentVersion: number, requiredVersion: number): boolean {
  return currentVersion > 0 && currentVersion < requiredVersion;
}

/** The migration numbers a corpus at `currentVersion` still needs to reach `requiredVersion`, ascending. */
export function pendingMigrationVersions(currentVersion: number, requiredVersion: number): number[] {
  const pending: number[] = [];
  for (let version = currentVersion + 1; version <= requiredVersion; version += 1) pending.push(version);
  return pending;
}

/** The user-facing refusal sentence: both versions and the command that fixes it. */
export function schemaBehindMessage(corpusPath: string, currentVersion: number, requiredVersion: number): string {
  return (
    `schema mismatch: the corpus at '${corpusPath}' is at schema version ${currentVersion}, this binary requires ${requiredVersion}; ` +
    `no other command upgrades a corpus: run \`${MIGRATE_SCHEMA_COMMAND}\` (add --dry-run to list what is pending), then retry`
  );
}

/** Thrown by a store opened WITHOUT `migrate` on a corpus older than its schema; the corpus is untouched. */
export class SchemaBehindError extends Error {
  readonly context: { readonly corpusPath: string; readonly currentVersion: number; readonly requiredVersion: number };

  constructor(corpusPath: string, currentVersion: number, requiredVersion: number) {
    super(schemaBehindMessage(corpusPath, currentVersion, requiredVersion));
    this.name = "SchemaBehindError";
    this.context = { corpusPath, currentVersion, requiredVersion };
  }
}
