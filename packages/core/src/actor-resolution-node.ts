/**
 * The actor-resolution precedence chain is gone (spec-every-write-is-made-by-a-known-party-an-attested-agent-run
 * end state 1): a write's identity is one of four known parties, resolved by `resolveInvocationIdentity`
 * (run-identity-node.ts), never by `--by`, a session-id name, a working-copy name or the computer user name.
 *
 * What remains is the {@link ActorSource} type alone, kept ONLY because the claim-time same-name guard
 * (`gate-predicates.ts::actorIdentityGuard`) and `ReporterActorSource` still name its members; the task that
 * retires that guard deletes this file with it.
 *
 * Public surface: {@link ActorSource}.
 * Side-effect class: pure (a type declaration).
 */

/** Resolution tier labels the retired same-name guard compared against; nothing produces them any more. */
export type ActorSource = "explicit" | "env" | "session" | "os-fallback";
