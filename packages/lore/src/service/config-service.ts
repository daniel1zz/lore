/**
 * ConfigService — the FIRST runtime write path for `.lore/config.yaml`
 * (SPEC-062 D1). Before this service, `saveConfig` had exactly three callers,
 * all CLI bootstrap (`commands/init.ts`, `commands/sync.ts`,
 * `flows/init-corpus.ts`) — every other setting (including
 * `workflow.gates.*.enabled`, which decides whether the governance gates fire
 * at all) could only be changed by hand-editing YAML.
 *
 * Public surface:
 *   read()               → the redacted config + a per-key effect classification
 *   update(patch, opts)  → validate-then-write, honest effect reporting, one
 *                          audit row per accepted write
 *
 * @invariant Node IO happens ONLY via `@lore/core/node`'s `loadConfig`/
 *   `saveConfig` — this file never imports `node:fs`. Config is FILE state, not
 *   `StoreInterface` state (this service takes a corpus directory, not a
 *   store), but the D6 audit trail still needs the shared `audit` table, so an
 *   `appendAuditEntry` PORT is injected (bound to `store.appendAuditEntry` in
 *   `app.ts`) — the narrowest possible dependency, mirroring `UatService`'s
 *   narrow-port shape rather than taking a whole `StoreInterface`.
 * @invariant `update` is validate-THEN-write, never partial: (1) the
 *   {@link findDeniedConfigKeys} check runs against the RAW patch with ZERO
 *   disk access — a denied patch never even reads the current file, let alone
 *   writes it; (2) the merged candidate is validated against the FULL
 *   `LoreConfigSchema` before `saveConfig` is ever called — a patch that
 *   passes the deny check but produces a schema-invalid merged config is
 *   rejected with the on-disk file byte-untouched. Both rejection paths write
 *   ZERO audit rows (D6 — "a rejected PATCH produces 0 audit rows").
 * @invariant `update`'s `restart_required` in its result is computed from the
 *   PATCH's own touched keys (via `flattenConfigLeafPaths`), not a value-level
 *   diff against the previous config — a patch that RE-STATES a value
 *   unchanged still counts as "touched" (SPEC-062 D5's honesty requirement is
 *   about which keys the caller declared changed, not about whether the
 *   resulting bytes differ).
 * @invariant Deep-merge of `patch` into the current config treats a PLAIN
 *   OBJECT value as mergeable (recurse key-by-key) and everything else
 *   (arrays, primitives, `null`) as a wholesale replacement — mirrors
 *   {@link flattenConfigLeafPaths}'s "arrays are leaves" convention exactly,
 *   so the set of keys `flattenConfigLeafPaths(patch)` reports as "touched" is
 *   always consistent with what the merge actually replaced.
 *
 * Side-effect class: IO (config file read/write via `@lore/core/node`; one
 *   audit-table write via the injected port)
 *
 * Source: SPEC-062 §Scope D1, D2, D5, D6
 */

import { createHash } from "node:crypto";
import yaml from "yaml";
import {
  LoreConfigSchema,
  findDeniedConfigKeys,
  redactConfigValues,
  classifyConfigEffect,
  flattenConfigLeafPaths,
  ok,
  err,
  type LoreConfig,
  type ConfigEffect,
  type AuditEntry,
  type Result,
  type LoreError,
} from "@lore/core";
import { loadConfig, saveConfig } from "@lore/core/node";

/**
 * Audit rows written by {@link ConfigService.update} have no owning doc (config
 * is not a `DocRecord`) — `AuditEntry.session_id` is a required field with no
 * natural doc/session identity to anchor to here, so every config-update audit
 * row shares this fixed sentinel rather than inventing a per-call value that
 * would carry no real grouping meaning.
 */
const CONFIG_AUDIT_SESSION_ID = "config";

/** Audit action string stamped on every accepted `update()` (SPEC-062 D6). */
const CONFIG_UPDATE_AUDIT_ACTION = "config_update";

