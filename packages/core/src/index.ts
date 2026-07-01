/**
 * @lore/core — public surface.
 *
 * Pure types, errors, schemas, config, telemetry, and graph helpers.
 * MUST NOT import from @lore/lore (boundary enforced by AC-MR-B1 in SPEC-014).
 *
 * Consumed by:
 *   - @lore/lore (all CLI / MCP / HTTP runtime)
 *   - @lore/dashboard (future — types only)
 */

export * from "./errors.js";
export * from "./types.js";
export * from "./schemas.js";
export * from "./config.js";
export * from "./telemetry.js";
export * from "./graph-utils.js";
export * from "./doc-type-rules.js";
export * from "./tree-blueprint.js";
export * from "./ai.js";
export * from "./text-normalise.js";
