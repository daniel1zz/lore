/**
 * How a CLI command ends a run: it RETURNS an exit code, or throws {@link CliExit} to stop at once
 * (spec-process-state-end-state-one-invocation-per-entry-returned Goal 2 / D2, rule AS-26).
 *
 * Purpose: the one vocabulary for "this run ends with code N" that holds no run state: nothing here is a process
 * global, a per-run store or a scope. `runCli` (run-cli.ts) turns a thrown `CliExit` or a command's returned code
 * into the number it returns; `src/index.ts` is the only place that calls `process.exit(code)`.
 * Public surface: `CliExit`, `exitCli`, `ExitReport`.
 * Invariants:
 *   - `exitCli` THROWS `CliExit` (type `never`): the control flow of `process.exit` for the code after it, without
 *     leaving the run. A `catch` that swallows it swallows the exit: catch narrowly, or rethrow `CliExit`.
 *   - A command that does not throw reports its code by RETURNING it (`ExitReport`: a number, or `undefined` for 0);
 *     there is no "record a code and keep going" call, so no code lives anywhere but in a return value.
 * Side-effect class: pure (a type, an error class and a throwing function).
 */

/** Thrown by {@link exitCli}; carries the code the run ends with. */
export class CliExit extends Error {
  constructor(readonly code: number) {
    super(`lore exited with code ${String(code)}`);
    this.name = "CliExit";
  }
}

/** What a command (or a helper that finishes a command) returns: its exit code, or `undefined` for success (0). */
export type ExitReport = number | undefined;

/**
 * End the run now with `code`; the code after the call never runs.
 *
 * @param code - the process exit code the run reports
 * @throws {CliExit} always; `runCli` turns it into the returned code
 */
export function exitCli(code: number): never {
  throw new CliExit(code);
}
