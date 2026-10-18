/**
 * Where a CLI run's text goes: the writers of its `Invocation` (`inv.io`), passed explicitly, never found through a
 * process stream or a console patch (spec-process-state-end-state-one-invocation-per-entry-returned D2/D4, rule AS-26).
 *
 * Purpose: one place that says how a command prints a line to a writer it was handed.
 * Public surface: `CliIo` (the two writers of one run), `printLine` (a `console.log`-shaped line to one writer).
 * Invariants:
 *   - `printLine` formats exactly like `console.log` (`node:util` `format`, the same routine Node's console uses) and
 *     ends the text with one `\n`, so replacing `console.log(...)` by `printLine(inv.io.stdout, ...)` changes no byte.
 *   - Nothing here reads or assigns a process global; the writer decides where the bytes go (the real process streams
 *     for the binary, a capture buffer for the in-process test runner).
 * Side-effect class: IO on the writer it is given, nothing else.
 */

import { format } from "node:util";
import type { Invocation, InvocationWriter } from "@lore/core";

/** The stdout and stderr writers of one run: `Invocation["io"]`. */
export type CliIo = Invocation["io"];

/**
 * Write one line to `writer`, formatted like `console.log(...args)`.
 *
 * @param writer - `inv.io.stdout` or `inv.io.stderr` of the run (or a capture writer)
 * @param args - the values `console.log` would print
 * @example
 *   printLine(inv.io.stdout, "Released", slug); // "Released <slug>\n"
 */
export function printLine(writer: InvocationWriter, ...args: unknown[]): void {
  writer.write(`${format(...args)}\n`);
}
