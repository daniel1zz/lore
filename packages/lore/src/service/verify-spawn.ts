/**
 * Trusted-runner spawn spec builder + result mapper — PURE, vitest-safe (SPEC-039 §2 D5).
 * Mirrors `../ai/hermetic-spawn.ts`'s split: spawn-parameter construction and the
 * pass/fail decision live in a plain module with no Bun API, no IO, no Date.now()/
 * Math.random() — the actual `Bun.spawn` call lives ONLY in the sibling bun-only
 * `verify-executor.ts` (same two-file division `hermetic-spawn.ts` / the bun-only
 * `claude-cli-provider.ts` established for AI judge spawning).
 *
 * Public surface:
 *   - buildVerifySpawnSpec(criterion, opts) — the ONLY function that should compute
 *     {cmd, cwd, timeoutMs, killGraceMs, env?} for a script-mode acceptance criterion
 *   - deriveVerifyResult(exitCode, timedOut) — pure exit-code → pass/fail mapping
 *   - resolveVerifyEnv(processEnv, opts) — pure env-allowlist filter (SPEC-039 §M2)
 *   - DEFAULT_VERIFY_ENV_ALLOWLIST — the built-in default allowlist (before any
 *     `verify.env.allowlist` config additions)
 *   - VerifySpawnSpec — the input shape, consumed directly by verify-executor.ts
 *   - VerifyExecutionResult — the output shape verify-executor.ts produces. Defined
 *     HERE (not in the bun-only verify-executor.ts) so `VerifyRunnerService` and its
 *     vitest suite depend only on this pure module for the executor's contract type,
 *     never importing anything — not even a type — from the bun-only file (mirrors
 *     how `AIProviderService` depends on the `AIProvider` interface from `@lore/core`,
 *     never on the concrete `ClaudeCliProvider` class).
 *   - ScriptAcceptanceCriterion — an AcceptanceCriterion narrowed to verify.mode === "script"
 *
 * Invariants:
 *   - Pure: no Bun.*, no IO, no Date.now()/Math.random() calls. `repoRoot`,
 *     `defaultTimeoutMs`, and (for `resolveVerifyEnv`) `processEnv` are accepted as
 *     parameters (never read from process.env/cwd internally) so this module stays
 *     vitest-testable even though its only real caller (`VerifyRunnerService`, via
 *     `verify-executor.ts`) runs bun-only.
 *   - `timeoutMs` resolution order: the criterion's own `verify.timeout_ms` (per-AC
 *     override, acceptance.ts) wins; falling back to `opts.defaultTimeoutMs`
 *     (`verify.default_timeout_ms` config, resolved by `resolveVerifyDefaultTimeoutMs`
 *     in `@lore/core`) only when the AC omits it (SPEC-039 §2 D9).
 *   - `killGraceMs` is ALWAYS 5000 — not configurable per-AC or per-config (SPEC-039
 *     §2 D6 / §3). Every `VerifySpawnSpec` this module produces carries the same
 *     fixed grace period; the ~5s real-time cost this implies for the SIGKILL-path
 *     integration test is a deliberate, documented trade-off (SPEC-039 §6 D10).
 *   - `cmd` is always `["sh", "-c", command]` — the criterion's `verify.command` is an
 *     arbitrary shell one-liner (same trust tier as npm scripts, SPEC-039 §1), never
 *     parsed into argv tokens here.
 *   - `deriveVerifyResult` treats a timeout as `"fail"` UNCONDITIONALLY, even on the
 *     (POSIX-improbable but not impossible) chance that `exitCode` happens to be 0 —
 *     a process killed by the watchdog never gets credited as "passed" merely because
 *     of a coincidental exit code race.
 *   - `VerifySpawnSpec.env` is OPTIONAL (SPEC-039 §M2, REGRESSION-safe) — omitted
 *     means "let `verify-executor.ts`'s `Bun.spawn` inherit the full parent
 *     environment" (either `passthrough_all: true`, or a hand-built `VerifySpawnSpec`
 *     that predates this field, e.g. `verify-executor.bun.test.ts`'s direct literals).
 *     `resolveVerifyEnv` returns `undefined` for exactly the `passthrough_all: true`
 *     case, so `buildVerifySpawnSpec` can thread it straight through without a second
 *     branch. When present, `env` REPLACES (never merges with) the spawned process's
 *     environment — verified empirically against Bun 1.3.10 (`Bun.spawn({env})` does
 *     NOT inherit `process.env` when `env` is explicitly given; unlisted vars are
 *     simply absent in the child, confirmed by spawning a subprocess with a deliberately
 *     narrow `env` and observing an unlisted var read back empty).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-039 §2 D5, D6, D9; §3; §4 AC-VRF-4; §M2 (env allowlist hardening)
 */

