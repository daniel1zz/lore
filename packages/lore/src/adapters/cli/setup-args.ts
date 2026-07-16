/**
 * Pure flag-validation + path-resolution helpers for `lore setup`
 * (SPEC-046 §Design, task AC-046-E). Split out of `commands/setup.ts` for
 * vitest-testability, mirroring `assess-render.ts` / `review-render.ts` /
 * `handoff-input.ts` — `commands/setup.ts` transitively imports
 * `../../flows/init-corpus.ts` → `../../app.js` (`bun:sqlite`), which vitest
 * cannot resolve, but this module imports only `node:path` and plain object
 * shapes, so the target-dir resolution and flag-conflict logic get a real
 * vitest oracle instead of only integration-test coverage.
 *
 * Public surface:
 *   - SetupMode / SetupFlagInput / validateSetupFlags(input) — flag-conflict
 *     validation, resolving to exactly one run mode
 *   - resolveTargetDir(opts) — `--claude-dir` > `$CLAUDE_CONFIG_DIR` >
 *     `join(homeDir, ".claude")`
 *   - SetupPathContext / resolveBinPath(ctx) / resolveAssetsRoot(ctx) —
 *     compiled-vs-dev-mode binary/asset path resolution
 *
 * Invariants:
 *   - Every function here is PURE — no `process.env`/`process.execPath`/
 *     `os.homedir()`/`Bun.*` reads happen in this module; `commands/setup.ts`
 *     resolves those ambient values ONCE and passes them in as plain
 *     parameters (mirrors `SetupService`'s own "targetDir is a resolved
 *     param, never self-read" discipline).
 *   - `resolveBinPath`/`resolveAssetsRoot`'s compiled-vs-dev branch is
 *     EMPIRICALLY grounded, not guessed: Bun 1.3.x does not yet expose a
 *     `Bun.isStandaloneExecutable` flag (verified against this repo's pinned
 *     `bun-types` — the property is absent from `node_modules/bun-types/bun.d.ts`
 *     and reads back `undefined` at runtime on `bun --version` 1.3.10, despite
 *     appearing in Bun's `main`-branch docs). The reliable signal on this
 *     pinned version, verified with a throwaway `bun build --compile` probe:
 *     `Bun.main` is the real on-disk script path in dev mode (`bun run
 *     <file>`) but becomes an internal `/$bunfs/root/<name>` virtual path once
 *     compiled (Bun's own docs confirm `/$bunfs/` as the documented internal
 *     prefix for embedded/compiled resources, "Embed assets & files > How it
 *     works") — `commands/setup.ts` computes `isCompiled` from that prefix
 *     check and passes it in as `SetupPathContext.isCompiled`. Do NOT swap
 *     this for `Bun.isStandaloneExecutable` without first confirming the
 *     pinned `bun-types`/runtime actually expose it (re-run the probe: `bun
 *     build --compile` a one-line script printing `Bun.main`).
 *   - In COMPILED mode, `process.execPath` is empirically the compiled
 *     binary's OWN absolute path (same probe) — used verbatim as `binPath`
 *     (the path registered with `claude mcp add`) and its PARENT directory's
 *     sibling `assets/` as `assetsRoot` (the P1 "assets ships next to dist/"
 *     convention: `dirname(execPath)` is `<repo>/dist`, whose sibling is
 *     `<repo>/assets`). In DEV mode, both resolve relative to `repoRoot`
 *     (`commands/setup.ts` derives this from ITS OWN on-disk module location,
 *     which is a real path in dev mode — never in compiled mode, per the
 *     `/$bunfs/` note above).
 *   - This resolution chain does NOT support a compiled binary copied away
 *     from its repo checkout (e.g. installed to `/usr/local/bin/lore`) — a
 *     genuinely embedded/relocatable asset payload is documented future work
 *     (`real-asset-source.ts`'s own module doc: "a P3 implementation could
 *     swap to a binary-embedded payload"). `RealAssetSource.load()` already
 *     fails loud (`err(STORE_ERROR)` naming the unreadable path) when
 *     `assetsRoot` doesn't exist — this module does not duplicate that check.
 *
 * Source: SPEC-046 §Design ("targetDir resolution ... in the ADAPTER";
 *   "binPath resolution ... document your choice"), task AC-046-E.
 */

import { dirname, join, resolve } from "node:path";

// ─── Flag validation ─────────────────────────────────────────────────────────

/** The one run mode `lore setup`'s flag combination resolves to. */
export type SetupMode = "install" | "dry-run" | "uninstall" | "project";

/** Raw boolean/string flags as parsed off `citty`'s `args` object. */
export interface SetupFlagInput {
  dryRun: boolean;
  uninstall: boolean;
  project: boolean;
  /** `--claude-dir <path>`, when passed — `undefined` when omitted. */
  claudeDir?: string;
}

/** A rejected flag combination — always a CLI-usage error (exit 2), never a `LoreError`. */
export interface SetupFlagRejection {
  ok: false;
  message: string;
}

/** The result of {@link validateSetupFlags} — a resolved mode, or a rejection. */
export type SetupFlagResult = { ok: true; mode: SetupMode } | SetupFlagRejection;

