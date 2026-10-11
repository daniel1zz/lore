/**
 * `lore run register | show | attest-input` — harness run identity (spec run-identity-slice-1, D2 / D5 / D10 / D12).
 *
 *   register --harness claude-code --session <id> [--agent-id <id> --agent-type <t>] [--parent <run id>]
 *            [--branch <name>] [--json]
 *       Registers a run (first registration wins; a repeat exits 0 and changes nothing). The command layer
 *       computes the composition record — the fragments the run's outlet selects (`hook:subagent-start` for a
 *       subagent, `hook:session-start` for a main run) with the sha256 of each fragment FILE — through the
 *       existing fragments flow and hands it to RunService, which only validates and persists (D5).
 *   show <run id> [--json]
 *       Prints a registered run; unknown id exits 3 naming the id.
 *   attest-input
 *       Reads a Claude Code PreToolUse payload on stdin and prints hook JSON carrying `updatedInput` with the
 *       run (derived from `session_id` + `agent_id`) inserted by the core rewrite. ⛔ The output NEVER carries
 *       `permissionDecision` (D12): `updatedInput` alone is applied and permission rules are then evaluated on
 *       the rewritten input, whereas `"allow"` would skip the user's permission prompt for every command that
 *       mentions lore. Nothing to rewrite, malformed stdin, or an underivable run => print nothing, exit 0
 *       (the hook passes the call through). Never opens the corpus.
 *
 * Exit codes: 0 ok, 2 usage, 3 unknown run, 4 validation (unknown harness, bad ids, fragment flow failure).
 * Side-effect class: IO (corpus DB write for register, file reads, stdin/stdout).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  deriveRunId,
  rewriteBashCommand,
  rewriteMcpInput,
  type CompositionRecord,
  type RunId,
  type RunRecord,
} from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import { writeAllSync } from "../stdio-sync.js";
import { SQLiteStore } from "../../../store/sqlite-store.js";
import { RunService } from "../../../service/run-service.js";
import { runFragmentsRender } from "../../../flows/fragments-flow.js";
import { buildFlowDeps } from "./fragments.js";

const ACTIONS = ["register", "show", "attest-input"] as const;
type Action = (typeof ACTIONS)[number];

const USAGE_EXIT = 2;
const VALIDATION_EXIT = 4;
const CLAUDE_CODE_HARNESS = "claude-code";
const MCP_LORE_PREFIX = "mcp__lore__";

function isAction(value: string): value is Action {
  return (ACTIONS as readonly string[]).includes(value);
}

function usageError(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = USAGE_EXIT;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Composition for a run: what the fragment flow selects for its outlet, hashed from the fragment FILES. */
async function computeComposition(agentType: string | undefined): Promise<CompositionRecord | { error: string }> {
  const deps = buildFlowDeps(process.cwd());
  if (!deps.ok) return { error: `${deps.error.code}: ${deps.error.message}` };
  const rendered = await runFragmentsRender(deps.value, {
    outlet: agentType !== undefined ? "hook:subagent-start" : "hook:session-start",
    ...(agentType !== undefined ? { agentType } : {}),
  });
  if (!rendered.ok) return { error: `${rendered.error.code}: ${rendered.error.message}` };
  return {
    schemaVersion: 1,
    fragments: rendered.value.explain.map((row) => ({
      id: row.id,
      sha256: createHash("sha256").update(readFileSync(row.path)).digest("hex"),
    })),
  };
}

function renderRunText(run: RunRecord): string {
  const lines = [
    `Run: ${run.id}`,
    `Kind: ${run.kind}`,
    `Harness: ${run.harness}`,
    `Session: ${run.sessionRef}`,
    `Agent: ${run.agentRef ?? "-"}${run.agentType !== null ? ` (${run.agentType})` : ""}`,
    `Parent: ${run.parentRunId ?? "-"}`,
    `Branch: ${run.branch ?? "-"}`,
    `Registered: ${run.registeredAt}`,
    `Composition (${run.composition.fragments.length} fragments):`,
    ...run.composition.fragments.map((f) => `  ${f.id} ${f.sha256}`),
  ];
  return `${lines.join("\n")}\n`;
}

async function withRunService(body: (service: RunService) => Promise<void>): Promise<void> {
  const { app, dbPath } = loadLoreApp();
  const store = new SQLiteStore(dbPath);
  try {
    await body(new RunService(store));
  } finally {
    store.close();
    app.close();
  }
}

