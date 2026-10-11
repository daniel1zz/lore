/**
 * run-id.mjs — claude-code run id derivation for hooks that must NAME a run
 * (run-end.mjs). Mirror of `claudeCodeAdapter.derive` in
 * `packages/core/src/run-identity.ts`: main run `cc:<session>`, subagent run
 * `cc:<session>:<agent>`, ids restricted to `[A-Za-z0-9._-]+`.
 *
 * Public surface: `deriveClaudeCodeRunId(payload)`.
 * Side-effect class: pure.
 *
 * ## Invariant: no drift from the verb (BR-1059)
 *
 * Hooks are standalone files with no access to `@lore/core`, so this is a
 * copy; `tests/unit/hooks/run-end-hook.test.ts` pins it equal to
 * `deriveRunId("claude-code", ...)` for main and subagent payloads. Changing
 * either side without the other turns that test red.
 */

const HARNESS_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * @param {{ session_id?: unknown, agent_id?: unknown }} payload - Hook payload.
 * @returns {string} `cc:<session_id>` or `cc:<session_id>:<agent_id>`.
 * @throws {Error} When an id is missing, not a string, or has characters outside `[A-Za-z0-9._-]`.
 */
export function deriveClaudeCodeRunId(payload) {
  const { session_id: sessionId, agent_id: agentId } = payload;
  if (typeof sessionId !== 'string' || !HARNESS_ID_PATTERN.test(sessionId)) {
    throw new Error(`invalid or missing session_id ${JSON.stringify(sessionId)}`);
  }
  if (agentId === undefined) return `cc:${sessionId}`;
  if (typeof agentId !== 'string' || !HARNESS_ID_PATTERN.test(agentId)) {
    throw new Error(`invalid agent_id ${JSON.stringify(agentId)}`);
  }
  return `cc:${sessionId}:${agentId}`;
}