import type { AcceptanceCriterion } from "@lore/core";

/** Fixed grace period between SIGTERM and SIGKILL escalation (SPEC-039 §2 D6). Not configurable. */
const KILL_GRACE_MS = 5000;

/**
 * Built-in default env-var allowlist for a spawned verify command (SPEC-039 §M2).
 * Kept deliberately small — enough for ordinary build/test tooling (PATH resolution,
 * home-directory-relative caches, locale, terminal capability detection) without
 * leaking secrets (`LORE_SYNC_TOKEN`, `LORE_API_KEY`, cloud credentials, etc.) that
 * would otherwise ride along on a full `process.env` passthrough.
 *
 * `LC_*` (locale category overrides, e.g. `LC_ALL`/`LC_CTYPE`) is NOT listed here —
 * it's handled as a PREFIX match in {@link resolveVerifyEnv} instead of enumerating
 * every possible `LC_*` variable name.
 *
 * A `verify.env.allowlist` config entry is ADDITIVE to this set, never a replacement.
 */
export const DEFAULT_VERIFY_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "TERM",
  "PWD",
];

/**
 * Resolve the env map a verify spawn should receive (SPEC-039 §M2 env-allowlist
 * hardening). Pure — takes the parent environment as a parameter rather than
 * reading `process.env` internally.
 *
 * @param processEnv - The full parent environment (caller-supplied, typically
 *   `process.env` captured once at `app.ts` composition time — see
 *   `VerifyRunnerService`'s `config.processEnv`)
 * @param opts.allowlist - Additional env var names to allow, on top of
 *   {@link DEFAULT_VERIFY_ENV_ALLOWLIST} (`verify.env.allowlist` config)
 * @param opts.passthroughAll - When `true`, bypasses the allowlist entirely and
 *   returns `undefined` — the ESCAPE HATCH restoring pre-M2-hardening full
 *   passthrough behavior (`verify.env.passthrough_all` config)
 * @returns `undefined` when `passthroughAll` is true (signals "let the spawn
 *   inherit the full parent env"); otherwise a filtered `Record<string, string>`
 *   containing only allowlisted, defined-value entries
 *
 * @example
 * resolveVerifyEnv({ PATH: "/bin", LORE_SYNC_TOKEN: "secret" }, { allowlist: [], passthroughAll: false })
 * // => { PATH: "/bin" } — LORE_SYNC_TOKEN is filtered out
 *
 * @example
 * resolveVerifyEnv({ PATH: "/bin", CI_TOKEN: "x" }, { allowlist: ["CI_TOKEN"], passthroughAll: false })
 * // => { PATH: "/bin", CI_TOKEN: "x" } — CI_TOKEN allowed via the additive config allowlist
 *
 * @example
 * resolveVerifyEnv({ PATH: "/bin", LORE_SYNC_TOKEN: "secret" }, { allowlist: [], passthroughAll: true })
 * // => undefined — escape hatch, full passthrough restored
 */
