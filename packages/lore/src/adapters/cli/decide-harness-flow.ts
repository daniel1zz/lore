/**
 * `lore decide --from-harness` flow — record the answers a PostToolUse AskUserQuestion payload carries (BR-1374).
 *
 * Purpose: read the hook payload from stdin, hand it to `recordHarnessAnswers`, print one line per question.
 * Public surface: runDecideFromHarness.
 * Invariants:
 *   - The hook payload on stdin is the ONLY input. `--accept`, `--reject`, an id or `--reason` alongside
 *     `--from-harness` is refused (exit 4): the answer comes from the human's choice, never from a flag.
 *   - Exit 0 when nothing was refused (recorded, still pending and ignored questions all exit 0), exit 4 when any
 *     question or the payload was refused; valid questions of the same call are recorded either way.
 *   - Never prints a nonce.
 * Side-effect class: IO (reads stdin, opens the corpus store, appends decision_log rows, writes stdout/stderr).
 */
import type { Invocation } from "@lore/core";
import { HARNESS_ANSWER_REFUSAL_EXIT, recordHarnessAnswers } from "../../service/harness-ask.js";
import { SQLiteStore } from "../../store/sqlite-store.js";
import { exitCode, formatErrorFor } from "./utils.js";

async function readAll(input: Invocation["io"]["stdin"]): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of input) text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  return text;
}

/** Runs the flow and returns the process exit code. */
export async function runDecideFromHarness(inv: Invocation, input: { readonly dbPath: string; readonly otherFlagsGiven: boolean }): Promise<number> {
  if (input.otherFlagsGiven) {
    inv.io.stderr.write("Error: lore decide --from-harness takes only the hook payload on stdin (no id, --accept, --reject or --reason)\n");
    return HARNESS_ANSWER_REFUSAL_EXIT;
  }
  const payloadText = await readAll(inv.io.stdin);
  let store: SQLiteStore;
  try {
    store = new SQLiteStore(input.dbPath);
  } catch (cause) {
    inv.io.stderr.write(`Error: could not open the corpus database: ${String(cause)}\n`);
    return 1;
  }
  try {
    const report = await recordHarnessAnswers({ store, now: () => new Date().toISOString() }, payloadText);
    if (!report.ok) {
      inv.io.stderr.write(formatErrorFor(inv, report.error) + "\n");
      return exitCode(report.error);
    }
    for (const line of report.value.lines) inv.io.stdout.write(`${line}\n`);
    // reason: a refusal must reach stderr too — the hook forwards stderr, and BR-1374 names the rule first there.
    for (const line of report.value.lines.filter((l) => l.includes("refused"))) inv.io.stderr.write(`BR-1374 ${line}\n`);
    return report.value.exit;
  } finally {
    store.close();
  }
}
