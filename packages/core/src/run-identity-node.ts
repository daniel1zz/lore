/**
 * Per-invocation identity resolution (spec run-identity-slice-1 D1, D8, D11; BR-1032, BR-1033).
 *
 * Purpose: turn one CLI invocation's argv + env into an {@link InvocationIdentity}
 * (which run vouched for it, and what name the writer claimed with its source),
 * and hand back argv with the harness-owned `--harness-run <id>` removed.
 *
 * Public surface: {@link resolveInvocationIdentity}, {@link RunIdentityArgumentError},
 * {@link InvocationResolution}.
 *
 * @invariant `harnessRun` comes ONLY from the `--harness-run` flag; `--by` and
 *   `$LORE_ACTOR` never produce attestation (names are not attestation, BR-1033).
 * @invariant `claimed` is never null/empty: tiers are --by > $LORE_ACTOR >
 *   session > working copy > OS user (D11), the first four reusing
 *   {@link resolveActorWithSource}.
 * @invariant The `$LORE_ACTOR` deprecation line is written at most once per
 *   process (module-level latch `loreActorDeprecationWarned`); the sink is injected.
 *
 * Side-effect class: stateful (module latch) + IO (`os.userInfo()` via the
 * shared tier chain; default warn sink writes stderr). Lives under
 * `@lore/core/node` for the same barrel-isolation reason as actor-resolution-node.ts.
 */

import { resolveActorWithSource } from "./actor-resolution-node.js";
import type { ActorSource } from "./actor-resolution-node.js";
import { HARNESS_RUN_FLAG } from "./run-identity.js";
import type { InvocationIdentity, NameSource, RunId } from "./run-identity.js";

const BY_FLAG = "--by";

/** An invocation's `--by` / `--harness-run` flag was malformed (missing or empty value). */
export class RunIdentityArgumentError extends Error {
  readonly flag: string;
  readonly reason: string;

  constructor(flag: string, reason: string) {
    super(`${flag}: ${reason}`);
    this.name = "RunIdentityArgumentError";
    this.flag = flag;
    this.reason = reason;
  }
}

/** Result of {@link resolveInvocationIdentity}. */
export interface InvocationResolution {
  readonly identity: InvocationIdentity;
  /** Input argv with `--harness-run <id>` removed; a new array, the input is never mutated. */
  readonly argv: string[];
}

/** Once-per-process latch for the `$LORE_ACTOR` deprecation line (D8); tests reset via `vi.resetModules()`. */
let loreActorDeprecationWarned = false;

const LORE_ACTOR_DEPRECATION_LINE =
  "warning: $LORE_ACTOR is deprecated as an identity source; pass --by, or let the agent integration supply --harness-run";

const NAME_SOURCE_BY_ACTOR_SOURCE: Record<Exclude<ActorSource, "os-fallback">, NameSource> = {
  explicit: "flag",
  env: "env",
  session: "session",
};

/** Value of a `--flag <v>` / `--flag=<v>` token at `index`, or null when the token is another flag. */
function readFlagAt(argv: readonly string[], index: number, flag: string): { value: string; consumed: number } | null {
  const token = argv[index];
  if (token === flag) {
    const value = argv[index + 1];
    if (value === undefined) throw new RunIdentityArgumentError(flag, "requires a value");
    return { value, consumed: 2 };
  }
  if (token !== undefined && token.startsWith(`${flag}=`)) {
    return { value: token.slice(flag.length + 1), consumed: 1 };
  }
  return null;
}

/**
 * Resolve the identity of one lore invocation.
 *
 * @param argv - Command-line tokens after the program name; not mutated.
 * @param env - Environment to read `$LORE_ACTOR` / session ids from (default `process.env`).
 * @param warn - Sink for the one-per-process `$LORE_ACTOR` deprecation line
 *   (default: one line on stderr — CLI surface).
 * @param detectWorktree - Working-copy tier probe `(cwd) => "agent:<branch>" | undefined`.
 *   `detectWorktreeDerivedActor` lives in packages/lore (adapters/cli/utils.ts), which core cannot
 *   import, so the CLI injects it; when omitted that tier is skipped.
 * @returns the identity and argv with `--harness-run <id>` removed.
 * @throws {RunIdentityArgumentError} when `--by` / `--harness-run` has no value or an empty value
 *   (an empty `--by` must not silently fall through to a lower tier).
 * @example
 *   resolveInvocationIdentity(["claim", "t", "--harness-run", "cc:S1", "--by", "x"], {}, warn)
 *   // => { identity: { harnessRun: "cc:S1", claimed: "x", claimedSource: "flag" }, argv: ["claim", "t", "--by", "x"] }
 */
export function resolveInvocationIdentity(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
  warn: (line: string) => void = (line) => {
    process.stderr.write(`${line}\n`); // CLI surface
  },
  detectWorktree?: (cwd: string) => string | undefined,
): InvocationResolution {
  const remaining: string[] = [];
  let harnessRun: string | null = null;
  let by: string | undefined;

  for (let i = 0; i < argv.length; ) {
    const runFlag = readFlagAt(argv, i, HARNESS_RUN_FLAG);
    if (runFlag !== null) {
      if (runFlag.value.trim() === "") throw new RunIdentityArgumentError(HARNESS_RUN_FLAG, "value must not be empty");
      harnessRun = runFlag.value;
      i += runFlag.consumed;
      continue;
    }
    const byFlag = readFlagAt(argv, i, BY_FLAG);
    if (byFlag !== null) {
      if (byFlag.value.trim() === "") throw new RunIdentityArgumentError(BY_FLAG, "value must not be empty");
      by = byFlag.value;
    }
    // reason: `--by` stays in the returned argv — downstream command parsing still owns it.
    remaining.push(argv[i] as string);
    i++;
  }

  const resolved = resolveActorWithSource(by, env);
  let claimed = resolved.actor;
  let claimedSource: NameSource;
  if (resolved.source === "os-fallback") {
    const worktreeActor = detectWorktree?.(process.cwd());
    if (worktreeActor !== undefined && worktreeActor !== "") {
      claimed = worktreeActor;
      claimedSource = "worktree";
    } else {
      claimedSource = "os";
    }
  } else {
    claimedSource = NAME_SOURCE_BY_ACTOR_SOURCE[resolved.source];
  }

  if (claimedSource === "env" && !loreActorDeprecationWarned) {
    loreActorDeprecationWarned = true;
    warn(LORE_ACTOR_DEPRECATION_LINE);
  }

  return {
    identity: { harnessRun: harnessRun as RunId | null, claimed, claimedSource },
    argv: remaining,
  };
}
