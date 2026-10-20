/**
 * `lore migrate schema [--dry-run] [--json]`: the ONE command that upgrades a corpus to this binary's schema.
 *
 * Purpose: every other command refuses an older corpus (exit 4, naming both versions and this command), so an upgrade
 * is never a side effect of someone's first command after a release. This command makes the upgrade deliberate,
 * attributed and recorded.
 * Public surface: {@link runMigrateSchema}.
 * Invariants:
 *   - Never goes through `loadLoreApp` (which refuses the very corpus this command repairs); it reads the version
 *     with a readonly probe and opens the store with `migrate: true`.
 *   - The upgrade itself is the store's existing per-migration transactions: each is atomic and a failure leaves the
 *     corpus at the last good schema and is reported with the failing step and the corpus path.
 *   - Exactly ONE `migrate_schema` audit row per upgrade (actor, from, to, duration, working copy, corpus path); a run
 *     with nothing pending, and `--dry-run`, write nothing.
 *   - An upgrade (not `--dry-run`) is refused when this checkout reaches the corpus through another one (a linked
 *     worktree on the main checkout's corpus): run it from the checkout that owns the corpus.
 *   - A corpus at user_version 0 is a new file (not an upgrade): nothing is pending and nothing is written.
 *   - An upgrade ends by expiring every claim lease that names no run (written before claims compared runs, BR-1352),
 *     one version row and one audit row each, through the one write route; the report names the count.
 * Side-effect class: IO (reads the corpus version; upgrades the corpus and appends one audit row unless nothing is
 * pending or `--dry-run`).
 */

import { existsSync } from "node:fs";
import type { Invocation } from "@lore/core";
import { printLine } from "./output.js";
import { findLoreDbPath, formatErrorFor, resolveActor } from "./utils.js";
import { resolveCorpus } from "./corpus-resolution.js";
import { bareDocWriter } from "../../service/corpus-service.js";
import { expireRunlessClaims } from "../../service/legacy-claim-expiry.js";
import { SQLiteStore } from "../../store/sqlite-store.js";
import { probeSchemaVersion } from "../../store/schema-probe.js";
import { isSchemaBehind, pendingMigrationVersions } from "../../store/schema-behind.js";
import { LATEST_SCHEMA_VERSION } from "../../store/schema-version.js";

/** The `session_id` of the audit row (a corpus-level action belongs to no doc session). */
const MIGRATE_SCHEMA_AUDIT_SESSION_ID = "migrate-schema";

/** What `lore migrate schema` was asked to do. */
export interface MigrateSchemaOptions {
  readonly dryRun: boolean;
  readonly json: boolean;
}

function migrationName(version: number): string {
  return `migration-${String(version).padStart(3, "0")}`;
}

function report(inv: Invocation, options: MigrateSchemaOptions, data: Record<string, unknown>, text: string[]): void {
  if (options.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data }, null, 2));
  else for (const line of text) printLine(inv.io.stdout, line);
}

function fail(inv: Invocation, options: MigrateSchemaOptions, message: string): number {
  if (options.json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error: { message } }, null, 2));
  else printLine(inv.io.stderr, `Error: ${message}`);
  return 1;
}

/**
 * Upgrades the discovered corpus to {@link LATEST_SCHEMA_VERSION}, or reports what is pending.
 *
 * @param inv - the run's Invocation (cwd, env, io, user)
 * @param options - `--dry-run` and `--json`
 * @returns the exit code: 0 on success or nothing pending, 1 when the corpus is missing/unreadable or a migration failed
 */
