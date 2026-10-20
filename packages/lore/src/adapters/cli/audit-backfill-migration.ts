/**
 * `lore migrate audit-backfill`: the one-time upgrade that retires the audit completeness cut-off
 * (task-audit-verification-checks-every-version-pre-writer-history).
 *
 * Public surface:
 *   runAuditBackfillMigration(input) — reads the retired `audit.verify_since` from `.lore/config.yaml`, records every
 *     pre-writer version without an audit entry as a reconstructed, hash-chained entry, then removes the setting.
 *
 * Why here and not through `loadLoreApp`: every other command refuses the config this action repairs, so it opens the
 * corpus store itself (preview read-only, apply read-write) and edits the config text with the pure
 * `removeRetiredVerifySinceSetting`; no loader ever writes.
 *
 * @invariant ORDER: the entries are appended BEFORE the config line is removed. An interrupted run leaves the setting
 *   in place, so a re-run keeps the same boundary and reconstructs only what is still missing.
 * @invariant The boundary is the cut-off the corpus itself declared (`audit.verify_since`), else
 *   `AUDIT_WRITERS_LIVE_FROM`. It only decides which history may be reconstructed; verification never reads a date.
 *
 * Side-effect class: IO (reads/writes the config file; opens the corpus store).
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AUDIT_WRITERS_LIVE_FROM,
  err,
  ok,
  removeRetiredVerifySinceSetting,
  type Invocation,
  type LoreError,
  type Result,
} from "@lore/core";
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
  /** The cut-off the setting carried, `undefined` when it was absent. */
  readonly declaredCutoff: string | undefined;
  /** Whether the config file was rewritten (`apply` and `found`). */
  readonly configWritten: boolean;
  /** The backfill's own report (its `boundary` is the cut-off used). */
  readonly backfill: AuditBackfillReport;
}

/** The migration's inputs: the invocation, the discovered corpus database, and whether to write. */
export interface AuditBackfillMigrationInput {
  readonly inv: Invocation;
  readonly dbPath: string;
  readonly apply: boolean;
}

function invalidCutoff(value: unknown): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "audit.verify_since",
    message: `audit.verify_since is not an ISO 8601 timestamp (${JSON.stringify(value)}); fix or delete it by hand in .lore/config.yaml (nothing was rewritten).`,
    value,
  };
}

/**
 * @returns `ok(report)`; `err(VALIDATION_ERROR)` for a malformed config, a flow-style setting, an unreadable cut-off, or
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
    const declared = removal.value?.value;
    if (removal.value !== undefined && (typeof declared !== "string" || Number.isNaN(Date.parse(declared)))) {
      return err(invalidCutoff(declared));
    }

    const behind = findForeignBehindSchema(input.dbPath, input.inv.cwd);
    if (behind !== null) return err({ code: "VALIDATION_ERROR", field: "schema_version", message: behind.message });
    store = input.apply ? new SQLiteStore(input.dbPath) : new SQLiteStore(input.dbPath, { readonly: true });

    const nowIso = new Date().toISOString();
    const backfill = await new AuditBackfillService(store).run({
      boundary: typeof declared === "string" ? declared : AUDIT_WRITERS_LIVE_FROM,
      apply: input.apply,
      actor: resolveActor(input.inv.io, undefined, input.inv.env, input.inv.cwd, input.inv.user),
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
      declaredCutoff: typeof declared === "string" ? declared : undefined,
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
