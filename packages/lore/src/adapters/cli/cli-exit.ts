/**
 * How a CLI command ends a run: it RETURNS an exit code, or throws {@link CliExit} to stop at once
 * (spec-process-state-end-state-one-invocation-per-entry-returned Goal 2 / D2, rule AS-26).
 *
 * Purpose: the one vocabulary for "this run ends with code N" that holds no run state: nothing here is a process
 * global, a per-run store or a scope. `runCli` (run-cli.ts) turns a thrown `CliExit` or a command's returned code
 * into the number it returns; `src/index.ts` is the only place that calls `process.exit(code)`.
 * Public surface: `CliExit`, `exitCli`, `ExitReport`, `defineLoreCommand`, `LoreCommandDef`.
 * Invariants:
 *   - `exitCli` THROWS `CliExit` (type `never`): the control flow of `process.exit` for the code after it, without
 *     leaving the run. A `catch` that swallows it swallows the exit: catch narrowly, or rethrow `CliExit`.
 *   - A command that does not throw reports its code by RETURNING it (`ExitReport`: a number, 0 for success written
 *     explicitly); there is no "record a code and keep going" call, so no code lives anywhere but in a return value.
 *   - `undefined` is not an `ExitReport`, and every command's `run` is typed by `defineLoreCommand` to return
 *     `number | Promise<number>`: a handler or helper that falls off the end, or calls a code-returning helper
 *     without returning it, is a tsc error, never a silent 0. The type is the mechanism; nothing audits it.
 * Side-effect class: pure (a type, an error class and a throwing function).
 */

import type { ArgsDef, CommandContext, CommandDef } from "citty";

/** Thrown by {@link exitCli}; carries the code the run ends with. */
export class CliExit extends Error {
  constructor(readonly code: number) {
    super(`lore exited with code ${String(code)}`);
    this.name = "CliExit";
  }
}

/** What a command (or a helper that finishes a command) returns: its exit code (0 for success). Never `undefined`. */
export type ExitReport = number;

/** A citty command whose `run` must return its exit code: the handler's return type is a required `number`. */
export type LoreCommandDef<T extends ArgsDef = ArgsDef> = Omit<CommandDef<T>, "run"> & {
  run?: (context: CommandContext<T>) => ExitReport | Promise<ExitReport>;
};

/**
 * Declare a lore command. Same as citty's `defineCommand` (an identity function), except `run` must return its exit
 * code, so a code dropped on any path fails to compile.
 *
 * @param def - the command definition; `run` returns `0` for success, the failure code otherwise
 * @returns `def`, typed as citty's `CommandDef`
 */
export function defineLoreCommand<T extends ArgsDef = ArgsDef>(def: LoreCommandDef<T>): CommandDef<T> {
  return def;
}

/**
 * End the run now with `code`; the code after the call never runs.
 *
 * @param code - the process exit code the run reports
 * @throws {CliExit} always; `runCli` turns it into the returned code
 */
export function exitCli(code: number): never {
  throw new CliExit(code);
}
