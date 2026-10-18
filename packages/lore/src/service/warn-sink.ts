/**
 * Where a service or adapter writes an advisory line it must not turn into a failure.
 *
 * Purpose: replaces a direct `process.stderr.write` below the entry (spec-process-state-end-state-one-invocation-per-
 * entry-returned D2/D4, rule AS-26): the composition root hands each component the writer of the run it belongs to
 * (`inv.io.stderr`), so two runs in one process never share an output stream.
 * Public surface: `WarnSink`, `warnSinkOf`, `discardWarnings`.
 * Invariants:
 *   - A sink receives one line WITHOUT its trailing newline; the sink adds the line ending.
 *   - A component built without a sink (a bare test construction) uses {@link discardWarnings}: its advisories are not
 *     printed anywhere. Production composition (`app.ts`, the HTTP and MCP entries) always supplies one.
 * Side-effect class: pure types plus a writer wrapper (IO only on the writer it is given).
 */

import type { InvocationWriter } from "@lore/core";

/** Receives one advisory line (no trailing newline). */
export type WarnSink = (line: string) => void;

/** The sink of a component that was constructed without one: advisories go nowhere. */
export const discardWarnings: WarnSink = () => undefined;

/**
 * A {@link WarnSink} that writes each line, plus a newline, to `writer`.
 *
 * @param writer - the run's stderr writer (`inv.io.stderr`)
 * @example
 *   const warn = warnSinkOf(inv.io.stderr);
 *   warn("trace event not recorded"); // writer receives "trace event not recorded\n"
 */
export function warnSinkOf(writer: InvocationWriter): WarnSink {
  return (line) => {
    writer.write(`${line}\n`);
  };
}
