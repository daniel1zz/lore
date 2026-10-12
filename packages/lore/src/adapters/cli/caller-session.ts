/**
 * The CALLER's harness session id for the worktree-removal test (spec-one-worktree-removal-test-for-the-guard-lore-done-and-a D2).
 *
 * Public surface: {@link resolveCallerSession}.
 *
 * @invariant Side-effect class: pure over the injected env map. Returns the RAW id (the value a run's `session_ref`
 *   holds, so `cc:<session>` ids line up) — never the sanitized claim discriminator `resolveClaimSessionId` produces.
 * @invariant Absent/blank -> `undefined` ("unknown caller"): an unknown session is never the owner of anything.
 */

/** Env vars carrying the current agent session id, in precedence order (same list the claim path reads). */
const SESSION_ID_ENV_VARS = ["CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"] as const;

/**
 * @param explicit - `--session <id>` when given; wins over the environment
 * @param env - environment map (`process.env` in production)
 * @example resolveCallerSession(undefined, { CLAUDE_CODE_SESSION_ID: "abc" }) // "abc"
 */
export function resolveCallerSession(explicit: string | undefined, env: Record<string, string | undefined>): string | undefined {
  if (explicit !== undefined && explicit.trim() !== "") return explicit.trim();
  for (const name of SESSION_ID_ENV_VARS) {
    const value = env[name];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return undefined;
}
