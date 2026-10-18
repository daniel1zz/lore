/**
 * lore decide <id> --accept|--reject [--reason <text>] — the human answers a pending decision.
 *
 * ⛔ Human-only. It resolves nothing unless stdin and stdout are a TTY, no ancestor process is an agent harness,
 * the environment and argv carry no agent identity, and a nonce shown on the controlling terminal is typed back.
 * It is deliberately absent from the MCP tool list and the HTTP routes, and the shipped PreToolUse hook denies a
 * Bash call containing it. All behaviour lives in `../decide-flow.ts`.
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-3.
 */
import { defineCommand } from "citty";
import { findLoreDbPath } from "../utils.js";
import { runDecideFlow } from "../decide-flow.js";
import { invocationOf } from "../command-invocation.js";
import { createProductionHumanChannelPorts } from "../../real-human-channel-port.js";

export default defineCommand({
  meta: {
    name: "decide",
    description: "Answer a pending decision (human only: interactive terminal, no agent, nonce typed back)",
  },
  args: {
    id: { type: "positional", description: "Pending decision id (see `lore pending`)", required: false },
    accept: { type: "boolean", description: "Accept: the operation may proceed when re-run" },
    reject: { type: "boolean", description: "Reject: the operation stays refused" },
    reason: { type: "string", description: "Why (recorded with the answer)" },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const dbPath = findLoreDbPath(inv);
    process.exitCode = await runDecideFlow(
      {
        dbPath,
        id: args.id === undefined ? undefined : String(args.id),
        accept: args.accept === true,
        reject: args.reject === true,
        ...(args.reason === undefined ? {} : { reason: String(args.reason) }),
      },
      createProductionHumanChannelPorts(inv),
    );
  },
});