/**
 * Narrow injected port for writing the D6 audit row — bound to
 * `store.appendAuditEntry` in `app.ts`. Kept narrow (a single function, not a
 * whole `StoreInterface`) because `ConfigService` otherwise has no reason to
 * touch the store at all (SPEC-062 §Design: "receives the corpus directory,
 * not a store — config is file state").
 */
export type AppendConfigAuditEntry = (entry: AuditEntry) => Promise<Result<void, LoreError>>;

/** Result shape of {@link ConfigService.read}. */
export interface ConfigReadResult {
  /** The parsed config with every `CONFIG_REDACT_KEYS`-matching value replaced. */
  config: LoreConfig;
  /** Per-leaf-key effect classification (`"live" | "restart_required"`) for every key present. */
  effects: Record<string, ConfigEffect>;
}

/** Options for {@link ConfigService.update}. */
export interface ConfigUpdateOpts {
  /** Actor recorded on the D6 audit row — the writer's identity, not a doc lifecycle actor. */
  actor: string;
}

/** Result shape of a successful {@link ConfigService.update}. */
export interface ConfigUpdateResult {
  /** The new config, redacted the same way {@link ConfigService.read} redacts it. */
  config: LoreConfig;
  /** Per-leaf-key effect classification for the NEW config. */
  effects: Record<string, ConfigEffect>;
  /** Dotted leaf-key paths the accepted patch touched (SPEC-062 D5). */
  updated: string[];
  /**
   * Subset of `updated` whose {@link classifyConfigEffect} is
   * `"restart_required"` — NEVER a blanket "success", per D5: "a save is never
   * reported as undifferentiated success."
   */
  restart_required: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges `patch` onto `base`: a plain-object value in `patch` recurses
 * into the corresponding `base` key (creating it if absent); every other
 * value (array, primitive, `null`) replaces the `base` key wholesale. Mirrors
 * `flattenConfigLeafPaths`'s "arrays are leaves" convention (module @invariant
 * above) so the merge and the "what changed" accounting never disagree.
 *
 * @param base - Current config, as a plain object (already Zod-validated by
 *   the caller's prior `loadConfig`)
 * @param patch - Untrusted candidate patch (already passed the deny-key check)
 * @returns A NEW plain object — never mutates `base` or `patch`
 */
function deepMergeConfigPatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = base[key];
    result[key] =
      isPlainObject(patchValue) && isPlainObject(baseValue)
        ? deepMergeConfigPatch(baseValue, patchValue)
        : patchValue;
  }
  return result;
}

/** Hex sha256 of `config`'s canonical YAML serialization — the D6 before/after audit hash. */
function hashConfig(config: LoreConfig): string {
  return createHash("sha256").update(yaml.stringify(config), "utf8").digest("hex");
}

/** Builds the per-key effect map `read()`/`update()` both return. */
function buildEffectsMap(config: LoreConfig): Record<string, ConfigEffect> {
  const effects: Record<string, ConfigEffect> = {};
  for (const key of flattenConfigLeafPaths(config)) {
    effects[key] = classifyConfigEffect(key);
  }
  return effects;
}

/**
 * The FIRST runtime write path for `.lore/config.yaml` — `read()`/`update()`.
 * See this module's own header for the full design rationale and invariants.
 */
export class ConfigService {
  /**
   * @param corpusDir - Corpus root directory (the same directory `loadConfig`/
   *   `saveConfig` resolve `.lore/config.yaml` under) — NOT a `StoreInterface`;
   *   config is file state (SPEC-062 §Design).
   * @param appendAuditEntry - Narrow port for the D6 audit write, bound to
   *   `store.appendAuditEntry` in `app.ts`.
   */
  constructor(
    private readonly corpusDir: string,
    private readonly appendAuditEntry: AppendConfigAuditEntry,
  ) {}

