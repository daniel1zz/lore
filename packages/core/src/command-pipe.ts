/**
 * Module: command-pipe — the ONE detector for an unquoted shell pipe in a recorded command.
 *
 * Public surface: {@link commandHasUnsafePipe}, {@link findUnsafePipeIndex}, {@link unsafePipeSegment}.
 * Invariants: pure and browser-safe (no Node builtin, no IO, no clock); the single definition shared by
 * the `lore evidence` pipe guard (`findPipeRefusal`) and the AC write chokepoint's declaration-time
 * refusal (BR-1078, spec-evidence-labels-and-reds-are-honest D3/D7). Never copy it.
 * Side-effect class: pure.
 *
 * Source: moved from packages/lore/src/adapters/cli/evidence-precheck.ts (issue #19).
 */

/**
 * Detects an unquoted, non-`||` shell PIPE operator (`|`) anywhere in
 * `command` — the exact hazard {@link findPipeRefusal} exists for: `$?`
 * observed after a pipe belongs to the LAST stage of the pipeline, so a
 * self-reported `--result` recorded from it was never actually measured
 * against the stage the caller means to assert about. THIRD recurrence of
 * this trap in this repo (handoff-71 KD2 recorded two; a third occurred when
 * an implementer's oracle command was `bun run test:changed <base> 2>&1 |
 * tail -100`, which would have recorded a `pass` sourced from `tail`'s exit
 * code regardless of what the actual test run did).
 *
 * Quote-aware in the SAME way `@lore/core`'s
 * `oracle-file-existence.ts::splitCommandSegments` is (a char-by-char scan
 * tracking one open `"`/`'`/`` ` `` run at a time) — a `|` inside a
 * quoted string (`grep 'a|b' file.ts`) is a LITERAL character being searched
 * for, not a shell operator, and reporting it would refuse a command that
 * never actually pipes anything.
 *
 * A `||` (logical OR — run the right side only if the left FAILS) is
 * deliberately NOT reported: `$?` after `a || b` is unambiguously EITHER a's
 * exit code (left succeeded) or b's (left failed) — a single, well-defined
 * status belonging to whichever branch actually executed, never one stage's
 * status silently substituted for a different stage's the way a `|` pipeline
 * substitutes the last stage's exit code for every earlier stage's.
 *
 * @param command - the exact command string recorded via `lore evidence --command`
 * @returns `true` iff an unquoted, non-`||` `|` is present anywhere in `command`
 * @example
 *   commandHasUnsafePipe("bun run test:changed abc 2>&1 | tail -100")
 *   // => true
 * @example
 *   commandHasUnsafePipe("grep 'a|b' file.ts")
 *   // => false — the pipe is inside a quoted run, a literal character
 * @example
 *   commandHasUnsafePipe("bun run lint || bun run lint:fix")
 *   // => false — logical OR, not a pipeline; `$?` belongs to whichever
 *   // branch actually ran
 */
export function commandHasUnsafePipe(command: string): boolean {
  return findUnsafePipeIndex(command) !== -1;
}

/**
 * Index of the first unquoted, non-`||` `|` in `command`, or `-1` when there is none. The scan
 * {@link commandHasUnsafePipe} is defined by — one scanner, so the boolean and the position can never disagree.
 */
export function findUnsafePipeIndex(command: string): number {
  let openQuote: string | null = null;
  for (let index = 0; index < command.length; index += 1) {
    // reason: `as string` is a bounds assertion — `index < command.length` guarantees the read.
    const char = command[index] as string;

    if (openQuote !== null) {
      if (char === openQuote) openQuote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      openQuote = char;
      continue;
    }
    if (char === "|") {
      const prev = index > 0 ? command[index - 1] : undefined;
      const next = index + 1 < command.length ? command[index + 1] : undefined;
      // reason: either neighbour being the OTHER half of a `||` pair means THIS `|` belongs to a
      // logical-OR operator, not a standalone pipe (both halves of the pair are skipped this way).
      if (prev === "|" || next === "|") continue;
      return index;
    }
  }
  return -1;
}

/**
 * The first pipe segment of `command` as written — from the unsafe `|` up to the next `&&`, `;` or the end,
 * trimmed (`"false | tail -1 && echo PASS"` gives `"| tail -1"`); `null` when {@link commandHasUnsafePipe} is false.
 * For refusal and advisory messages that must quote the offending text.
 */
export function unsafePipeSegment(command: string): string | null {
  const at = findUnsafePipeIndex(command);
  if (at === -1) return null;
  const rest = command.slice(at);
  const stop = rest.search(/&&|;/);
  return (stop === -1 ? rest : rest.slice(0, stop)).trim();
}
