/**
 * Config HTTP surface — GET /api/config + PATCH /api/dashboard/config (SPEC-062 D3/D4)
 * and their machine-scope siblings, GET /api/config/machine + PATCH
 * /api/dashboard/config/machine (SPEC-064 D6/D1).
 *
 * Public surface: handleGetConfig, handleDashboardConfigPatch, handleGetMachineConfig,
 *   handleDashboardMachineConfigPatch, computeConfigHash
 *
 * Invariants:
 *   - All writes flow through `ConfigService.update` / `GlobalConfigService.update` —
 *     this file NEVER reads/writes `.lore/config.yaml` or the XDG global config itself,
 *     and never duplicates the deny-key / schema-validation logic those services already
 *     own (SPEC-062 D1/D2; SPEC-064 D1 — ONE `CONFIG_DENY_KEYS` table governs both scopes).
 *   - `GET /api/config` and `GET /api/config/machine` are available to BOTH cookie and
 *     bearer sessions — dispatched from `routes.ts`'s general `/api/*` table (the SAME
 *     auth duality every other v1 GET route gets), NOT the cookie-only `/api/dashboard/*`
 *     namespace.
 *   - `PATCH /api/dashboard/config` and `PATCH /api/dashboard/config/machine` are BOTH
 *     dispatched from `dashboard-routes.ts`'s `handleDashboardRoute` — they inherit that
 *     dispatcher's CSRF Origin guard (`assertAllowedOrigin`) and cookie-only guard
 *     (`assertCookieActor`) UNCHANGED, run BEFORE either handler is ever called. A
 *     bearer-token actor never reaches this file's PATCH handlers at all (AC-062-5,
 *     extended to the machine route by SPEC-064's own AC) — zero risk of a code path
 *     here accidentally allowing one. Route-path choice (SPEC-064 D6): a DISTINCT path
 *     segment (`/machine`) rather than a `?scope=` query param — `dashboard-routes.ts`'s
 *     path matcher already does exact-string dispatch per resource, so a second literal
 *     path keeps that dispatch table's "one entry, one resource" shape instead of pushing
 *     scope-branching logic into a shared handler.
 *   - Config has no `DocRecord.version` — the "If-Match" value is a sha256 hash of the
 *     REDACTED config object the corresponding GET returned (the exact payload the client
 *     observed), computed via {@link computeConfigHash} — RE-EXPORTED from
 *     `ConfigService` (the SSOT for the hash algorithm; see that module's header) rather
 *     than kept as an independent local copy, closing the "hand-maintained twin" risk a
 *     duplicate implementation here would otherwise carry. The machine-scope handlers
 *     below reuse the SAME function — `GlobalConfigService.update`'s own `expectedHash`
 *     CAS already casts through it (see that module's cast-note) — never a second hash.
 *   - **SPEC-062 T3 (closes a TOCTOU T2 flagged but did not fix)**: this route's own
 *     hash comparison below is now a PRECHECK ONLY, defense-in-depth — the AUTHORITATIVE
 *     CAS lives inside `ConfigService.update`/`GlobalConfigService.update` itself
 *     (`opts.expectedHash`), which re-derives the current hash from a FRESH read at
 *     write time. A second writer committing BETWEEN this precheck's read and the
 *     `update()` call is now caught by that inner CAS (translated back into the same 409
 *     `STALE_VERSION` shape below, rather than the generic `VALIDATION_ERROR` → 422
 *     mapping) instead of silently overwriting the interleaved writer's commit.
 *   - Known coverage gap: the hash is computed over the REDACTED view (the only view
 *     `ConfigService.read()`/`GlobalConfigService.read()` exposes) — an out-of-band edit
 *     to a value that always redacts to the same marker would not change the hash. Every
 *     such key is ALSO on `CONFIG_DENY_KEYS` (never writable through this surface), so
 *     the blind spot only matters for a manual on-disk edit racing a dashboard session,
 *     not for anything reachable through either PATCH route itself.
 *   - Missing `If-Match` on either PATCH is explicitly REJECTED (400 VALIDATION_ERROR) —
 *     unlike the doc-PATCH route's legacy "absent If-Match = unconditional write" escape
 *     (`concurrency.ts::checkConcurrency`), config governs gate/workflow behavior for the
 *     whole corpus (team scope) or EVERY corpus on the machine (machine scope), so an
 *     unconditional blind overwrite is not offered as a silent default in either. This is
 *     a DELIBERATE divergence from the doc-PATCH convention, not an oversight.
 *   - `app.globalConfigService === undefined` (test stubs that omit it, mirroring
 *     `app.configService`) → 500 `STORE_ERROR` from the machine handlers, same shape as
 *     the team handlers' existing `configService` guard.
 *
 * Side-effect class: IO (delegates to ConfigService/GlobalConfigService; this file is
 *   otherwise pure)
 *
 * Source: SPEC-062 §Scope D3, D4, D5; SPEC-064 §Design D1, D6
 */

