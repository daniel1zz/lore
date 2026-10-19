/**
 * Actor-resolution precedence chain (SPEC-069 F1 session tier; relocated here
 * verbatim by SPEC-079 G2 for service-layer reuse) — the SAME first-non-empty-
 * wins order every corpus write surface uses to attribute an actor identity:
 * explicit `--by`/`opts.by` > session tier
 * (`CLAUDE_CODE_SESSION_ID`/`CLAUDE_SESSION_ID`) > OS username. The environment
 * never supplies a name (BR-1055); the CLI adapter inserts a worktree-derived
 * tier between session and OS username.
 *
 * Lives under the Node-only `@lore/core/node` subpath (NOT the default
 * browser-safe barrel) because its OS-fallback tier calls `os.userInfo()` —
 * a Node builtin — mirroring the `config-node.ts`/`telemetry-node.ts`/
 * `slugify-node.ts` split (packages/core/src/CLAUDE.md "Browser safety"
 * invariant): a top-level Node-builtin import anywhere in the default
 * barrel's transitive closure blanks the dashboard SPA at module-load time.
 *
 * Originally implemented CLI-adapter-local
 * (packages/lore/src/adapters/cli/utils.ts, SPEC-069/SPEC-071); moved here
 * verbatim (SPEC-079 G2, "actor fidelity") so `CorpusService`
 * (packages/lore/src/service/corpus-service.ts) can apply the IDENTICAL
 * fallback chain when a caller omits `opts.by`, without a service reaching
 * backwards into an adapter module — services depend on `@lore/core` only,
 * never on `adapters/cli` (service/CLAUDE.md "no cross-service calls" +
 * the layered Architecture stack in the root CLAUDE.md: adapters depend on
 * services, never the reverse). `adapters/cli/utils.ts` now re-exports this
 * module's symbols verbatim so every pre-existing CLI import path (`from
 * "../../../src/adapters/cli/utils.js"`) keeps resolving unchanged — this is
 * a pure relocation, not a behavior change for the CLI surface.
 *
 * Public surface:
 *   - ActorSource — which precedence tier won
 *     ("explicit" | "session" | "os-fallback"; "env" is kept in the
 *     type for dependents but is never produced)
 *   - ResolvedActor — {actor, source}
 *   - resolveActorWithSource(explicit, env, osUsername) — the pure resolution function
 *
 * Invariants:
 *   - Throws only {@link OsUserLookupError} (OS tier selected, lookup failed). A session id that sanitizes to the empty string
 *     (`sessionActorFromId`'s fail-loud contract) degrades to the
 *     OS-fallback tier here rather than propagating the throw.
 *   - `actor` is never the empty string.
 *   - No side-effecting advisory (e.g. a stderr warning on OS-fallback) —
 *     that is the CLI-only `resolveActor` wrapper's job
 *     (adapters/cli/utils.ts), which stays there since it is a CLI-specific
 *     UX concern (once-per-process stderr write), not a resolution rule.
 *
 * Side-effect class: pure given its arguments (`env` and the OS-user value are
 *   caller-supplied; the module reads no ambient state, AS-26).
 *
 * Source: SPEC-069 §F1, SPEC-071 §Design Decisions, SPEC-079 §Design
 *   Decisions D2.
 */

import type { OsUser } from "./invocation.js";
import type { LoreError } from "./errors.js";
import { sessionActorFromId } from "./session-actor.js";

/**
 * Which resolution tier produced the actor identity {@link resolveActorWithSource}
 * returned — `"explicit"` (`--by`/`opts.by`), `"session"` (`$CLAUDE_CODE_SESSION_ID`/`$CLAUDE_SESSION_ID`), or
 * `"os-fallback"` (the OS username, the untraceable default).
 */
// reason: "env" is never produced (BR-1055, spec-run-only-write-identity-and-run-end-claim-release);
// the member stays only because run-identity-node.ts and issue-front-matter.ts
// (outside this task's anchors) still reference it.
export type ActorSource = "explicit" | "env" | "session" | "os-fallback";

/** {@link ActorSource} plus the working-copy tier, produced only by {@link resolveActorWithWorktree}. */
export type WorktreeAwareActorSource = ActorSource | "worktree-derived";

/** Result of {@link resolveActorWithWorktree}. */
export interface WorktreeAwareActor {
  readonly actor: string;
  readonly source: WorktreeAwareActorSource;
}

/**
 * The OS-username tier was the one selected and the entry's user lookup had failed. Carries the {@link LoreError}
 * (VALIDATION_ERROR, exit 4 on the CLI) naming the lookup's reason.
 */
export class OsUserLookupError extends Error {
  readonly loreError: Extract<LoreError, { code: "VALIDATION_ERROR" }>;

  constructor(reason: string) {
    super(`OS user lookup failed: ${reason}`);
    this.name = "OsUserLookupError";
    this.loreError = { code: "VALIDATION_ERROR", field: "user", message: this.message };
  }
}

