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
 *   - Never throws. A session id that sanitizes to the empty string
 *     (`sessionActorFromId`'s fail-loud contract) degrades to the
 *     OS-fallback tier here rather than propagating the throw.
 *   - `actor` is never the empty string — OS username is always available.
 *   - No side-effecting advisory (e.g. a stderr warning on OS-fallback) —
 *     that is the CLI-only `resolveActor` wrapper's job
 *     (adapters/cli/utils.ts), which stays there since it is a CLI-specific
 *     UX concern (once-per-process stderr write), not a resolution rule.
 *
 * Side-effect class: pure given its arguments (`env` and the OS-username thunk are
 *   caller-supplied; the module reads no ambient state, AS-26).
 *
 * Source: SPEC-069 §F1, SPEC-071 §Design Decisions, SPEC-079 §Design
 *   Decisions D2.
 */

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

/** Result of {@link resolveActorWithSource} — the resolved identity plus which tier won. */
export interface ResolvedActor {
  readonly actor: string;
  readonly source: ActorSource;
}

/**
 * Pure actor-resolution core shared by every corpus write surface (the CLI's
 * `resolveActor` wrapper, and — since SPEC-079 — `CorpusService`'s own
 * `opts.by` fallback). First non-empty tier wins: explicit > session tier >
 * OS username. No IO of its own (the OS username arrives as a thunk); never writes to
 * stderr (side-effecting advisories are the CALLER's job).
 *
 * @param explicit - Explicit actor value (CLI `--by` / service `opts.by`), if supplied
 * @param env - Environment map to resolve session-id vars from (`Invocation.env`).
 *   Tests pass a literal object here instead of mutating `process.env`.
 * @param osUsername - Lazy OS-username source (`readOsUsername` from `invocation-node.ts` in
 *   production). A thunk, not a string: the OS lookup can throw and must stay unreached unless
 *   the os-fallback tier is actually taken.
 * @returns `{actor, source}` — `actor` is never empty (OS username is always available)
 * @example
 *   resolveActorWithSource("alice", {}, () => "bob")  // => {actor: "alice", source: "explicit"}
 * @example
 *   resolveActorWithSource(undefined, { CLAUDE_CODE_SESSION_ID: "3de02220-..." }, () => "bob")
 *   // => {actor: "agent:session-3de02220", source: "session"}
 * @example
 *   resolveActorWithSource(undefined, {}, () => "bob") // => {actor: "bob", source: "os-fallback"}
 */
export function resolveActorWithSource(
  explicit: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  osUsername: () => string,
): ResolvedActor {
  if (explicit !== undefined && explicit.trim() !== "") {
    return { actor: explicit, source: "explicit" };
  }
  const sessionId = env["CLAUDE_CODE_SESSION_ID"] ?? env["CLAUDE_SESSION_ID"];
  if (sessionId !== undefined && sessionId.trim() !== "") {
    // reason: `sessionActorFromId` is deliberately fail-loud (SPEC-069 D3) on a
    // sessionId that sanitizes to the empty string (e.g. "---", "!!!" — all
    // non-whitespace but zero [a-z0-9-] characters), so it throws rather than
    // returning a collision-prone bare prefix. This tier degrades gracefully
    // instead of propagating the throw, mirroring the whitespace-only
    // fall-through one line above.
    try {
      return { actor: sessionActorFromId(sessionId), source: "session" };
    } catch {
      return { actor: osUsername(), source: "os-fallback" };
    }
  }
  return { actor: osUsername(), source: "os-fallback" };
}
