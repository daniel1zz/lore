/**
 * Pure builders for hermetic judge-subprocess spawn parameters (SPEC-030 AC-HJ-1).
 *
 * Problem this fixes: `ClaudeCliProvider.generate` (claude-cli-provider.ts) used to call
 * `Bun.spawn` with the calling process's INHERITED cwd and env. Because `lore assess` is
 * itself frequently invoked from inside a live Claude Code session, the spawned judge
 * process loaded the HOST machine's Claude Code configuration — project/user CLAUDE.md
 * and hooks. A host Stop-hook that emits a marker-formatted final message REPLACED the
 * judge's JSON response (`claude -p` returns only the LAST assistant message), so `lore
 * assess` failed nondeterministically depending purely on host hook state, not on the
 * judge materials (SPEC-030 §1.1 — reproduced live: 4 clean runs, then 3 polluted, same
 * inputs). The evaluation loop's stability must not depend on the operator's personal
 * hook configuration.
 *
 * `claude --help` was probed on the implementing machine (Claude Code 2.1.198) for an
 * official isolation mechanism before reaching for env/cwd sanitization alone. It exposes
 * `--setting-sources <sources>` — "Comma-separated list of setting sources to load (user,
 * project, local)." Passing an EMPTY value (`--setting-sources ""`) disables ALL THREE
 * sources, which is what gates hook registration and CLAUDE.md auto-discovery. This was
 * verified empirically on this machine: in a directory containing both a project
 * CLAUDE.md and a Stop hook, `echo "..." | claude -p` returned the hook's marker text
 * instead of the model's answer; the identical prompt with `--setting-sources ""` added
 * returned the model's actual answer, unpolluted. `--bare` was also considered and
 * REJECTED: its own help text says Anthropic auth becomes "strictly ANTHROPIC_API_KEY or
 * apiKeyHelper via --settings (OAuth and keychain are never read)" — that would break
 * authentication on any judge machine relying on an interactive OAuth/keychain login,
 * trading a contamination bug for an outright auth failure. `--setting-sources ""` has no
 * such side effect on auth, so it is the official mechanism applied here.
 *
 * The flag is injected ONLY when the configured command resolves (by basename) to the
 * `claude` binary — its semantics are specific to the Claude Code CLI, and a user who
 * substitutes a custom judge command via `ai.providers.<name>.command` owns that command's
 * full argument contract; injecting a Claude-Code-specific flag into an arbitrary
 * executable would be silent, surprising behavior.
 *
 * Env/cwd sanitization is layered ON TOP of the flag, not a replacement for it: the flag
 * governs which config FILES the child reads; env sanitization additionally prevents the
 * child from ever OBSERVING that it is running inside a live Claude Code session at all.
 * `CLAUDECODE=1` / `CLAUDE_CODE_SESSION_ID` / etc. are exactly the signals SPEC-024's own
 * surface detector (`resolve-ai.ts`) uses to distinguish "agent" callers — leaving them in
 * the judge's env would let a judge subprocess that itself shells out to `lore` mis-detect
 * its own caller surface. The neutral cwd (OS tmpdir, not the host's project directory)
 * closes the same gap for any relative-path config/CLAUDE.md discovery that doesn't key
 * off env at all.
 *
 * Public surface:
 *   - buildHermeticSpawnSpec(cfg, context) — the ONLY function claude-cli-provider.ts
 *     should call to obtain {command, args, cwd, env} for Bun.spawn
 *   - sanitizeSpawnEnv(sourceEnv) — env denylist filter, exported for direct unit testing
 *   - isClaudeCliCommand(command) — basename check, exported for direct unit testing
 *   - HermeticSpawnSpec — the returned shape
 *
 * Invariants:
 *   - Pure: no Bun.*, no IO, no Date.now()/Math.random(), no reads of process.env or
 *     os.tmpdir() internally — both are accepted as parameters so this module stays
 *     vitest-testable even though its only caller (claude-cli-provider.ts) is bun-only.
 *   - sanitizeSpawnEnv strips exactly two key families: the literal key "CLAUDECODE" and
 *     any key with the "CLAUDE_" prefix. Every other key (PATH, HOME, TERM, LANG, LC_*,
 *     ANTHROPIC_API_KEY, etc.) passes through unchanged — this is a denylist, not an
 *     allowlist, so it never needs updating when a new benign env var appears.
 *   - undefined-valued env entries are dropped: Bun.spawn's `env` option type is
 *     Record<string, string>, but process.env's type is Record<string, string|undefined>.
 *   - isClaudeCliCommand matches on path basename, not string equality, so an absolute
 *     path override (e.g. "/usr/local/bin/claude") is still recognized as the Claude CLI.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-030 AC-HJ-1
 */