export async function runMigrateSchema(inv: Invocation, options: MigrateSchemaOptions): Promise<number> {
  const dbPath = findLoreDbPath(inv.io, inv);
  if (!existsSync(dbPath)) return fail(inv, options, `no corpus at '${dbPath}'; run \`lore init\` first`);
  const probe = probeSchemaVersion(dbPath);
  if (!probe.ok) return fail(inv, options, formatErrorFor(inv, probe.error));
  const from = probe.value.user_version;

  if (!isSchemaBehind(from, LATEST_SCHEMA_VERSION)) {
    report(inv, options, { upgraded: false, pending: [], from, to: LATEST_SCHEMA_VERSION, corpus: dbPath }, [
      `Schema is at version ${from} (this binary requires ${LATEST_SCHEMA_VERSION}): nothing pending.`,
    ]);
    return 0;
  }

  const pending = pendingMigrationVersions(from, LATEST_SCHEMA_VERSION).map(migrationName);
  if (options.dryRun) {
    report(inv, options, { upgraded: false, dry_run: true, pending, from, to: LATEST_SCHEMA_VERSION, corpus: dbPath }, [
      `Schema migration (dry run): ${from} -> ${LATEST_SCHEMA_VERSION}, ${pending.length} pending:`,
      ...pending.map((name) => `  ${name}`),
      "Nothing was written. Run `lore migrate schema` to apply.",
    ]);
    return 0;
  }

  // reason: a linked worktree that reaches the MAIN checkout's corpus must not rewrite it (its binary may differ from
  // the one main runs); the upgrade is run from the checkout that owns the corpus. The integrate floor's snapshot and
  // any corpus a checkout owns have "own" provenance and pass. Same test `migrate memory-limits --apply` applies.
  if (resolveCorpus(inv.io, inv.cwd, inv.env)?.provenance !== "own") {
    return fail(
      inv,
      options,
      `schema mismatch: the corpus at '${dbPath}' belongs to another checkout (this one reaches it through git); run \`lore migrate schema\` from the checkout that owns it`,
    );
  }
  const actor = resolveActor(inv);
  const startedAt = Date.now();
  let store: SQLiteStore;
  try {
    store = new SQLiteStore(dbPath, { migrate: true });
  } catch (error) {
    // reason: a failed migration rolled back and left the corpus at its last good schema; its message names the step
    // and the corpus path. Fail loud with exit 1 rather than let citty dump a stack.
    return fail(inv, options, error instanceof Error ? error.message : String(error));
  }
  try {
    const durationMs = Date.now() - startedAt;
    // The schema is current once the store opened, so every write below rides the one write route (bare writer: this
    // command never builds the app, which refuses the very corpus it repairs).
    const writer = bareDocWriter(store);
    // reason: BR-1352 — leases written before claims compared runs name no run; they are expired once, here, so no stored
    // lease belongs to nobody. A failure fails the command loud; documents expired before it stay expired, a re-run continues.
    const expiry = await expireRunlessClaims(store, writer, actor, new Date().toISOString());
    if (!expiry.ok) {
      return fail(inv, options, `the corpus is now at schema ${LATEST_SCHEMA_VERSION} but expiring the claims that name no run failed: ${formatErrorFor(inv, expiry.error)}`);
    }
    const audited = await writer.appendAudit({
      by: actor,
      sessionId: MIGRATE_SCHEMA_AUDIT_SESSION_ID,
      action: "migrate_schema",
      details: { from, to: LATEST_SCHEMA_VERSION, duration_ms: durationMs, working_copy: inv.cwd, corpus: dbPath, expired_claims: expiry.value.length },
    });
    if (!audited.ok) {
      return fail(inv, options, `the corpus is now at schema ${LATEST_SCHEMA_VERSION} but the audit row could not be written: ${formatErrorFor(inv, audited.error)}`);
    }
    report(inv, options, { upgraded: true, pending, from, to: LATEST_SCHEMA_VERSION, duration_ms: durationMs, actor, corpus: dbPath, expired_claims: expiry.value }, [
      `Schema migrated: ${from} -> ${LATEST_SCHEMA_VERSION} in ${durationMs} ms (${pending.join(", ")}) by ${actor}.`,
      ...expiry.value.map((claim) => `Expired claim on ${claim.slug} held by ${claim.holder}: it named no run.`),
    ]);
    return 0;
  } finally {
    store.close();
  }
}