/** Result of {@link resolveActorWithSource} — the resolved identity plus which tier won. */
export interface ResolvedActor {
  readonly actor: string;
  readonly source: ActorSource;
}

/**
 * Pure actor-resolution core shared by every corpus write surface. First non-empty tier wins:
 * explicit > session tier > OS username. No IO of its own; never writes to stderr.
 *
 * @param explicit - Explicit actor value (CLI `--by` / service `opts.by`), if supplied
 * @param env - Environment map to resolve session-id vars from (`Invocation.env`).
 *   Tests pass a literal object here instead of mutating `process.env`.
 * @param osUser - The entry's recorded OS-username lookup (`Invocation.user`). Only when the OS tier is selected
 *   and this is a failure does resolution throw; every other tier ignores it.
 * @returns `{actor, source}` — `actor` is never empty
 * @throws {OsUserLookupError} when the OS tier is selected and `osUser` is a failure
 * @example
 *   resolveActorWithSource("alice", {}, { ok: true, name: "bob" })  // => {actor: "alice", source: "explicit"}
 * @example
 *   resolveActorWithSource(undefined, { CLAUDE_CODE_SESSION_ID: "3de02220-..." }, { ok: true, name: "bob" })
 *   // => {actor: "agent:session-3de02220", source: "session"}
 * @example
 *   resolveActorWithSource(undefined, {}, { ok: true, name: "bob" }) // => {actor: "bob", source: "os-fallback"}
 */
export function resolveActorWithSource(
  explicit: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  osUser: OsUser,
): ResolvedActor {
  if (explicit !== undefined && explicit.trim() !== "") {
    return { actor: explicit, source: "explicit" };
  }
  const session = sessionActorOf(env);
  if (session !== undefined) return { actor: session, source: "session" };
  return resolveOsTier(osUser);
}

/**
 * {@link resolveActorWithSource} with the working-copy tier between session and OS username
 * (explicit > session > worktree > OS). The OS lookup failure matters only when the working-copy probe also names
 * nobody.
 *
 * @param worktreeActor - Working-copy probe `() => "agent:<branch>" | undefined`, closed over the invocation cwd
 * @throws {OsUserLookupError} when no higher tier names the writer and `osUser` is a failure
 */
export function resolveActorWithWorktree(
  explicit: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  osUser: OsUser,
  worktreeActor: () => string | undefined,
): WorktreeAwareActor {
  const outcome = resolveActorOrUnresolved(explicit, env, osUser, worktreeActor);
  if (outcome.source === "unresolved") throw new OsUserLookupError(outcome.reason);
  return outcome;
}

/** No tier named the writer and the OS user lookup failed: the value form of {@link OsUserLookupError}. */
export interface UnresolvedActor {
  readonly source: "unresolved";
  readonly reason: string;
}

/**
 * The same chain as {@link resolveActorWithWorktree}, but a failed OS user lookup is RETURNED, not thrown: the entry
 * records it in the Invocation's identity so reads proceed, and the write that needs an actor fails loud.
 *
 * @returns the winning tier, or `{ source: "unresolved", reason }` when only the failed OS tier was left
 */
export function resolveActorOrUnresolved(
  explicit: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  osUser: OsUser,
  worktreeActor: () => string | undefined,
): WorktreeAwareActor | UnresolvedActor {
  if (explicit !== undefined && explicit.trim() !== "") {
    return { actor: explicit, source: "explicit" };
  }
  const session = sessionActorOf(env);
  if (session !== undefined) return { actor: session, source: "session" };
  const derived = worktreeActor();
  if (derived !== undefined && derived !== "") return { actor: derived, source: "worktree-derived" };
  if (!osUser.ok) return { source: "unresolved", reason: osUser.reason };
  return { actor: osUser.name, source: "os-fallback" };
}

/** The session-tier actor of `env`, or `undefined` when no session id names one. */
function sessionActorOf(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const sessionId = env["CLAUDE_CODE_SESSION_ID"] ?? env["CLAUDE_SESSION_ID"];
  if (sessionId === undefined || sessionId.trim() === "") return undefined;
  // reason: `sessionActorFromId` is deliberately fail-loud (SPEC-069 D3) on a
  // sessionId that sanitizes to the empty string (e.g. "---", "!!!" — all
  // non-whitespace but zero [a-z0-9-] characters), so it throws rather than
  // returning a collision-prone bare prefix. This tier degrades gracefully
  // (the caller falls to the next tier) instead of propagating the throw.
  try {
    return sessionActorFromId(sessionId);
  } catch {
    return undefined;
  }
}

/** The OS-username tier: the recorded name, or a loud failure naming why the lookup failed. */
function resolveOsTier(osUser: OsUser): ResolvedActor {
  if (!osUser.ok) throw new OsUserLookupError(osUser.reason);
  return { actor: osUser.name, source: "os-fallback" };
}
