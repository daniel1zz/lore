/**
 * `lore decide` flow — resolve one pending decision through the human channel.
 *
 * Purpose: the whole behaviour of `lore decide <id> --accept|--reject [--reason]`, separated from citty so the same
 * code runs under the real command (production ports) and under the AC-AU-3 test driver (one injected port).
 * Public surface: runDecideFlow, DecideFlowInput, DecideFlowIo.
 * Invariants:
 *   - Order: argument validation, then the channel preconditions (TTY, agent identity/ancestry), then the pending
 *     lookup, then the nonce. A refusal exits HUMAN_CHANNEL_REFUSAL_EXIT (4) with the rule name first on stderr and
 *     writes nothing to the decision log.
 *   - The nonce exists only inside `confirmHumanNonce` and on the controlling terminal; nothing here prints,
 *     returns or logs it.
 *   - The only write is `DecisionService.resolvePending`, which re-checks that the decision is still pending.
 * Side-effect class: IO (opens the corpus DB, the controlling terminal, stdout/stderr).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-3.
 */
import { exitCode, formatError } from "./utils.js";
import { DecisionService } from "../../service/decision-service.js";
import {
  HUMAN_CHANNEL_REFUSAL_EXIT,
  checkHumanChannelPreconditions,
  confirmHumanNonce,
  type HumanChannelPorts,
} from "../../service/human-channel.js";
import { SQLiteStore } from "../../store/sqlite-store.js";

export interface DecideFlowInput {
  readonly dbPath: string;
  /** The raw positional argument. */
  readonly id: string | undefined;
  readonly accept: boolean;
  readonly reject: boolean;
  readonly reason?: string;
}

export interface DecideFlowIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const processIo: DecideFlowIo = {
  stdout: (text) => void process.stdout.write(text), // CLI surface
  stderr: (text) => void process.stderr.write(text), // CLI surface
};

function usageRefusal(io: DecideFlowIo, message: string): number {
  io.stderr(`Error: ${message}\n`);
  return HUMAN_CHANNEL_REFUSAL_EXIT;
}

/** Runs the flow and returns the process exit code (0 resolved, 4 refused or rejected input, store codes otherwise). */
export async function runDecideFlow(input: DecideFlowInput, ports: HumanChannelPorts, io: DecideFlowIo = processIo): Promise<number> {
  if (input.accept === input.reject) return usageRefusal(io, "lore decide needs exactly one of --accept or --reject");
  const pendingId = input.id !== undefined && /^[1-9]\d*$/.test(input.id) ? Number(input.id) : null;
  if (pendingId === null) return usageRefusal(io, "lore decide needs the numeric id of a pending decision (see `lore pending`)");
  const answer = input.accept ? "accept" : "reject";

  const pre = checkHumanChannelPreconditions(ports);
  if (!pre.ok) return usageRefusal(io, pre.error.message);

  let store: SQLiteStore;
  try {
    store = new SQLiteStore(input.dbPath);
  } catch (cause) {
    pre.value.terminal.close();
    io.stderr(`Error: could not open the corpus database: ${String(cause)}\n`);
    return 1;
  }
  try {
    const service = new DecisionService({ store, executorRun: null });
    const pending = await service.getPending(pendingId);
    if (!pending.ok) {
      pre.value.terminal.close();
      io.stderr(formatError(pending.error) + "\n");
      return exitCode(pending.error);
    }
    if (pending.value === null) {
      pre.value.terminal.close();
      return usageRefusal(io, `decision ${pendingId} is not pending (see \`lore pending\`)`);
    }
    const target = pending.value;
    const summary = `${answer} decision ${target.id}: ${target.class} ${target.subject_id} (${target.subject_version}), score ${target.score}`;
    const proof = confirmHumanNonce(ports, pre.value, summary);
    if (!proof.ok) return usageRefusal(io, proof.error.message);

    const resolved = await service.resolvePending(target.id, answer, input.reason, proof.value);
    if (!resolved.ok) {
      io.stderr(formatError(resolved.error) + "\n");
      return exitCode(resolved.error);
    }
    io.stdout(`Decision ${target.id} ${answer === "accept" ? "accepted" : "rejected"} (channel human-tty, record ${resolved.value.id}). Re-run the operation to proceed.\n`);
    return 0;
  } finally {
    store.close();
  }
}
