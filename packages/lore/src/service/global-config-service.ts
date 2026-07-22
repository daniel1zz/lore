/**
 * GlobalConfigService — the machine-scope (`~/.config/lore/config.yaml` / XDG)
 * sibling of `ConfigService` (SPEC-062). `saveGlobalConfig` (`@lore/core/node`)
 * gave the global config a WRITER for the first time (SPEC-064 §Scope); this
 * service is the business-logic layer on top of it — `ConfigService.update`'s
 * shape mirrored onto `GlobalLoreConfigSchema` (D1: the writable surface is
 * exactly `defaults.format`/`defaults.color` — `defaults.editor` is on the
 * SAME `CONFIG_DENY_KEYS` table `ConfigService` enforces, per SPEC-062
 * AC-062-13/SPEC-064 D1 "one deny table, both scopes").
 *
 * Public surface:
 *   read()               → the current global config + a per-key effect map
 *   update(patch, opts)  → validate-then-write, honest effect reporting, one
 *                          audit row per accepted write
 *
 * @invariant Node IO happens ONLY via `@lore/core/node`'s `loadGlobalConfig`/
 *   `saveGlobalConfig` — this file never imports `node:fs`. The audit trail
 *   still needs the shared `audit` table, so an `appendAuditEntry` PORT is
 *   injected (the SAME `AppendConfigAuditEntry` type `ConfigService` exports —
 *   one shape, two writers, never a hand-duplicated twin).
 * @invariant `update` is validate-THEN-write, never partial — same three-gate
 *   shape as `ConfigService.update`: (1) {@link findDeniedConfigKeys} runs
 *   against the RAW patch with ZERO disk access; (2) an optional
 *   `opts.expectedHash` CAS check (see below) runs against a FRESH read,
 *   before any merge; (3) the merged candidate is validated against
 *   `GlobalLoreConfigSchema` before `saveGlobalConfig` is ever called. All
 *   three rejection paths write ZERO bytes and ZERO audit rows.
 * @invariant `update`'s `restart_required` is computed from the PATCH's own
 *   touched keys (via `flattenConfigLeafPaths`), matching `ConfigService`'s
 *   honesty convention — though for the machine scope this is currently
 *   always `[]`, since none of `RESTART_REQUIRED_KEY_PREFIXES`
 *   (`config-editability.ts`) matches a `defaults.*` key. Computed rather
 *   than hardcoded so a future prefix addition is honored automatically.
 * @invariant `opts.expectedHash` reuses `ConfigService`'s exported
 *   `computeConfigHash` (its `stableStringify`+sha256 algorithm is generic
 *   over the redacted config's shape) rather than hand-rolling a second sha256
 *   CAS hash — see the cast note at its one call site below for why a type
 *   assertion is needed despite that genericity.
 *
 * Side-effect class: IO (global config file read/write via `@lore/core/node`;
 *   one audit-table write via the injected port)
 *
 * Source: SPEC-064 §Design D1, D7; SPEC-062 §Design (the shape being mirrored)
 */

import {
  GlobalLoreConfigSchema,
  findDeniedConfigKeys,
  redactConfigValues,
  classifyConfigEffect,
  flattenConfigLeafPaths,
  ok,
  err,
  type GlobalLoreConfig,
  type LoreConfig,
  type ConfigEffect,
  type Result,
  type LoreError,
} from "@lore/core";
import { loadGlobalConfig, saveGlobalConfig } from "@lore/core/node";
import { computeConfigHash, type AppendConfigAuditEntry } from "./config-service.js";

/** Audit row `session_id` for every {@link GlobalConfigService.update} write — mirrors `ConfigService`'s `"config"` sentinel, distinct value for the machine scope. */
const GLOBAL_CONFIG_AUDIT_SESSION_ID = "global-config";

/** Audit action string stamped on every accepted {@link GlobalConfigService.update} (mirrors `ConfigService`'s `CONFIG_UPDATE_AUDIT_ACTION`). */
const GLOBAL_CONFIG_UPDATE_AUDIT_ACTION = "global_config_update";

/** Result shape of {@link GlobalConfigService.read}. */
export interface GlobalConfigReadResult {
  /** The parsed global config, redacted the same way (currently a no-op — machine scope declares no `CONFIG_REDACT_KEYS` entries today, but the call site stays SSOT-consistent with `ConfigService.read` in case that changes). */
  config: GlobalLoreConfig;
  /** Per-leaf-key effect classification (`"live" | "restart_required"`) for every key present. */
  effects: Record<string, ConfigEffect>;
}

