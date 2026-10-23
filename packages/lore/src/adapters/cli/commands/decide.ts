/**
 * lore decide <id> --accept|--reject [--reason <text>] — the human answers a pending decision.
 *
 * ⛔ Human-only. It resolves nothing unless stdin and stdout are a TTY, no ancestor process is an agent harness,
 * the environment and argv carry no agent identity, and a nonce shown on the controlling terminal is typed back.
 * It is deliberately absent from the MCP tool list and the HTTP routes, and the shipped PreToolUse hook denies a
 * Bash call containing it. All behaviour lives in `../decide-flow.ts`.
 *
 * `--from-harness` (BR-1374) is the in-session path: the shipped PostToolUse hook pipes the AskUserQuestion payload in
 * and `../decide-harness-flow.ts` records the answers of questions lore itself wrote (`lore pending --ask`).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-3.
 */
import { defineLoreCommand } from "../cli-exit.js";

import { findLoreDbPath } from "../utils.js";
import { runDecideFlow } from "../decide-flow.js";
import { runDecideFromHarness } from "../decide-harness-flow.js";
import { invocationOf } from "../command-invocation.js";
import { createProductionHumanChannelPorts } from "../../real-human-channel-port.js";

export default defineLoreCommand({
  meta: {
    name: "decide",
    description: "Answer a pending decision: at a terminal (human only, nonce typed back) or --from-harness (the hook records an in-session answer)",
  },
  args: {
    id: { type: "positional", description: "Pending decision id (see `lore pending`)", required: false },
    accept: { type: "boolean", description: "Accept: the operation may proceed when re-run (audit item: the auto decision was RIGHT)" },
    reject: { type: "boolean", description: "Reject: the operation stays refused (audit item: the auto decision was WRONG)" },
    reason: { type: "string", description: "Why (recorded with the answer)" },
    "from-harness": {
      type: "boolean",
      description: "Record the answers of a PostToolUse AskUserQuestion payload read from stdin (used by the shipped hook; takes no id or answer flag)",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const dbPath = findLoreDbPath(inv.io, inv);
    if (args["from-harness"] === true) {
      const otherFlagsGiven = args.id !== undefined || args.accept === true || args.reject === true || args.reason !== undefined;
      return runDecideFromHarness(inv, { dbPath, otherFlagsGiven });
    }
    const code = await runDecideFlow(
      inv,
      {
        dbPath,
        id: args.id === undefined ? undefined : String(args.id),
        accept: args.accept === true,
        reject: args.reject === true,
        ...(args.reason === undefined ? {} : { reason: String(args.reason) }),
      },
      createProductionHumanChannelPorts(inv),
    );
    return code;
  },
});
