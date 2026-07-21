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
 *     observed), computed via {@link computeConfigHash} (a deterministic, key-order-
 *     independent JSON serialization — @see stableStringify). This is a ROUTE-LEVEL
 *     PRECHECK ONLY (mirrors `concurrency.ts::checkConcurrency`'s pre-BUG-003 shape) —
 *     a second writer committing BETWEEN this precheck's read and the subsequent
 *     `ConfigService.update()` call is NOT caught by an inner CAS (`ConfigService.update`
 *     has no `expectedHash` parameter — that would be a `ConfigService` change, out of
 *     this task's file anchors). Flagged as a known follow-up, not silently absorbed.
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

import { createHash } from "node:crypto";
import type { App } from "../../app.js";
import type { ActorContext } from "./auth.js";
import type { LoreConfig } from "@lore/core";
import { jsonOk, jsonError, loreErrorResponse, parseJsonBody, emitDashboardTelemetry } from "./middleware.js";

// ─── Hashing ────────────────────────────────────────────────────────────────

/**
 * Deterministic, key-order-independent JSON serialization — object keys are
 * sorted recursively so two structurally-equal configs always serialize
 * identically regardless of how each was constructed (YAML key order,
 * object-spread order, etc.). Arrays keep their original element order
 * (order is semantically meaningful for arrays, unlike object keys).
 *
 * @param value - Any JSON-shaped value.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Compute the sha256 hex hash of `config`'s stable-stringified form — the
 * "version" a client's `If-Match` header must echo back (config has no
 * `DocRecord.version`; see module header).
 *
 * @param config - A (typically already-redacted) `LoreConfig`.
 */
export function computeConfigHash(config: LoreConfig): string {
  return createHash("sha256").update(stableStringify(config), "utf8").digest("hex");
}

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
  const updateResult = await app.configService.update(body, { actor: actorName });
  if (!updateResult.ok) return loreErrorResponse(updateResult.error);

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
