/**
 * Test identity through the session tier — the only way a test can name a writer now that no write
 * command takes `--by` and no environment variable names one (BR-1055, AC-ROI-1).
 *
 * Purpose: map a human-readable fixture label (`"alice"`, `"agent:t1"`) to a stable Claude Code session
 * id, so a spawned `lore` process resolves to `agent:session-<id8>` and two labels resolve to two distinct
 * writers. The mapping is deterministic, so the same label names the same writer across spawns and an
 * assertion can compute the expected audit/claim name with {@link sessionActorFor}.
 *
 * Public surface: {@link sessionIdFor}, {@link sessionActorFor}, {@link withSessionIdentity}.
 *
 * Invariants:
 *   - `sessionActorFor(label)` is exactly what `resolveActor()` returns for `CLAUDE_CODE_SESSION_ID =
 *     sessionIdFor(label)` (`agent:session-` + the first 8 characters of the id).
 *   - {@link withSessionIdentity} removes every other ambient identity source so the ambient session of the
 *     person running the suite can never decide a verdict.
 *
 * Side-effect class: pure.
 */

import { createHash } from "node:crypto";

/** Ambient variables that could name the writer; a test fixture strips them all. */
const AMBIENT_IDENTITY_VARS = ["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"] as const;

/** The 8 hex characters that become the `<id8>` of the resolved name for `label`. */
function idEightFor(label: string): string {
  return createHash("sha1").update(label).digest("hex").slice(0, 8);
}

/** A well-formed session id whose first 8 characters are derived from `label`. */
export function sessionIdFor(label: string): string {
  return `${idEightFor(label)}-aaaa-4bbb-8ccc-000000000000`;
}

/** The writer name the session tier resolves to for `label`. */
export function sessionActorFor(label: string): string {
  return `agent:session-${idEightFor(label)}`;
}

/**
 * `env` with every ambient identity source removed and the session tier set to `label`'s session
 * (`label === null` leaves the writer unnamed, i.e. the OS-user fallback).
 */
export function withSessionIdentity(
  env: Record<string, string | undefined>,
  label: string | null,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  for (const name of AMBIENT_IDENTITY_VARS) delete out[name];
  if (label !== null) out["CLAUDE_CODE_SESSION_ID"] = sessionIdFor(label);
  return out;
}

/**
 * Runs `body` with THIS process's session tier set to `label`'s session, then restores the previous value.
 *
 * Purpose: an in-process MCP call resolves its writer name from the server process's own environment (the
 * call carries no name argument), so a test that needs two distinct callers switches the session between calls.
 * Calls are awaited one at a time, so a single shared variable is safe within one test file.
 */
export async function asSessionActor<T>(label: string, body: () => Promise<T>): Promise<T> {
  const previous = { id: process.env["CLAUDE_CODE_SESSION_ID"], legacy: process.env["CLAUDE_SESSION_ID"] };
  delete process.env["CLAUDE_SESSION_ID"];
  process.env["CLAUDE_CODE_SESSION_ID"] = sessionIdFor(label);
  try {
    return await body();
  } finally {
    if (previous.id === undefined) delete process.env["CLAUDE_CODE_SESSION_ID"];
    else process.env["CLAUDE_CODE_SESSION_ID"] = previous.id;
    if (previous.legacy === undefined) delete process.env["CLAUDE_SESSION_ID"];
    else process.env["CLAUDE_SESSION_ID"] = previous.legacy;
  }
}