/**
 * Resolves `lore setup`'s flag combination to exactly one {@link SetupMode},
 * or a rejection naming the conflicting flags. `--project` scaffolds a git
 * repo via `ProjectSetupService` and is mutually exclusive with every
 * global-installer-only flag (`--dry-run`, `--uninstall`, `--claude-dir`) —
 * those target `~/.claude` via `SetupService`, a different service entirely.
 * `--dry-run` and `--uninstall` are mutually exclusive with each other too:
 * `SetupService` has no `planUninstall` — there is no dry-run preview for a
 * reversal.
 *
 * @param input - The four mode-selecting flags.
 * @returns `{ok: true, mode}` on a valid combination, else `{ok: false, message}`.
 * @throws Never.
 * @example
 * validateSetupFlags({ dryRun: true, uninstall: false, project: false }); // => {ok: true, mode: "dry-run"}
 * validateSetupFlags({ dryRun: true, uninstall: true, project: false });  // => {ok: false, message: "..."}
 */
export function validateSetupFlags(input: SetupFlagInput): SetupFlagResult {
  if (input.project) {
    if (input.dryRun) {
      return {
        ok: false,
        message: "--project cannot be combined with --dry-run — project scaffolding has no plan-only preview mode.",
      };
    }
    if (input.uninstall) {
      return {
        ok: false,
        message:
          "--project cannot be combined with --uninstall — they target different services " +
          "(ProjectSetupService vs. the global SetupService's --uninstall reversal).",
      };
    }
    if (input.claudeDir !== undefined) {
      return {
        ok: false,
        message:
          "--project cannot be combined with --claude-dir — project scaffolding targets the current " +
          "repository, not a Claude Code config directory.",
      };
    }
    return { ok: true, mode: "project" };
  }

  if (input.dryRun && input.uninstall) {
    return {
      ok: false,
      message: "--dry-run cannot be combined with --uninstall — there is no uninstall preview mode.",
    };
  }

  if (input.uninstall) return { ok: true, mode: "uninstall" };
  if (input.dryRun) return { ok: true, mode: "dry-run" };
  return { ok: true, mode: "install" };
}

// ─── Target directory resolution ────────────────────────────────────────────

/** Inputs to {@link resolveTargetDir} — every ambient read (`env`, `homeDir`) is caller-resolved. */
export interface ResolveTargetDirOptions {
  /** `--claude-dir <path>` flag value, when passed. */
  claudeDirFlag?: string;
  /** The process environment (read for `CLAUDE_CONFIG_DIR`). */
  env: Readonly<Record<string, string | undefined>>;
  /** `os.homedir()`, caller-resolved. */
  homeDir: string;
}

/**
 * Resolves the target install directory: `--claude-dir` > `$CLAUDE_CONFIG_DIR`
 * > `join(homeDir, ".claude")` (SPEC-046 §Design). The winning candidate is
 * passed through `node:path`'s `resolve()` so a relative `--claude-dir`/
 * `$CLAUDE_CONFIG_DIR` value becomes absolute before it ever reaches
 * `SetupService` (which requires an already-resolved `targetDir`).
 *
 * @param opts - `{claudeDirFlag?, env, homeDir}`.
 * @returns An absolute directory path.
 * @throws Never.
 * @example
 * resolveTargetDir({ env: {}, homeDir: "/Users/x" }); // => "/Users/x/.claude"
 * resolveTargetDir({ claudeDirFlag: "/tmp/x", env: {}, homeDir: "/Users/x" }); // => "/tmp/x"
 */
export function resolveTargetDir(opts: ResolveTargetDirOptions): string {
  if (typeof opts.claudeDirFlag === "string" && opts.claudeDirFlag.trim() !== "") {
    return resolve(opts.claudeDirFlag);
  }
  const envDir = opts.env["CLAUDE_CONFIG_DIR"];
  if (typeof envDir === "string" && envDir.trim() !== "") {
    return resolve(envDir);
  }
  return join(opts.homeDir, ".claude");
}

// ─── Binary / assets path resolution ────────────────────────────────────────

/** Ambient facts `commands/setup.ts` resolves once and hands to {@link resolveBinPath}/{@link resolveAssetsRoot}. */
export interface SetupPathContext {
  /** Repo root, derived from `commands/setup.ts`'s own on-disk module location (dev mode only — see module doc). */
  repoRoot: string;
  /** `Bun.main.startsWith("/$bunfs/")` — see module doc for why this, not `Bun.isStandaloneExecutable`. */
  isCompiled: boolean;
  /** `process.execPath` — the compiled binary's own path, in compiled mode. */
  execPath: string;
}

/**
 * Resolves the `binPath` registered with `claude mcp add` / passed to
 * `McpRegistrar.add`: the compiled binary's own path when running compiled,
 * else the repo's (possibly not-yet-built) `dist/lore` path in dev mode.
 *
 * @param ctx - `{repoRoot, isCompiled, execPath}`.
 * @returns An absolute path.
 * @throws Never.
 */
export function resolveBinPath(ctx: SetupPathContext): string {
  return ctx.isCompiled ? ctx.execPath : join(ctx.repoRoot, "dist", "lore");
}

/**
 * Resolves the `assets/` tree root `RealAssetSource` reads from: in compiled
 * mode, the sibling of the compiled binary's parent directory (the P1
 * "`assets/` ships next to `dist/` at the repo root" convention); in dev
 * mode, `repoRoot`'s own `assets/` subdirectory.
 *
 * @param ctx - `{repoRoot, isCompiled, execPath}`.
 * @returns An absolute path — may not exist on disk; `RealAssetSource.load()`
 *   fails loud in that case, this function does not probe the filesystem.
 * @throws Never.
 */
export function resolveAssetsRoot(ctx: SetupPathContext): string {
  return ctx.isCompiled ? join(dirname(ctx.execPath), "..", "assets") : join(ctx.repoRoot, "assets");
}
