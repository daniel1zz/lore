/**
 * The y/N confirmation prompt of the interactive commands (`lore setup`, `lore verify`), driven by the run's
 * Invocation io instead of the process streams (spec-process-state-end-state-one-invocation-per-entry-returned
 * D1, rule AS-26).
 *
 * Purpose: ask one question on `io.stdout` and read one answer line from `io.stdin`.
 * Public surface: `promptYesNo`, `PromptIo`.
 * Invariants:
 *   - Reads nothing from the process: the entry resolved `io.stdin` once; a test hands in its own stream.
 *   - Only the first line of the input is consumed; an input that ends before a newline answers with what it
 *     held (an empty input answers "no").
 *   - Any answer other than a case-insensitive "y"/"yes" is "no".
 * Side-effect class: IO on the given streams (one write, reads until the first newline).
 */

import type { Invocation } from "@lore/core";

/** The two streams a prompt uses. */
export type PromptIo = Pick<Invocation["io"], "stdout" | "stdin">;

/**
 * Read chunks from `input` until a newline (or the end of input) and return the text before it.
 * reason: the iterator is advanced by hand and never `return()`ed: leaving a `for await` early destroys the
 * underlying stream, and a real `process.stdin` must stay usable for the rest of the run.
 */
async function readLine(input: PromptIo["stdin"]): Promise<string> {
  const iterator = input[Symbol.asyncIterator]();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const next = await iterator.next();
    if (next.done === true) return buffered;
    const chunk: string | Uint8Array = next.value;
    buffered += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const newline = buffered.indexOf("\n");
    if (newline >= 0) return buffered.slice(0, newline);
  }
}

/**
 * Ask `question` and report whether the answer was "y" or "yes" (any case).
 *
 * @param io - the run's `inv.io` (stdout for the question, stdin for the answer)
 * @param question - the prompt text, written as given (include a trailing space)
 * @returns `true` only for an affirmative answer
 */
export async function promptYesNo(io: PromptIo, question: string): Promise<boolean> {
  io.stdout.write(question);
  const normalized = (await readLine(io.stdin)).trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}