import { basename } from "node:path";
import type { AiProviderConfig } from "@lore/core";

/** Literal env var Claude Code sets to signal "I am running inside a Claude Code session". */
const CLAUDE_CODE_SESSION_FLAG_ENV = "CLAUDECODE";

/** Prefix shared by all other Claude-Code-specific env vars (CLAUDE_CODE_*, CLAUDE_EFFORT, ...). */
const CLAUDE_ENV_PREFIX = "CLAUDE_";

/** The official Claude CLI flag that disables user/project/local settings loading (hooks + CLAUDE.md). */
const HERMETIC_ISOLATION_FLAGS: readonly string[] = ["--setting-sources", ""];

/**
 * Spawn parameters consumed directly by
 * `Bun.spawn([spec.command, ...spec.args], { cwd: spec.cwd, env: spec.env, ... })`.
 */
export interface HermeticSpawnSpec {
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
}

/**
 * Strip Claude-Code session/hook signal variables from an environment map.
 *
 * @param sourceEnv - Raw process environment (e.g. `process.env`); values may be `undefined`
 * @returns A new env map with `CLAUDECODE` and every `CLAUDE_`-prefixed key removed; every
 *   other key (including auth-relevant vars like `ANTHROPIC_API_KEY`, `PATH`, `HOME`,
 *   `TERM`, `LANG`, `LC_*`) passes through unchanged. Never mutates `sourceEnv`.
 *
 * @example
 * sanitizeSpawnEnv({ PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "abc" });
 * // → { PATH: "/bin" }
 */
export function sanitizeSpawnEnv(
  sourceEnv: Record<string, string | undefined>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (value === undefined) continue;
    if (key === CLAUDE_CODE_SESSION_FLAG_ENV) continue;
    if (key.startsWith(CLAUDE_ENV_PREFIX)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

/**
 * Whether `command` resolves to the Claude Code CLI binary (by basename, not full string
 * equality) — used to decide whether the official `--setting-sources ""` isolation flag
 * applies. A user-substituted custom judge command (any other basename) is left untouched.
 *
 * @example
 * isClaudeCliCommand("claude") // true
 * isClaudeCliCommand("/usr/local/bin/claude") // true
 * isClaudeCliCommand("./my-judge-script.sh") // false
 */
export function isClaudeCliCommand(command: string): boolean {
  return basename(command) === "claude";
}

/**
 * Build the full hermetic spawn spec for a provider config: neutral cwd, sanitized env,
 * and (for the `claude` binary specifically) the official isolation flag appended to args.
 *
 * @param cfg - Provider config (`command`, `args`, `timeout_ms`) from the registry
 * @param context.sourceEnv - Raw environment to sanitize (caller passes `process.env`)
 * @param context.tmpDir - Neutral working directory (caller passes `os.tmpdir()`). Accepted
 *   as a parameter rather than read internally so this function stays pure and vitest-testable.
 * @returns {@link HermeticSpawnSpec} ready to hand to `Bun.spawn`
 *
 * @example
 * buildHermeticSpawnSpec(
 *   { command: "claude", args: ["-p"], timeout_ms: 60000 },
 *   { sourceEnv: { PATH: "/bin", CLAUDECODE: "1" }, tmpDir: "/tmp" },
 * );
 * // → { command: "claude", args: ["-p", "--setting-sources", ""], cwd: "/tmp", env: { PATH: "/bin" } }
 *
 * @example
 * buildHermeticSpawnSpec(
 *   { command: "./my-judge.sh", args: ["--json"], timeout_ms: 60000 },
 *   { sourceEnv: { PATH: "/bin" }, tmpDir: "/tmp" },
 * );
 * // → { command: "./my-judge.sh", args: ["--json"], cwd: "/tmp", env: { PATH: "/bin" } }
 * // (no isolation flag injected — command is not the claude CLI)
 */
export function buildHermeticSpawnSpec(
  cfg: AiProviderConfig,
  context: { sourceEnv: Record<string, string | undefined>; tmpDir: string },
): HermeticSpawnSpec {
  const args = isClaudeCliCommand(cfg.command)
    ? [...cfg.args, ...HERMETIC_ISOLATION_FLAGS]
    : [...cfg.args];
  return {
    command: cfg.command,
    args,
    cwd: context.tmpDir,
    env: sanitizeSpawnEnv(context.sourceEnv),
  };
}