import type { App } from "../../app.js";
import type { ActorContext } from "./auth.js";
import { jsonOk, jsonError, loreErrorResponse, parseJsonBody, emitDashboardTelemetry } from "./middleware.js";
import { computeConfigHash } from "../../service/config-service.js";
import type { GlobalLoreConfig, LoreConfig } from "@lore/core";

// ─── Hashing ────────────────────────────────────────────────────────────────

/**
 * The "If-Match"/hash function — RE-EXPORTED from `ConfigService`, the SSOT
 * (see that module's `computeConfigHash` doc for the algorithm and the
 * rationale for keeping exactly one implementation). Kept as a named
 * re-export here (rather than requiring every caller to import from
 * `service/config-service.js` directly) so this module's own documented
 * "Public surface" list stays accurate and no external import site needs to
 * change.
 */
export { computeConfigHash };

// ─── GET /api/config ────────────────────────────────────────────────────────

/**
 * GET /api/config — the redacted config, its per-key effect classification,
 * and the current hash (for a subsequent `PATCH /api/dashboard/config`'s
 * `If-Match`). Available to both cookie and bearer sessions (dispatched from
 * `routes.ts`'s general table — see module header).
 *
 * @param app - Wired application instance.
 */
export async function handleGetConfig(app: App): Promise<Response> {
  if (app.configService === undefined) {
    return jsonError({ code: "STORE_ERROR", message: "Config service not initialised" }, 500);
  }

  const result = await app.configService.read();
  if (!result.ok) return loreErrorResponse(result.error);

  return jsonOk({
    config: result.value.config,
    effects: result.value.effects,
    hash: computeConfigHash(result.value.config),
  });
}

// ─── PATCH /api/dashboard/config ────────────────────────────────────────────

/**
 * PATCH /api/dashboard/config — validate-then-write a config patch via
 * `ConfigService.update`. Called ONLY from `dashboard-routes.ts::handleDashboardRoute`,
 * which has already run the CSRF Origin guard and the cookie-only actor guard for
 * this path (a bearer-token actor never reaches this function — AC-062-5).
 *
 * If-Match handling (see module header for the full rationale):
 *   - Missing/empty `If-Match` → 400 `VALIDATION_ERROR` (no unconditional-write escape).
 *   - Present but stale (does not equal `computeConfigHash` of the CURRENT redacted
 *     config, read fresh — never the client's own stale copy) → 409 `STALE_VERSION`
 *     carrying `current_hash` + the current (redacted) config; `ConfigService.update`
 *     is NEVER called on this path, so config.yaml is provably untouched (AC-062-3).
 *   - Present and matching → proceeds to `ConfigService.update`.
 *
 * @param req - Incoming PATCH request (JSON body = the config patch).
 * @param app - Wired application instance.
 * @param actor - Resolved cookie actor (guaranteed by the caller's guard).
 */