export function resolveVerifyEnv(
  processEnv: Readonly<Record<string, string | undefined>>,
  opts: { allowlist: readonly string[]; passthroughAll: boolean },
): Record<string, string> | undefined {
  if (opts.passthroughAll) return undefined;

  const allowSet = new Set<string>([...DEFAULT_VERIFY_ENV_ALLOWLIST, ...opts.allowlist]);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(processEnv)) {
    if (value === undefined) continue;
    if (allowSet.has(key) || key.startsWith("LC_")) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * An {@link AcceptanceCriterion} narrowed to its script-mode `verify` branch — the only
 * shape `buildVerifySpawnSpec` accepts. Callers (`VerifyRunnerService`) filter a spec's
 * declared criteria down to `verify.mode === "script"` before reaching this module.
 */
export type ScriptAcceptanceCriterion = AcceptanceCriterion & {
  verify: Extract<AcceptanceCriterion["verify"], { mode: "script" }>;
};

/**
 * Spawn parameters consumed directly by `verify-executor.ts`'s `executeVerifySpawnSpec`.
 * Plain data — no behavior, no Bun types leak into this pure module.
 */
export interface VerifySpawnSpec {
  /** Always `["sh", "-c", <criterion.verify.command>]`. */
  readonly cmd: readonly string[];
  /** Repo root the command runs from (caller-supplied — this module never reads cwd). */
  readonly cwd: string;
  /** Effective spawn timeout in ms (AC-level override, else config default). */
  readonly timeoutMs: number;
  /** Grace period between SIGTERM and SIGKILL escalation — always 5000 (SPEC-039 §2 D6). */
  readonly killGraceMs: number;
  /**
   * Resolved env map for the spawned process (SPEC-039 §M2). OPTIONAL — absent means
   * "inherit the full parent env" (see this module's header invariant on `env`).
   * Produced by {@link resolveVerifyEnv}; `verify-executor.ts` passes this verbatim
   * to `Bun.spawn({ env })` when present, and omits the `env` option entirely when absent.
   */
  readonly env?: Record<string, string>;
}

/**
 * Build the spawn spec for one script-mode acceptance criterion.
 *
 * @param criterion - A script-mode acceptance criterion (verify.mode === "script")
 * @param opts.repoRoot - Absolute path the command should run from
 * @param opts.defaultTimeoutMs - Fallback timeout when the criterion omits `verify.timeout_ms`
 *   (typically `resolveVerifyDefaultTimeoutMs(config)` from `@lore/core`)
 * @param opts.env - Pre-resolved env map (typically the ONE {@link resolveVerifyEnv} call a
 *   `verifyPlan` run makes, reused across every AC — see `VerifyRunnerService`). `undefined`
 *   (omitted) means "inherit the full parent env" — see this module's header invariant.
 * @returns {@link VerifySpawnSpec} ready to hand to `executeVerifySpawnSpec`
 *
 * @example
 * buildVerifySpawnSpec(
 *   { id: "AC-VRF-3", statement: "...", verify: { mode: "script", oracle: "test", command: "bun test" } },
 *   { repoRoot: "/repo", defaultTimeoutMs: 300000, env: { PATH: "/bin" } },
 * );
 * // → { cmd: ["sh", "-c", "bun test"], cwd: "/repo", timeoutMs: 300000, killGraceMs: 5000, env: { PATH: "/bin" } }
 *
 * @example
 * // per-AC timeout_ms override wins over the config default
 * buildVerifySpawnSpec(
 *   { id: "AC-VRF-5", statement: "...", verify: { mode: "script", oracle: "test", command: "bun test", timeout_ms: 60000 } },
 *   { repoRoot: "/repo", defaultTimeoutMs: 300000 },
 * );
 * // → timeoutMs: 60000, env omitted (undefined) — full passthrough
 */
export function buildVerifySpawnSpec(
  criterion: ScriptAcceptanceCriterion,
  opts: { repoRoot: string; defaultTimeoutMs: number; env?: Record<string, string> },
): VerifySpawnSpec {
  return {
    cmd: ["sh", "-c", criterion.verify.command],
    cwd: opts.repoRoot,
    timeoutMs: criterion.verify.timeout_ms ?? opts.defaultTimeoutMs,
    killGraceMs: KILL_GRACE_MS,
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  };
}

/**
 * Result of running one {@link VerifySpawnSpec} to completion (or forced termination).
 * Pure data shape — the actual `Bun.spawn` execution that produces this lives in the
 * bun-only `verify-executor.ts`, which imports this type from here rather than the
 * reverse (see module header).
 */
export interface VerifyExecutionResult {
  /** Process exit code once `proc.exited` resolves. Bun types this Promise as always
   *  a number (never null) — a killed process still reports a signal-derived code
   *  (e.g. 143 for SIGTERM, 137 for SIGKILL), not null. */
  readonly exitCode: number;
  /** stdout + stderr concatenated, tail-truncated to 4000 chars. */
  readonly outputTail: string;
  /** Wall-clock duration from spawn to exit, in whole milliseconds. */
  readonly durationMs: number;
  /** True iff the watchdog fired (SIGTERM and/or SIGKILL sent) before natural exit. */
  readonly timedOut: boolean;
}

/**
 * Pure exit-code → pass/fail mapping (SPEC-039 §2 D8 uses the WORD "attested", the
 * derivation itself lives here per §3's semantics table).
 *
 * @param exitCode - The spawned process's exit code, or `null` when unknown/not yet
 *   observed (defensive — real callers always have a concrete number by the time they
 *   call this, since `verify-executor.ts` only calls it after `await proc.exited`, which
 *   Bun types as `Promise<number>`, never `Promise<number | null>`)
 * @param timedOut - Whether the watchdog killed the process before natural exit
 * @returns `"pass"` iff exit code is exactly 0 AND the process did not time out;
 *   `"fail"` otherwise (nonzero exit, `null` exit, or timeout — even a coincidental 0)
 *
 * @example
 * deriveVerifyResult(0, false)   // => "pass"
 * deriveVerifyResult(1, false)   // => "fail"
 * deriveVerifyResult(0, true)    // => "fail" — timeout overrides a coincidental 0 exit
 * deriveVerifyResult(null, false) // => "fail"
 */
export function deriveVerifyResult(exitCode: number | null, timedOut: boolean): "pass" | "fail" {
  return !timedOut && exitCode === 0 ? "pass" : "fail";
}
