/**
 * Config HTTP surface — GET /api/config + PATCH /api/dashboard/config (SPEC-062 D3/D4).
 *
 * Public surface: handleGetConfig, handleDashboardConfigPatch, computeConfigHash
 *
 * Invariants:
 *   - All writes flow through `ConfigService.update` — this file NEVER reads/writes
 *     `.lore/config.yaml` itself, and never duplicates the deny-key / schema-validation
 *     logic `ConfigService` already owns (SPEC-062 D1/D2).
 *   - `GET /api/config` is available to BOTH cookie and bearer sessions — dispatched from
 *     `routes.ts`'s general `/api/*` table (the SAME auth duality every other v1 GET route
 *     gets), NOT the cookie-only `/api/dashboard/*` namespace.
 *   - `PATCH /api/dashboard/config` is dispatched from `dashboard-routes.ts`'s
 *     `handleDashboardRoute` — it inherits that dispatcher's CSRF Origin guard
 *     (`assertAllowedOrigin`) and cookie-only guard (`assertCookieActor`) UNCHANGED, run
 *     BEFORE this handler is ever called. A bearer-token actor never reaches this file at
 *     all (AC-062-5) — zero risk of a code path here accidentally allowing one.
 *   - Config has no `DocRecord.version` — the "If-Match" value is a sha256 hash of the
 *     REDACTED config object `GET /api/config` returned (the exact payload the client
 *     observed), computed via {@link computeConfigHash} — RE-EXPORTED from
 *     `ConfigService` (the SSOT for the hash algorithm; see that module's header) rather
 *     than kept as an independent local copy, closing the "hand-maintained twin" risk a
 *     duplicate implementation here would otherwise carry.
 *   - **SPEC-062 T3 (closes a TOCTOU T2 flagged but did not fix)**: this route's own
 *     hash comparison below is now a PRECHECK ONLY, defense-in-depth — the AUTHORITATIVE
 *     CAS lives inside `ConfigService.update` itself (`opts.expectedHash`), which
 *     re-derives the current hash from a FRESH read at write time. A second writer
 *     committing BETWEEN this precheck's read and the `update()` call is now caught
 *     by that inner CAS (translated back into the same 409 `STALE_VERSION` shape
 *     below, rather than the generic `VALIDATION_ERROR` → 422 mapping) instead of
 *     silently overwriting the interleaved writer's commit.
 *   - Known coverage gap: the hash is computed over the REDACTED view (the only view
 *     `ConfigService.read()` exposes) — an out-of-band edit to an `ai.http.headers.*`
 *     value (which always redacts to the same marker) would not change the hash. Every
 *     such key is ALSO on `CONFIG_DENY_KEYS` (never writable through this surface), so
 *     the blind spot only matters for a manual on-disk edit racing a dashboard session,
 *     not for anything reachable through `PATCH /api/dashboard/config` itself.
 *   - Missing `If-Match` on the PATCH is explicitly REJECTED (400 VALIDATION_ERROR) —
 *     unlike the doc-PATCH route's legacy "absent If-Match = unconditional write" escape
 *     (`concurrency.ts::checkConcurrency`), config governs gate/workflow behavior for the
 *     whole corpus, so an unconditional blind overwrite is not offered as a silent default
 *     here. This is a DELIBERATE divergence from the doc-PATCH convention, not an oversight.
 *
 * Side-effect class: IO (delegates to ConfigService; this file is otherwise pure)
 *
 * Source: SPEC-062 §Scope D3, D4, D5
 */

import type { App } from "../../app.js";
import type { ActorContext } from "./auth.js";
import { jsonOk, jsonError, loreErrorResponse, parseJsonBody, emitDashboardTelemetry } from "./middleware.js";
import { computeConfigHash } from "../../service/config-service.js";

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