export async function handleDashboardConfigPatch(
  req: Request,
  app: App,
  actor: ActorContext,
): Promise<Response> {
  if (app.configService === undefined) {
    return jsonError({ code: "STORE_ERROR", message: "Config service not initialised" }, 500);
  }

  const body = await parseJsonBody(req);
  if (body === null || typeof body !== "object") {
    return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Request body must be JSON" }, 422);
  }

  const ifMatch = req.headers.get("If-Match");
  if (ifMatch === null || ifMatch.trim() === "") {
    return jsonError(
      {
        code: "VALIDATION_ERROR",
        field: "If-Match",
        message: "If-Match header is required for PATCH /api/dashboard/config (no unconditional-write path)",
      },
      400,
    );
  }

  const currentResult = await app.configService.read();
  if (!currentResult.ok) return loreErrorResponse(currentResult.error);

  const currentHash = computeConfigHash(currentResult.value.config);
  if (ifMatch.trim() !== currentHash) {
    return jsonError(
      {
        code: "STALE_VERSION",
        message: "Config has changed since you last read it",
        current_hash: currentHash,
        current: currentResult.value.config,
      },
      409,
    );
  }

  const actorName = actor.owner ?? actor.name;
  const updateResult = await app.configService.update(body, {
    actor: actorName,
    expectedHash: ifMatch.trim(),
  });
  if (!updateResult.ok) {
    // SPEC-062 T3 — a concurrent writer landed in the window between this
    // route's own precheck read (above) and ConfigService.update's fresh
    // internal re-read: the service's authoritative expectedHash CAS caught
    // it. Translate that into the SAME 409 STALE_VERSION shape the precheck
    // above returns (rather than the generic VALIDATION_ERROR → 422 mapping)
    // so callers see one consistent conflict shape regardless of which layer
    // caught the race.
    if (updateResult.error.code === "VALIDATION_ERROR" && updateResult.error.field === "expectedHash") {
      const freshResult = await app.configService.read();
      if (!freshResult.ok) return loreErrorResponse(freshResult.error);
      const freshHash = computeConfigHash(freshResult.value.config);
      return jsonError(
        {
          code: "STALE_VERSION",
          message: "Config has changed since you last read it",
          current_hash: freshHash,
          current: freshResult.value.config,
        },
        409,
      );
    }
    return loreErrorResponse(updateResult.error);
  }

  emitDashboardTelemetry(app, "config_update", {
    updated: updateResult.value.updated,
    restart_required: updateResult.value.restart_required,
    actor: actorName,
  });

  return jsonOk({
    config: updateResult.value.config,
    effects: updateResult.value.effects,
    updated: updateResult.value.updated,
    restart_required: updateResult.value.restart_required,
    hash: computeConfigHash(updateResult.value.config),
  });
}

// ─── Machine-scope hashing (SPEC-064 D1) ────────────────────────────────────

/**
 * Hash a REDACTED {@link GlobalLoreConfig} — thin wrapper around
 * {@link computeConfigHash}, which is typed to `LoreConfig` at its `ConfigService`
 * call site. `GlobalLoreConfig` (`{defaults?}`) is not structurally assignable to
 * `LoreConfig` (whose other top-level sections are required, defaulted by Zod);
 * this ONE cast site documents that divergence — see `GlobalConfigService`'s
 * identically-reasoned cast note — rather than hand-rolling a second sha256 CAS
 * hash for the machine scope.
 *
 * @param config - Redacted global config (from `GlobalConfigService.read`/`update`).
 */
function computeGlobalConfigHash(config: GlobalLoreConfig): string {
  return computeConfigHash(config as unknown as LoreConfig);
}

// ─── GET /api/config/machine ─────────────────────────────────────────────────

/**
 * GET /api/config/machine — the redacted machine-scope (XDG) config, its
 * per-key effect classification, and the current hash (for a subsequent
 * `PATCH /api/dashboard/config/machine`'s `If-Match`). Available to both
 * cookie and bearer sessions, mirroring `GET /api/config` (see module header).
 *
 * @param app - Wired application instance.
 */
export async function handleGetMachineConfig(app: App): Promise<Response> {
  if (app.globalConfigService === undefined) {
    return jsonError({ code: "STORE_ERROR", message: "Global config service not initialised" }, 500);
  }

  const result = await app.globalConfigService.read();
  if (!result.ok) return loreErrorResponse(result.error);

  return jsonOk({
    config: result.value.config,
    effects: result.value.effects,
    hash: computeGlobalConfigHash(result.value.config),
  });
}

