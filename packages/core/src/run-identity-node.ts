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
 * @invariant `harnessRun` comes ONLY from the `--harness-run` flag; `--by`
 *   never produces attestation (names are not attestation, BR-1033).
 * @invariant `claimed` is never null/empty: tiers are --by > session >
 *   working copy > OS user (D11), reusing {@link resolveActorWithSource}. The
 *   environment never supplies a name (BR-1055).
 *
 * Side-effect class: pure given its arguments (env, OS-user value, worktree probe are supplied). Lives under
 * `@lore/core/node` for the same barrel-isolation reason as actor-resolution-node.ts.
 */

import { resolveActorWithWorktree } from "./actor-resolution-node.js";
import type { OsUser } from "./invocation.js";
import type { WorktreeAwareActorSource } from "./actor-resolution-node.js";
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

// reason: total over ActorSource (minus os-fallback) so a new member fails compilation; `env` stays
// mapped only because the type member remains — nothing produces it (BR-1055).
const NAME_SOURCE_BY_ACTOR_SOURCE: Record<WorktreeAwareActorSource, NameSource> = {
  explicit: "flag",
  env: "env",
  session: "session",
  "worktree-derived": "worktree",
  "os-fallback": "os",
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
 * @param env - Environment to read session ids from (`Invocation.env`).
 * @param osUser - The entry's recorded OS-username lookup for the os-fallback tier (see `resolveActorWithSource`).
 * @param detectWorktree - Working-copy tier probe `() => "agent:<branch>" | undefined`, closed over
 *   the invocation cwd by the caller. `detectWorktreeDerivedActor` lives in packages/lore
 *   (adapters/cli/utils.ts), which core cannot import, so the CLI injects it; when omitted that
 *   tier is skipped.
 * @returns the identity and argv with `--harness-run <id>` removed.
 * @throws {RunIdentityArgumentError} when `--by` / `--harness-run` has no value or an empty value
 *   (an empty `--by` must not silently fall through to a lower tier).
 * @throws {OsUserLookupError} when no higher tier names the writer and `osUser` is a failure
 * @example
 *   resolveInvocationIdentity(["claim", "t", "--harness-run", "cc:S1", "--by", "x"], {}, { ok: true, name: "os-user" })
 *   // => { identity: { harnessRun: "cc:S1", claimed: "x", claimedSource: "flag" }, argv: ["claim", "t", "--by", "x"] }
 */
export function resolveInvocationIdentity(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  osUser: OsUser,
  detectWorktree?: () => string | undefined,
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

  const resolved = resolveActorWithWorktree(by, env, osUser, detectWorktree ?? (() => undefined));

  return {
    identity: { harnessRun: harnessRun as RunId | null, claimed: resolved.actor, claimedSource: NAME_SOURCE_BY_ACTOR_SOURCE[resolved.source] },
    argv: remaining,
  };
}
