/**
 * The home directory of THIS invocation, read from `$HOME` at call time.
 *
 * Purpose: one place that answers "where is the user's home" for every lore code path (global config,
 * `~/.claude` setup, machine-auth state, session trail), so a caller that changes `process.env.HOME`
 * is believed.
 * Public surface: {@link currentHomeDir}.
 * Invariants: a non-empty `$HOME` wins; otherwise the OS answer (`os.homedir()`), exactly as Node's own
 *   `os.homedir()` orders them on POSIX. The result is never cached.
 * Side-effect class: pure read of `process.env` (and `os.homedir()` as the fallback).
 *
 * reason: under Bun, `os.homedir()` returns the HOME the process STARTED with and ignores a later
 * `process.env.HOME` assignment (measured 2026-10-17: `process.env.HOME="/tmp/x"; os.homedir()` is still
 * the real home; Node returns /tmp/x). The in-process test runner (packages/lore/tests/helpers/run-lore-in-process.ts,
 * adr-tg-1 option b) gives each command its own HOME, and without this a command run in-process would read
 * and write the developer's REAL home. A spawned binary is unaffected: it starts with the HOME it was given.
 */

import { homedir } from "node:os";

/** The current home directory: `$HOME` when set and non-empty, else `os.homedir()`. */
export function currentHomeDir(): string {
  const fromEnv = process.env["HOME"];
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : homedir();
}