async function runRegister(args: Record<string, unknown>): Promise<void> {
  const harness = stringArg(args, "harness");
  const session = stringArg(args, "session");
  if (harness === undefined) return usageError("lore run register requires --harness <name>");
  if (session === undefined) return usageError("lore run register requires --session <session id>");
  const agentId = stringArg(args, "agent-id");
  const agentType = stringArg(args, "agent-type");
  const parent = stringArg(args, "parent");
  const branch = stringArg(args, "branch");

  const composition = await computeComposition(agentId !== undefined ? agentType : undefined);
  if ("error" in composition) {
    process.stderr.write(`Error: cannot compute the run composition: ${composition.error}\n`);
    process.exitCode = VALIDATION_EXIT;
    return;
  }

  await withRunService(async (service) => {
    const result = await service.register({
      harness,
      sessionId: session,
      ...(agentId !== undefined ? { agentId } : {}),
      ...(agentType !== undefined ? { agentType } : {}),
      ...(parent !== undefined ? { parentRunId: parent } : {}),
      ...(branch !== undefined ? { branch } : {}),
      composition,
    });
    if (!result.ok) {
      process.stderr.write(`${formatError(result.error)}\n`);
      process.exitCode = exitCode(result.error);
      return;
    }
    writeAllSync(1, args["json"] === true ? `${JSON.stringify({ ok: true, data: result.value }, null, 2)}\n` : `${result.value.id}\n`);
  });
}

async function runShow(args: Record<string, unknown>): Promise<void> {
  const id = stringArg(args, "id");
  if (id === undefined) return usageError("lore run show requires a run id");
  await withRunService(async (service) => {
    const result = await service.show(id);
    if (!result.ok) {
      process.stderr.write(`${formatError(result.error)}\n`);
      process.exitCode = exitCode(result.error);
      return;
    }
    writeAllSync(1, args["json"] === true ? `${JSON.stringify({ ok: true, data: result.value }, null, 2)}\n` : renderRunText(result.value));
  });
}

const preToolUsePayloadSchema = z.object({
  session_id: z.string().min(1),
  agent_id: z.string().min(1).optional(),
  tool_name: z.string(),
  tool_input: z.record(z.string(), z.unknown()),
});

/** The updated tool input, or null when there is nothing to rewrite or the payload is unusable. */
function computeUpdatedInput(raw: string): Record<string, unknown> | null {
  let payload: z.infer<typeof preToolUsePayloadSchema>;
  let run: RunId;
  try {
    payload = preToolUsePayloadSchema.parse(JSON.parse(raw));
    run = deriveRunId(CLAUDE_CODE_HARNESS, {
      sessionId: payload.session_id,
      ...(payload.agent_id !== undefined ? { agentId: payload.agent_id } : {}),
    });
  } catch {
    return null; // reason: D10 fail-open — the hook passes the call through on a payload we cannot attest
  }
  if (payload.tool_name.startsWith(MCP_LORE_PREFIX)) return rewriteMcpInput(payload.tool_input, run);
  const command = payload.tool_input["command"];
  if (payload.tool_name !== "Bash" || typeof command !== "string") return null;
  const rewritten = rewriteBashCommand(command, run);
  return rewritten === command ? null : { ...payload.tool_input, command: rewritten };
}

function runAttestInput(): void {
  let raw: string;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return; // reason: no stdin attached — nothing to attest, pass through
  }
  const updatedInput = computeUpdatedInput(raw);
  if (updatedInput === null) return;
  // ⛔ no `permissionDecision` key, ever (D12) — see module header.
  writeAllSync(1, `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput } })}\n`);
}

export default defineCommand({
  meta: {
    name: "run",
    description:
      "Harness run identity: `register --harness claude-code --session <id> [--agent-id <id> --agent-type <t>]`, " +
      "`show <run id> [--json]`, `attest-input` (PreToolUse payload on stdin -> hook JSON).",
  },
  args: {
    action: { type: "positional", description: "register | show | attest-input", required: false },
    id: { type: "positional", description: "show: run id", required: false },
    harness: { type: "string", description: "register: harness name (claude-code)" },
    session: { type: "string", description: "register: harness session id" },
    "agent-id": { type: "string", description: "register: subagent id (makes the run a subagent)" },
    "agent-type": { type: "string", description: "register: subagent type (required with --agent-id)" },
    parent: { type: "string", description: "register: parent run hint (main runs only)" },
    branch: { type: "string", description: "register: branch the run works on" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    const action = typeof args.action === "string" ? args.action : "";
    if (!isAction(action)) return usageError(`lore run requires an action: ${ACTIONS.join(" | ")} (got "${action}")`);
    const rest = args as Record<string, unknown>;
    switch (action) {
      case "register":
        return runRegister(rest);
      case "show":
        return runShow(rest);
      case "attest-input":
        return runAttestInput();
      default: {
        const unreachable: never = action;
        throw new Error(`lore run: unhandled action ${String(unreachable)}`);
      }
    }
  },
});
