/**
 * Module: ac-command-parse-check — asks the shell `lore verify` runs a script criterion under whether the
 * command PARSES, without running it (task TG-45).
 *
 * Public surface: {@link shellParseError}, {@link VERIFY_SHELL}, {@link ShellParseCheckUnavailableError}.
 * Invariants:
 *   - The shell is `sh` — the same one `verify-spawn.ts::buildVerifySpawnSpec` hands `Bun.spawn` (`["sh","-c",command]`);
 *     parse-only mode is `sh -n -c <command>` (POSIX `-n`: read, never execute), so nothing the command names runs.
 *   - Parse is not run: a parseable command whose check would fail returns `null`.
 *   - A shell that cannot be spawned throws `ShellParseCheckUnavailableError`, never read as "parses".
 * Side-effect class: IO (one short-lived `sh` subprocess per call). It lives in `service/`, beside the other
 *   `node:child_process` users, and is NOT exported from `@lore/core`'s barrel (core stays free of Node builtins).
 *
 * Source: task-skill-fix-tg-45-a-script-criterion-whose-command-the-shell; AC-AU-8 corrected 2026-10-18.
 */

import { spawnSync } from "node:child_process";

/** The shell `verify-spawn.ts` runs every script criterion under. */
export const VERIFY_SHELL = "sh" as const;

/** Parse-only timeout; `sh -n` on one command line takes milliseconds. */
const PARSE_TIMEOUT_MS = 10_000;
// reason: `sh -n -c` parses text; it never reads the directory it runs in. A fixed root keeps the child independent of
// the calling process's working directory (nothing below an entry reads the cwd, AS-26).
const PARSE_CWD = "/";

/** Thrown when the verify shell cannot be started, so no parse verdict exists. */
export class ShellParseCheckUnavailableError extends Error {
  constructor(
    readonly shell: string,
    readonly reason: string,
  ) {
    super(`cannot check the command's syntax: \`${shell} -n -c\` did not run (${reason})`);
    this.name = "ShellParseCheckUnavailableError";
  }
}

/**
 * The shell's parser message when `command` does not parse, else `null`. Never executes the command.
 *
 * @example
 * shellParseError("echo 'it's'"); // the shell's own "unexpected EOF while looking for matching" text
 * shellParseError(`echo "it's"`); // null
 * @throws ShellParseCheckUnavailableError when the shell cannot be spawned or times out.
 */
export function shellParseError(command: string): string | null {
  const run = spawnSync(VERIFY_SHELL, ["-n", "-c", command], { cwd: PARSE_CWD, encoding: "utf8", timeout: PARSE_TIMEOUT_MS });
  if (run.error !== undefined) throw new ShellParseCheckUnavailableError(VERIFY_SHELL, run.error.message);
  if (run.status === 0) return null;
  const message = (run.stderr ?? "").trim();
  return message.length > 0 ? message : `${VERIFY_SHELL} -n exited ${String(run.status)}`;
}
