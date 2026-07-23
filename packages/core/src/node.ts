/**
 * @lore/core/node — server-only surface.
 *
 * Re-exports the Node-builtin-dependent (fs/path/os) implementations that were
 * deliberately excluded from the default `@lore/core` barrel (`index.ts`) so that
 * barrel stays browser-safe (consumed by `@lore/dashboard`).
 *
 * Public surface:
 *   - loadConfig / saveConfig / resolveGlobalConfigPath / loadGlobalConfig (config-node.ts)
 *   - JsonlTelemetry / createTelemetry (telemetry-node.ts)
 *   - transliterateCjk (slugify-node.ts, SPEC-068 D1) — pinyin-pro-powered CJK
 *     transliteration for `slugify`'s `opts.transliterate` hook. Grouped here for
 *     the SAME barrel-isolation reason as the other two (pinyin-pro is ~931KB
 *     unpacked, must stay unreachable from the browser bundle), even though this
 *     one performs no filesystem IO of its own — see slugify-node.ts's own header.
 *
 * Invariants:
 *   - Import via `@lore/core/node`, never via relative path into another package.
 *   - Only server-side code may import this subpath: `packages/lore/src/**`,
 *     `scripts/**`. `packages/dashboard/src/**` MUST NOT import `@lore/core/node`
 *     (grep check: `grep -r '@lore/core/node' packages/dashboard/src` → 0 hits).
 *
 * Side-effect class: IO (config-node.ts/telemetry-node.ts perform filesystem
 *   access; slugify-node.ts is pure — grouped here for barrel isolation only)
 *
 * Source: fix(core) browser-safety task — see packages/core/src/CLAUDE.md
 *   "Browser Safety Invariant" and packages/core/src/index.ts header.
 */

export * from "./config-node.js";
export * from "./telemetry-node.js";
export * from "./slugify-node.js";
