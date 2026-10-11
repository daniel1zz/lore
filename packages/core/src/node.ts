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
 *   - getTransliterateCjk / containsCjk (slugify-node.ts, SPEC-068 D1, hotfix
 *     2026-07-23) — pinyin-pro-powered CJK transliteration for `slugify`'s
 *     `opts.transliterate` hook. `getTransliterateCjk()` is async (a
 *     static-specifier dynamic `import("pinyin-pro")`, compile-safe under
 *     `bun build --compile` — see slugify-node.ts's own header for why the
 *     prior `createRequire` form broke in the compiled binary). Grouped here
 *     for the SAME barrel-isolation reason as the other two (pinyin-pro is
 *     ~931KB unpacked, must stay unreachable from the browser bundle), even
 *     though this one performs no filesystem IO of its own.
 *   - resolveActorWithSource / ActorSource / ResolvedActor (actor-resolution-
 *     node.ts, SPEC-079 G2) — the `--by`/`$LORE_ACTOR`/session-tier/OS-username
 *     precedence chain, relocated here from the CLI adapter so `CorpusService`
 *     can apply the identical fallback when a caller omits `opts.by`. Grouped
 *     here for the SAME reason (its OS-fallback tier calls `os.userInfo()`).
 *   - resolveInvocationIdentity / RunIdentityArgumentError (run-identity-node.ts,
 *     run-identity-slice-1 D1/D8/D11) — per-invocation harness run + claimed name.
 *
 * Invariants:
 *   - Import via `@lore/core/node`, never via relative path into another package.
 *   - Only server-side code may import this subpath: `packages/lore/src/**`,
 *     `scripts/**`. `packages/dashboard/src/**` MUST NOT import `@lore/core/node`
 *     (grep check: `grep -r '@lore/core/node' packages/dashboard/src` → 0 hits).
 *
 * Side-effect class: IO (config-node.ts/telemetry-node.ts perform filesystem
 *   access; slugify-node.ts's IO is its deferred dynamic `import()`, not
 *   filesystem/network access — grouped here for barrel isolation)
 *
 * Source: fix(core) browser-safety task — see packages/core/src/CLAUDE.md
 *   "Browser Safety Invariant" and packages/core/src/index.ts header.
 */

export * from "./config-node.js";
export * from "./telemetry-node.js";
export * from "./slugify-node.js";
export * from "./actor-resolution-node.js";
export * from "./run-identity-node.js";