  /**
   * Reads and redacts the current `.lore/config.yaml`.
   *
   * @returns The redacted config plus a per-key effect map. Propagates
   *   `loadConfig`'s error verbatim on a missing/malformed file.
   */
  async read(): Promise<Result<ConfigReadResult, LoreError>> {
    const loaded = loadConfig(this.corpusDir);
    if (!loaded.ok) return loaded;

    const redacted = redactConfigValues(loaded.value) as LoreConfig;
    return ok({ config: redacted, effects: buildEffectsMap(redacted) });
  }

  /**
   * Validates then writes a patch onto the current config.
   *
   * Order of operations (see class @invariant above for the full rationale):
   *   1. Reject a non-object patch outright.
   *   2. Reject any patch touching a {@link CONFIG_DENY_KEYS} key — ZERO disk
   *      access before this point.
   *   3. Load the current config, deep-merge the patch onto it, validate the
   *      merged candidate against `LoreConfigSchema` — reject on schema
   *      violation with the on-disk file still untouched.
   *   4. `saveConfig` the validated merged config.
   *   5. Write exactly one audit row (D6).
   *
   * @param patch - Untrusted candidate patch (e.g. an HTTP request body)
   * @param opts - `{ actor }` — the audit-row actor
   * @returns `{config, effects, updated, restart_required}` on success. A
   *   rejection at any of steps 1-3 returns before any write and produces
   *   zero audit rows; a `saveConfig`/`appendAuditEntry` failure at steps 4-5
   *   propagates that error verbatim.
   */
  async update(
    patch: unknown,
    opts: ConfigUpdateOpts,
  ): Promise<Result<ConfigUpdateResult, LoreError>> {
    if (!isPlainObject(patch)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "patch",
        message: "Config patch must be a plain object",
        value: patch,
      });
    }

    // D2 — deny-key check FIRST, before any disk read/write whatsoever. This
    // is what guarantees AC-062-1's "config.yaml sha256 identical before and
    // after" — the file is never even opened on a denied patch.
    const denied = findDeniedConfigKeys(patch);
    if (denied.length > 0) {
      const [first, ...rest] = denied;
      const also = rest.length > 0 ? ` (also denied: ${rest.join(", ")})` : "";
      return err({
        code: "VALIDATION_ERROR",
        field: first as string,
        message:
          `Cannot modify "${first}" over this surface — edit it by hand in .lore/config.yaml${also}`,
        value: patch,
      });
    }

    const currentResult = loadConfig(this.corpusDir);
    if (!currentResult.ok) return currentResult;
    const current = currentResult.value;

    const merged = deepMergeConfigPatch(
      current as unknown as Record<string, unknown>,
      patch,
    );
    const parsed = LoreConfigSchema.safeParse(merged);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? issue.path.join(".") || "root" : "root",
        message: issue !== undefined ? issue.message : "Invalid config patch",
        value: patch,
      });
    }

    const updated = flattenConfigLeafPaths(patch);
    const restartRequired = updated.filter((key) => classifyConfigEffect(key) === "restart_required");

    const beforeHash = hashConfig(current);
    const afterHash = hashConfig(parsed.data);

    const saveResult = saveConfig(this.corpusDir, parsed.data);
    if (!saveResult.ok) return saveResult;

    const auditResult = await this.appendAuditEntry({
      timestamp: new Date().toISOString(),
      actor: opts.actor,
      session_id: CONFIG_AUDIT_SESSION_ID,
      action: CONFIG_UPDATE_AUDIT_ACTION,
      details: { changed_keys: updated, before_sha256: beforeHash, after_sha256: afterHash },
    });
    if (!auditResult.ok) return auditResult;

    const redacted = redactConfigValues(parsed.data) as LoreConfig;
    return ok({
      config: redacted,
      effects: buildEffectsMap(redacted),
      updated,
      restart_required: restartRequired,
    });
  }
}
