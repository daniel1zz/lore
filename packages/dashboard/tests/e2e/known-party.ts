/**
 * Known-party helpers for the dashboard e2e suite.
 *
 * Purpose: since the known-party rule (BR-1351) every `lore` WRITE needs a known writer: an attested agent run, or an
 * open human session for the checkout. The e2e harness drives `lore` as plain child processes against throwaway
 * corpora, so it writes as a HUMAN: it opens `lore session start --human e2e-setup` in each throwaway checkout and the
 * spawned commands run without any agent harness marker.
 *
 * Invariants:
 *   - {@link knownPartyEnv} STRIPS `CLAUDECODE` (and the other identity variables): with the agent harness marker
 *     present `lore` treats the process as an agent, and "an agent never writes under a person's session", so a
 *     human session would be refused. The spawn must look like a person's terminal.
 *   - Session files live in an ISOLATED state dir (`LORE_STATE_HOME`, published by global-setup as
 *     {@link E2E_STATE_HOME_ENV}), never the real `~/.local/state/lore`; the dir is removed in teardown.
 *
 * Side-effect class: IO (spawns `lore session start|end`).
 */

import { execFileSync } from "node:child_process";

/** Env var global-setup publishes: the isolated lore state dir every e2e `lore` child uses. */
export const E2E_STATE_HOME_ENV = "LORE_E2E_STATE_HOME";

/** The person every e2e write is attributed to. */
export const E2E_HUMAN_NAME = "e2e-setup";

/** Variables that carry an identity or mark an agent harness (same set as the lore test helpers' scrub list). */
const IDENTITY_ENV_VARS = ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "LORE_ACTOR"] as const;

/**
 * Env for a `lore` child that writes as the e2e human: `base` minus every agent-harness / identity marker, pointed at
 * the isolated state dir, plus `extra` (applied last, so a caller may still set e.g. `LORE_ACTOR` deliberately).
 *
 * @throws when `stateHome` is empty: a write without the isolated state dir would touch the real one
 */
export function knownPartyEnv(
  stateHome: string,
  extra: Readonly<Record<string, string>> = {},
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (stateHome === "") throw new Error("knownPartyEnv: stateHome is empty; refusing to use the real lore state dir");
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of IDENTITY_ENV_VARS) delete env[name];
  return { ...env, LORE_STATE_HOME: stateHome, ...extra };
}

/** The isolated state dir global-setup published; fails loud when it did not run. */
export function e2eStateHome(): string {
  const dir = process.env[E2E_STATE_HOME_ENV];
  if (dir === undefined || dir === "") {
    throw new Error(`${E2E_STATE_HOME_ENV} is not set: expected global-setup.ts to publish it`);
  }
  return dir;
}

/** Open the e2e human session for the checkout at `cwd` (`lore` = executable + leading args, e.g. `["bun", entry]`). */
export function startHumanSession(lore: readonly [string, ...string[]], cwd: string, stateHome: string): void {
  const [bin, ...lead] = lore;
  execFileSync(bin, [...lead, "session", "start", "--human", E2E_HUMAN_NAME], {
    cwd,
    env: knownPartyEnv(stateHome),
    stdio: "pipe",
  });
}

/** Close the e2e human session for the checkout at `cwd`. */
export function endHumanSession(lore: readonly [string, ...string[]], cwd: string, stateHome: string): void {
  const [bin, ...lead] = lore;
  execFileSync(bin, [...lead, "session", "end"], { cwd, env: knownPartyEnv(stateHome), stdio: "pipe" });
}
