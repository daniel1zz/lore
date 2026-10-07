/**
 * @lore/core — public surface. MUST BE BROWSER-SAFE.
 *
 * Pure types, errors, schemas, config, telemetry, and graph helpers.
 * MUST NOT import from @lore/lore (boundary enforced by AC-MR-B1 in SPEC-014).
 *
 * @invariant Every module re-exported from this barrel, and everything it
 *   transitively imports, MUST be free of Node builtins (`fs`, `path`, `os`,
 *   `child_process`, `node:*`, ...) and free of `Bun.*` (the latter already
 *   enforced by AC-AI-13 for ai.ts). Vite's dev-mode `fs` stub throws on any
 *   named-export access at module-LOAD time (not call time) — a single stray
 *   top-level `import { x } from "fs"` anywhere in this barrel's dependency
 *   graph blanks the `@lore/dashboard` SPA before React mounts.
 *   Node-only helpers (config file I/O, JSONL telemetry writer) live in
 *   `config-node.ts` / `telemetry-node.ts` and are exported ONLY via the
 *   `@lore/core/node` subpath (see `node.ts`, `package.json#exports`) — server
 *   code (`packages/lore/src/**`, `scripts/**`) imports that subpath directly.
 *   Regression oracle: `packages/dashboard/tests/e2e/write-flow.pw.ts` (SPEC-022)
 *   — run it after touching any file in this barrel's transitive closure.
 *
 * Consumed by:
 *   - @lore/lore (all CLI / MCP / HTTP runtime) — both `@lore/core` and `@lore/core/node`
 *   - @lore/dashboard (browser SPA) — `@lore/core` ONLY, never `@lore/core/node`
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
export * from "./truncate.js";
export * from "./attestation-completeness.js";
export * from "./oracle-file-existence.js";
export * from "./task-workflow.js";
export * from "./acceptance.js";
export * from "./ac-quality.js";
export * from "./verification-profile.js";
export * from "./uat.js";
export * from "./requirement.js";
export * from "./assessment.js";
export * from "./spec-kind.js";
export * from "./spec-kind-audit.js";
export * from "./review-judgment.js";
export * from "./review-checks.js";
export * from "./calibration.js";
export * from "./audit-actor.js";
export * from "./doc-type-meta.js";
export * from "./session.js";
export * from "./seat.js";
export * from "./file-anchors.js";
export * from "./validity.js";
export * from "./staleness.js";
export * from "./code-anchors.js";
export * from "./phase.js";
export * from "./phase-completion.js";
export * from "./frontmatter.js";
export * from "./verify-execution-root.js";
export * from "./corpus-provenance.js";
export * from "./setup-manifest.js";
export * from "./merge-settings.js";
export * from "./register-mcp.js";
export * from "./distribution-hooks.js";
export * from "./config-editability.js";
export * from "./config-precedence.js";
export * from "./session-actor.js";
export * from "./issue-report.js";
export * from "./issue-front-matter.js";
export * from "./issue-resolution-vocab.js";
export * from "./evidence-panel.js";
export * from "./plan-update.js";
export * from "./outline.js";
export * from "./ordinal.js";
export * from "./archive-candidates.js";
export * from "./memory-markers.js";
export * from "./memory-file-sections.js";
export * from "./fs-ports.js";
export * from "./trace.js";