// ─── PATCH /api/dashboard/config/machine ────────────────────────────────────

/**
 * PATCH /api/dashboard/config/machine — validate-then-write a machine-scope
 * config patch via `GlobalConfigService.update`. Called ONLY from
 * `dashboard-routes.ts::handleDashboardRoute`, which has already run the CSRF
 * Origin guard and the cookie-only actor guard for this path (a bearer-token
 * actor never reaches this function — same guarantee as the team-scope PATCH,
 * SPEC-062 AC-062-5 / SPEC-064's own AC).
 *
 * If-Match handling (see module header for the full rationale — byte-identical
 * shape to the team-scope PATCH, just against the global-config hash):
 *   - Missing/empty `If-Match` → 400 `VALIDATION_ERROR` (no unconditional-write escape).
 *   - Present but stale (does not equal `computeGlobalConfigHash` of the CURRENT
 *     redacted global config, read fresh — never the client's own stale copy) →
 *     409 `STALE_VERSION` carrying `current_hash` + the current (redacted)
 *     config; `GlobalConfigService.update` is NEVER called on this path, so the
 *     global config file is provably untouched.
 *   - Present and matching → proceeds to `GlobalConfigService.update`.
 *
 * @param req - Incoming PATCH request (JSON body = the machine config patch).
 * @param app - Wired application instance.
 * @param actor - Resolved cookie actor (guaranteed by the caller's guard).
 */
export async function handleDashboardMachineConfigPatch(
  req: Request,
  app: App,
  actor: ActorContext,
): Promise<Response> {
  if (app.globalConfigService === undefined) {
    return jsonError({ code: "STORE_ERROR", message: "Global config service not initialised" }, 500);
  }

  const body = await parseJsonBody(req);
  if (body === null || typeof body !== "object") {
    return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Request body must be JSON" }, 422);
  }

  const ifMatch = req.headers.get("If-Match");
  if (ifMatch === null || ifMatch.trim() === "") {
    return jsonError(
      {
        code: "VALIDATION_ERROR",
        field: "If-Match",
        message: "If-Match header is required for PATCH /api/dashboard/config/machine (no unconditional-write path)",
      },
      400,
    );
  }

  const currentResult = await app.globalConfigService.read();
  if (!currentResult.ok) return loreErrorResponse(currentResult.error);

  const currentHash = computeGlobalConfigHash(currentResult.value.config);
  if (ifMatch.trim() !== currentHash) {
    return jsonError(
      {
        code: "STALE_VERSION",
        message: "Global config has changed since you last read it",
        current_hash: currentHash,
        current: currentResult.value.config,
      },
      409,
    );
  }

  const actorName = actor.owner ?? actor.name;
  const updateResult = await app.globalConfigService.update(body, {
    actor: actorName,
    expectedHash: ifMatch.trim(),
  });
  if (!updateResult.ok) {
    // Mirrors the team-scope PATCH's SPEC-062 T3 race handling — a concurrent
    // writer landed between this route's own precheck read (above) and
    // GlobalConfigService.update's fresh internal re-read; translate its
    // expectedHash CAS rejection into the SAME 409 STALE_VERSION shape.
    if (updateResult.error.code === "VALIDATION_ERROR" && updateResult.error.field === "expectedHash") {
      const freshResult = await app.globalConfigService.read();
      if (!freshResult.ok) return loreErrorResponse(freshResult.error);
      const freshHash = computeGlobalConfigHash(freshResult.value.config);
      return jsonError(
        {
          code: "STALE_VERSION",
          message: "Global config has changed since you last read it",
          current_hash: freshHash,
          current: freshResult.value.config,
        },
        409,
      );
    }
    return loreErrorResponse(updateResult.error);
  }

  emitDashboardTelemetry(app, "global_config_update", {
    updated: updateResult.value.updated,
    restart_required: updateResult.value.restart_required,
    actor: actorName,
  });

  return jsonOk({
    config: updateResult.value.config,
    effects: updateResult.value.effects,
    updated: updateResult.value.updated,
    restart_required: updateResult.value.restart_required,
    hash: computeGlobalConfigHash(updateResult.value.config),
  });
}