/** Options for {@link GlobalConfigService.update}. */
export interface GlobalConfigUpdateOpts {
  /** Actor recorded on the audit row — the writer's identity, not a doc lifecycle actor. */
  actor: string;
  /**
   * Optional CAS guard: the sha256 hash (via {@link computeConfigHash} over the
   * redacted global config) the caller last observed. When supplied, `update`
   * re-derives the CURRENT hash itself (never trusting the caller's own
   * precheck) and rejects with `VALIDATION_ERROR{field: "expectedHash"}` on a
   * mismatch, BEFORE any merge/validation/write. Omitted (the default) → no
   * staleness check at all — mirrors `ConfigService.update`'s
   * `opts.expectedHash` precedent exactly.
   */
  expectedHash?: string;
}

/** Result shape of a successful {@link GlobalConfigService.update}. */
export interface GlobalConfigUpdateResult {
  /** The new global config, redacted the same way {@link GlobalConfigService.read} redacts it. */
  config: GlobalLoreConfig;
  /** Per-leaf-key effect classification for the NEW config. */
  effects: Record<string, ConfigEffect>;
  /** Dotted leaf-key paths the accepted patch touched. */
  updated: string[];
  /** Subset of `updated` whose {@link classifyConfigEffect} is `"restart_required"` — currently always `[]` for this scope, see class @invariant. */
  restart_required: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges `patch` onto `base` — byte-for-byte the same algorithm
 * `ConfigService`'s private `deepMergeConfigPatch` uses (that function is not
 * exported, so this is a deliberate, documented mirror rather than an import —
 * see this module's header for why duplicating a ~10-line tree-merge is
 * acceptable while duplicating the sha256 CAS hash is not: the merge has no
 * security/consistency property that a divergent second copy could silently
 * break, unlike a hash algorithm two callers must agree on bit-for-bit).
 *
 * @param base - Current config, as a plain object (already Zod-validated by
 *   the caller's prior `loadGlobalConfig`)
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

/** Builds the per-key effect map `read()`/`update()` both return. */
function buildEffectsMap(config: GlobalLoreConfig): Record<string, ConfigEffect> {
  const effects: Record<string, ConfigEffect> = {};
  for (const key of flattenConfigLeafPaths(config)) {
    effects[key] = classifyConfigEffect(key);
  }
  return effects;
}

/**
 * The machine-scope (`~/.config/lore/config.yaml` / XDG) write path — `read()`/
 * `update()`. See this module's own header for the full design rationale.
 */
export class GlobalConfigService {
  /**
   * @param configPath - Absolute path to the global config file. The CALLER
   *   resolves this (typically `resolveGlobalConfigPath() ?? resolveGlobalConfigWritePath()`,
   *   both `@lore/core/node`) — this service has no XDG-precedence knowledge
   *   of its own, mirroring `ConfigService`'s `corpusDir` (a resolved
   *   directory, not a resolution algorithm). Tests MUST pass a throwaway
   *   `mkdtemp` path — never the real XDG path.
   * @param appendAuditEntry - Narrow port for the audit write, bound to
   *   `store.appendAuditEntry` in production wiring (same shape as
   *   `ConfigService`'s identically-typed constructor param).
   */
  constructor(
    private readonly configPath: string,
    private readonly appendAuditEntry: AppendConfigAuditEntry,
  ) {}

  /**
   * Reads the current global config. A missing file is `ok({})` (D7 — not an
   * error), propagating {@link loadGlobalConfig}'s malformed-file error
   * verbatim otherwise.
   *
   * @returns The (redacted, currently a no-op) config plus a per-key effect map.
   */
  async read(): Promise<Result<GlobalConfigReadResult, LoreError>> {
    const loaded = loadGlobalConfig(this.configPath);
    if (!loaded.ok) return loaded;

    const redacted = redactConfigValues(loaded.value) as GlobalLoreConfig;
    return ok({ config: redacted, effects: buildEffectsMap(redacted) });
  }

  /**
   * Validates then writes a patch onto the current global config.
   *
   * Order of operations (see class @invariant above for the full rationale):
   *   1. Reject a non-object patch outright.
   *   2. Reject any patch touching a `CONFIG_DENY_KEYS` key (e.g.
   *      `defaults.editor`) — ZERO disk access before this point.
   *   3. Load the current config (missing file → `{}`, D7).
   *   3.5. If `opts.expectedHash` was supplied, re-derive the CURRENT hash and
   *      reject on a mismatch.
   *   4. Deep-merge the patch onto the current config, validate the merged
   *      candidate against `GlobalLoreConfigSchema` — reject on schema
   *      violation with the on-disk file (if any) still untouched.
   *   5. `saveGlobalConfig` the validated merged config (atomic, creates
   *      parent directories per D7).
   *   6. Write exactly one audit row.
   *
   * @param patch - Untrusted candidate patch (e.g. an HTTP request body)
   * @param opts - `{ actor, expectedHash? }`
   * @returns `{config, effects, updated, restart_required}` on success. A
   *   rejection at any of steps 1-4 returns before any write and produces
   *   zero audit rows; a `saveGlobalConfig`/`appendAuditEntry` failure at
   *   steps 5-6 propagates that error verbatim.
   */
  async update(
    patch: unknown,
    opts: GlobalConfigUpdateOpts,
  ): Promise<Result<GlobalConfigUpdateResult, LoreError>> {
    if (!isPlainObject(patch)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "patch",
        message: "Global config patch must be a plain object",
        value: patch,
      });
    }

    // D1 — deny-key check FIRST, before any disk read/write whatsoever. Same
    // CONFIG_DENY_KEYS table ConfigService enforces (defaults.editor is on it,
    // per SPEC-062 AC-062-13 / SPEC-064 D1 "one deny table, both scopes").
    const denied = findDeniedConfigKeys(patch);
    if (denied.length > 0) {
      const [first, ...rest] = denied;
      const also = rest.length > 0 ? ` (also denied: ${rest.join(", ")})` : "";
      return err({
        code: "VALIDATION_ERROR",
        field: first as string,
        message:
          `Cannot modify "${first}" over this surface — edit it by hand in the machine config.yaml${also}`,
        value: patch,
      });
    }

    const currentResult = loadGlobalConfig(this.configPath);
    if (!currentResult.ok) return currentResult;
    const current = currentResult.value;

    // expectedHash CAS — re-derives the CURRENT hash from a FRESH read (never
    // the caller's own precheck) and rejects on mismatch BEFORE any
    // merge/validation/write — zero bytes written, zero audit rows. Skipped
    // entirely when the caller omits `expectedHash`.
    if (opts.expectedHash !== undefined) {
      const currentRedacted = redactConfigValues(current) as GlobalLoreConfig;
      // reason: computeConfigHash's implementation (stableStringify + sha256)
      // is behaviorally generic over any config-shaped object, but its
      // signature is narrowly typed to LoreConfig at its ConfigService call
      // site. GlobalLoreConfig ({defaults?}) is not structurally assignable to
      // LoreConfig (whose other top-level sections are required, defaulted by
      // Zod) — this cast documents that divergence rather than silently
      // hand-rolling a second sha256 CAS hash (see module header @invariant).
      const currentHash = computeConfigHash(currentRedacted as unknown as LoreConfig);
      if (currentHash !== opts.expectedHash) {
        return err({
          code: "VALIDATION_ERROR",
          field: "expectedHash",
          message: "Global config has changed since expectedHash was read — reread and retry",
          value: { expected: opts.expectedHash, current: currentHash },
        });
      }
    }

    const merged = deepMergeConfigPatch(
      current as unknown as Record<string, unknown>,
      patch,
    );
    const parsed = GlobalLoreConfigSchema.safeParse(merged);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? issue.path.join(".") || "root" : "root",
        message: issue !== undefined ? issue.message : "Invalid global config patch",
        value: patch,
      });
    }

    const updated = flattenConfigLeafPaths(patch);
    const restartRequired = updated.filter((key) => classifyConfigEffect(key) === "restart_required");

    const saveResult = saveGlobalConfig(parsed.data, this.configPath);
    if (!saveResult.ok) return saveResult;

    const auditResult = await this.appendAuditEntry({
      timestamp: new Date().toISOString(),
      actor: opts.actor,
      session_id: GLOBAL_CONFIG_AUDIT_SESSION_ID,
      action: GLOBAL_CONFIG_UPDATE_AUDIT_ACTION,
      details: { changed_keys: updated },
    });
    if (!auditResult.ok) return auditResult;

    const redacted = redactConfigValues(parsed.data) as GlobalLoreConfig;
    return ok({
      config: redacted,
      effects: buildEffectsMap(redacted),
      updated,
      restart_required: restartRequired,
    });
  }
}
