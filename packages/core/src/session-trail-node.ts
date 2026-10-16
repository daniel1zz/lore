/**
 * session-trail-node.ts — Node-only half of the session trail: state-base resolution and the
 * filesystem reader.
 *
 * Public surface: `stateBase(env?, home?)`, `readSessionTrail(sessionId, base?)`.
 *
 * Invariants:
 *   - `stateBase` is the twin of `getStateBase` in `assets/hooks/lib/turn-state.mjs`
 *     (`CLAUDE_STATE_BASE_OVERRIDE || ~/.claude/session-state`); the parity test in
 *     `session-trail-runs.test.ts` pins both for override and default.
 *   - Reached only via `@lore/core/node` (`node.ts`), never the default barrel (imports fs/path/os).
 *   - Read-only: this module never writes the trail (hooks are the only writers, spec D3).
 *   - An absent session directory reads `null` — "no trail here", distinct from an empty trail.
 *
 * Side-effect class: IO (reads disk).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  assertTrailSessionId,
  buildSessionTrail,
  type RawHelper,
  type RawTurn,
  type SessionTrail,
} from "./session-trail.js";

/**
 * Resolve the state base.
 * @param env - environment to read `CLAUDE_STATE_BASE_OVERRIDE` from (default `process.env`).
 * @param home - home directory for the default (default `os.homedir()`).
 */
export function stateBase(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  return env.CLAUDE_STATE_BASE_OVERRIDE || join(home, ".claude", "session-state");
}

function readTextOrNull(file: string): string | null {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function isDirectory(path: string): boolean {
  return statSync(path).isDirectory();
}

/** Same turn-dir discovery as the hook lib: every subdirectory except `helpers`. */
function readRawTurns(sessionDir: string): RawTurn[] {
  return readdirSync(sessionDir)
    .filter((name) => name !== "helpers" && isDirectory(join(sessionDir, name)))
    .map((turn) => {
      const dir = join(sessionDir, turn);
      const snapshot = join(dir, "turn-start-snapshot.json");
      return {
        turn,
        opened_at_ms: existsSync(snapshot) ? statSync(snapshot).mtimeMs : null,
        edited_files_jsonl: readTextOrNull(join(dir, "edited-files.jsonl")),
        changes_json: readTextOrNull(join(dir, "changes.json")),
      };
    });
}

function readRawHelpers(sessionDir: string): RawHelper[] {
  const dir = join(sessionDir, "helpers");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".judged.json"))
    .map((name) => {
      const agent_id = name.slice(0, -".json".length);
      return {
        agent_id,
        record_json: readFileSync(join(dir, name), "utf8"),
        judged_json: readTextOrNull(join(dir, `${agent_id}.judged.json`)),
      };
    });
}

/**
 * Read one session's trail from disk.
 * @param sessionId - the session id (from `sessionOfRun(run)`).
 * @param base - state base; default `stateBase()`.
 * @returns the trail, or `null` when `<base>/sessions/<sessionId>` does not exist.
 * @throws {TrailSessionIdInvalidError} unusable session id.
 * @throws {TrailFileInvalidError} malformed session.json, removed.json or helper record.
 */
export function readSessionTrail(sessionId: string, base: string = stateBase()): SessionTrail | null {
  assertTrailSessionId(sessionId);
  const sessionDir = join(base, "sessions", sessionId);
  if (!existsSync(sessionDir) || !isDirectory(sessionDir)) return null;
  return buildSessionTrail({
    session: sessionId,
    session_json: readTextOrNull(join(sessionDir, "session.json")),
    removed_json: readTextOrNull(join(sessionDir, "removed.json")),
    turns: readRawTurns(sessionDir),
    helpers: readRawHelpers(sessionDir),
  });
}
