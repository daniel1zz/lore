/**
 * `lore migrate audit-backfill`: the one-time upgrade that retires the audit completeness cut-off
 * (task-audit-verification-checks-every-version-pre-writer-history).
 *
 * Public surface:
 *   runAuditBackfillMigration(input) — records every pre-writer version without an audit entry as a reconstructed,
 *     hash-chained entry, then removes the retired `audit.verify_since` line from `.lore/config.yaml` (its value is
 *     never read).
 *
 * Why here and not through `loadLoreApp`: every other command refuses the config this action repairs, so it opens the
 * corpus store itself (preview read-only, apply read-write) and edits the config text with the pure
 * `removeRetiredVerifySinceSetting`; no loader ever writes.
 *
 * @invariant ORDER: the entries are appended BEFORE the config line is removed. An interrupted run leaves the setting
 *   in place, and a re-run reconstructs only what is still missing.
 * @invariant The boundary comes from the data (the created_at of the earliest audit entry, derived by
 *   `AuditBackfillService`): no config key and no built-in date is read, so the result never depends on what the
 *   config said or whether it still says it. Verification itself never reads a date.
 *
 * Side-effect class: IO (reads/writes the config file; opens the corpus store).
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  err,
  ok,
  removeRetiredVerifySinceSetting,
  type Invocation,
  type LoreError,
  type Result,
} from "@lore/core";
import { UnknownPartyError } from "@lore/core/node";
import { AuditBackfillService, type AuditBackfillReport } from "../../service/audit-backfill-service.js";
import { findForeignBehindSchema } from "../../store/foreign-schema-guard.js";
import { SQLiteStore } from "../../store/sqlite-store.js";
import { resolveActor } from "./utils.js";

/** What the migration found and did. */
export interface AuditBackfillMigration {
  /** Absolute path of the config file examined. */
  readonly file: string;
  /** Whether the config carried the retired setting. */
  readonly found: boolean;
  /** Whether the config file was rewritten (`apply` and `found`). */
  readonly configWritten: boolean;
  /** The backfill's own report (its `boundary` and `boundarySource` say where the line was drawn). */
  readonly backfill: AuditBackfillReport;
}

/** The migration's inputs: the invocation, the discovered corpus database, and whether to write. */
export interface AuditBackfillMigrationInput {
  readonly inv: Invocation;
  readonly dbPath: string;
  readonly apply: boolean;
}

/**
 * @returns `ok(report)`; `err(VALIDATION_ERROR)` for a malformed config, a flow-style setting, or
 *   a worktree reaching a behind-schema foreign corpus; `err(STORE_ERROR)` when the corpus or the config cannot be
 *   read/written. Never throws.
 */
export async function runAuditBackfillMigration(input: AuditBackfillMigrationInput): Promise<Result<AuditBackfillMigration, LoreError>> {
  const file = join(dirname(input.dbPath), "config.yaml");
  let store: SQLiteStore | undefined;
  try {
    const raw = existsSync(file) ? readFileSync(file, "utf8") : "";
    const removal = removeRetiredVerifySinceSetting(raw);
    if (!removal.ok) return removal;

    // reason: the writer is the invocation's known party. With none, the run is refused HERE (VALIDATION_ERROR, exit 4,
    // naming `lore session start --human <name>` and `lore setup`) before the store is opened, so nothing is written;
    // it must not surface as the generic STORE_ERROR the catch below would make of the thrown refusal.
    let actor: string;
    try {
      actor = resolveActor(input.inv);
    } catch (refusal) {
      if (refusal instanceof UnknownPartyError) return err(refusal.loreError);
      throw refusal;
    }

    const behind = findForeignBehindSchema(input.dbPath, input.inv.cwd);
    if (behind !== null) return err({ code: "VALIDATION_ERROR", field: "schema_version", message: behind.message });
    store = input.apply ? new SQLiteStore(input.dbPath) : new SQLiteStore(input.dbPath, { readonly: true });

    const nowIso = new Date().toISOString();
    const backfill = await new AuditBackfillService(store).run({
      apply: input.apply,
      actor,
      run: `audit-backfill-${nowIso}`,
      nowIso,
    });
    if (!backfill.ok) return backfill;

    let configWritten = false;
    if (input.apply && removal.value !== undefined) {
      const tempPath = `${file}.migrating-${process.pid}`;
      writeFileSync(tempPath, removal.value.text, "utf8");
      renameSync(tempPath, file);
      configWritten = true;
    }
    return ok({
      file,
      found: removal.value !== undefined,
      configWritten,
      backfill: backfill.value,
    });
  } catch (e) {
    return err({
      code: "STORE_ERROR",
      message: e instanceof Error ? e.message : "Failed to run the audit backfill",
      ...(e instanceof Error ? { cause: e } : {}),
    } satisfies LoreError);
  } finally {
    store?.close();
  }
}
