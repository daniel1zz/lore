/**
 * `lore run register | show | end | attest-input` — harness run identity (spec run-identity-slice-1, D2 / D5 / D10 / D12).
 *
 *   register --harness claude-code --session <id> [--agent-id <id> --agent-type <t>] [--parent <run id>]
 *            [--branch <name>] [--json]
 *       Registers a run (first registration wins; a repeat exits 0 and changes nothing). The command layer
 *       computes the composition record — the fragments the run was given (`hook:subagent-start` for a
 *       subagent; the `rules:user` + `rules:project` selections for a main run) with the sha256 of each fragment FILE — through the existing fragments flow and
 *       hands it to RunService, which only validates and persists (D5).
 *   show <run id> [--json]
 *       Prints a registered run; unknown id exits 3 naming the id.
 *   end <run id> --reason <r> [--json]
 *       Ends a run (spec-run-only-write-identity-and-run-end-claim-release D4, BR-1057): stamps `ended_at`, releases
 *       every claim of the run whose worktree is clean (or was never recorded: the release records
 *       `worktree: not-measured`), and keeps a claim whose worktree has uncommitted changes, marked `orphaned_dirty`
 *       naming that worktree. An unknown run id exits 0 and writes nothing (SubagentStop also fires for internal
 *       agents). Registering an ended run again reopens it.
 *   occupancy --worktree <path> [--json]
 *       Read-only (spec-worktree-removal-is-decided-by-who-is-inside-not-by-how): the worktree's owning agent run
 *       (basename `agent-<agentId>`) and the open task claims recorded for it, each with whether its run has ended,
 *       plus `occupied`. `--json` prints `{ok, data}`. Consumed by the git-safety hook. Exit 2 without
 *       `--worktree`, 1 on a store failure.
 *   tasks <run id> [--json]
 *       Read-only (spec session-trail, Run -> tasks): the tasks the run ever claimed, from the claim audit rows
 *       (so a released or archived task is still listed), each with its current status and `file_anchors`.
 *       `--json` prints `{ok, data: {run, tasks}}`. An unregistered run id exits 4 naming it.
 *   register ... [--harness-pid <pid>]
 *       Also records the harness process (pid resolved past a plain shell wrapper, its start time read now, and the
 *       checkout root the command ran in) so `reap` can prove a run dead and what it left behind (AC-AU-5).
 *   register ... [--messaging-socket <absolute path>]
 *       Records the run's messaging address (BR-1360). The CLI composes the harness grammar (claude-code ->
 *       `uds:<path>`); a harness without a known grammar, or an empty / non-absolute path, exits 2 and stores nothing.
 *       Written on EVERY register: a resume replaces it and omitting the flag clears it. A subagent run stores none.
 *   reap [--apply] [--json]
 *       (AC-AU-5, RunReapService) Ends runs with no end whose recorded harness pid is dead (decide run-end-stale, reason
 *       dead-pid), escalates legacy runs without a pid as ONE decision, and reaps processes inside ENDED runs' worktrees
 *       only when decide(process-reap) is auto on an ownership proof. Without --apply nothing changes. Exit 0 on a
 *       completed sweep (escalations are reported), 1 when the table is unmeasurable or a kill failed.
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

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { defineLoreCommand } from "../cli-exit.js";
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
import { exitCode, formatErrorFor } from "../utils.js";
import { writeAllSync } from "../stdio-sync.js";
import type { RunService } from "../../../service/run-service.js";
import type { ReapReport } from "../../../service/run-reap-service.js";
import type { RunProcessRecord } from "../../../store/store-interface.js";
import { createRealProcessTablePort } from "../../process-table-port.js";
import { runFragmentsRender } from "../../../flows/fragments-flow.js";
import { detectWorktreeBranch } from "../../real-git-port.js";
import { buildFlowDeps } from "./fragments.js";
import type { Invocation } from "@lore/core";
import { invocationOf } from "../command-invocation.js";
import type { CliIo } from "../output.js";
import type { ExitReport } from "../cli-exit.js";

const ACTIONS = ["register", "show", "end", "occupancy", "tasks", "reap", "attest-input"] as const;
type Action = (typeof ACTIONS)[number];

const USAGE_EXIT = 2;
const VALIDATION_EXIT = 4;
const CLAUDE_CODE_HARNESS = "claude-code";
/**
 * A lore MCP tool under ANY registered server name: `mcp__<server>__lore_<verb>` (#146, #202, BR-1093).
 * reason: twin of `LORE_MCP_TOOL` in assets/hooks/pre-tool-harness-run.mjs — that hook ships as a standalone
 * .mjs with no import path to this package, so the shape cannot be shared; change both together
 * (pinned by tests/integration/hooks/harness-run-any-server-name.test.ts, REAL_BINARY_NO_STUB block).
 */
const LORE_MCP_TOOL = /^mcp__.+__lore_\w+$/;

function isAction(value: string): value is Action {
  return (ACTIONS as readonly string[]).includes(value);
}

function usageError(io: CliIo, message: string): ExitReport {
  io.stderr.write(`Error: ${message}\n`);
  return USAGE_EXIT;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Message-address grammar per harness (BR-1360). The hook forwards the raw socket path; the grammar lives only here. */
const MESSAGE_ADDRESS_COMPOSERS: Readonly<Record<string, (socketPath: string) => string>> = {
  "claude-code": (socketPath) => `uds:${socketPath}`,
};

/** `{ address }` composed from `--messaging-socket`, or `{ error }` (exit 2, nothing stored). Absent flag -> `{ address: undefined }`. */
function composeMessageAddress(harness: string, raw: unknown): { address: string | undefined } | { error: string } {
  if (raw === undefined) return { address: undefined };
  if (typeof raw !== "string" || raw === "") return { error: "--messaging-socket requires a non-empty absolute socket path" };
  if (!raw.startsWith("/")) return { error: `--messaging-socket must be an absolute path (got "${raw}")` };
  const composer = MESSAGE_ADDRESS_COMPOSERS[harness];
  if (composer === undefined) {
    return { error: `--messaging-socket has no known address grammar for harness "${harness}" (known: ${Object.keys(MESSAGE_ADDRESS_COMPOSERS).join(", ")})` };
  }
  return { address: composer(raw) };
}

/**
 * Composition for a run: what the fragment flow selects, hashed from the fragment FILES.
 * A subagent records its `hook:subagent-start` selection. A main run (no agent type) records the union of the
 * `rules:user` and `rules:project` selections (the launch fragments its rules files carry into the session,
 * BR-1028) and the `hook:user-prompt` selection (re-injected every turn), so the record lists what the session was given.
 */
async function computeComposition(agentType: string | undefined, inv: Invocation): Promise<CompositionRecord | { error: string }> {
  const deps = buildFlowDeps(inv.cwd, inv);
  if (!deps.ok) return { error: `${deps.error.code}: ${deps.error.message}` };
  const requests =
    agentType === undefined
      ? [{ outlet: "rules:user" as const }, { outlet: "rules:project" as const }, { outlet: "hook:user-prompt" as const }]
      : [{ outlet: "hook:subagent-start" as const, agentType }];
  const byId = new Map<string, string>();
  for (const request of requests) {
    const rendered = await runFragmentsRender(deps.value, request);
    if (!rendered.ok) return { error: `${rendered.error.code}: ${rendered.error.message}` };
    for (const row of rendered.value.explain) {
      byId.set(row.id, createHash("sha256").update(readFileSync(row.path)).digest("hex"));
    }
  }
  return { schemaVersion: 1, fragments: [...byId].map(([id, sha256]) => ({ id, sha256 })) };
}

/**
 * The process a registration runs in (AC-AU-5), measured here and handed to RunService as facts: the harness pid
 * (`--harness-pid`, resolved past a plain shell wrapper), that process's start time read NOW, and the checkout the
 * command ran in. `undefined` when the caller named no pid (nothing is measured, nothing is overwritten); a pid that
 * cannot be probed records a null pair (a legacy-style run) with a stderr note — registration itself never fails on it.
 */
async function measureRunProcess(io: CliIo, rawPid: string | undefined, cwd: string, env: Invocation["env"]): Promise<RunProcessRecord | undefined | { error: string }> {
  if (rawPid === undefined) return undefined;
  if (!/^[0-9]+$/.test(rawPid)) return { error: `--harness-pid must be a positive integer (got "${rawPid}")` };
  const port = createRealProcessTablePort({ env, cwd });
  const pid = await port.resolveHarnessPid(Number.parseInt(rawPid, 10));
  const inspected = pid === null ? null : await port.inspect(pid);
  const startTime = inspected === null || inspected.zombie ? null : inspected.startTime;
  if (pid === null || startTime === null) {
    io.stderr.write(`Note: harness pid ${rawPid} could not be probed; the run is registered without a recorded process\n`);
  }
  return {
    pid: pid !== null && startTime !== null ? pid : null,
    startTime: pid !== null && startTime !== null ? startTime : null,
    worktree: detectCheckoutRoot(cwd),
  };
}

/** The top-level directory of the checkout containing `directory` (real path), or null outside a repository. */
function detectCheckoutRoot(directory: string): string | null {
  const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: directory, encoding: "utf8" });
  if (probe.error !== undefined || probe.status !== 0) return null;
  const top = (probe.stdout ?? "").trim();
  if (top === "") return null;
  try {
    return realpathSync(top);
  } catch {
    return top;
  }
}

function renderRunText(run: RunRecord): string {
  const lines = [
    `Run: ${run.id}`,
    `Kind: ${run.kind}`,
    `Harness: ${run.harness}`,
    `Session: ${run.sessionRef}`,
    `Agent: ${run.agentRef ?? "-"}${run.agentType !== null ? ` (${run.agentType})` : ""}`,
    `Parent: ${run.parentRunId ?? (run.kind === "main" ? "-" : "unknown")}`,
    `Branch: ${run.branch ?? "-"}`,
    `Registered: ${run.registeredAt}`,
    `address: ${run.messageAddress ?? "none recorded"}`,
    `Composition (${run.composition.fragments.length} fragments):`,
    ...run.composition.fragments.map((f) => `  ${f.id} ${f.sha256}`),
  ];
  return `${lines.join("\n")}\n`;
}

async function withRunService(inv: Invocation, body: (service: RunService) => Promise<ExitReport>): Promise<ExitReport> {
  // reason: RunService comes from the App so it sits on the store `createApp` selected (sync.enabled -> TursoStore,
  // root CLAUDE.md D-007) rather than a private SQLiteStore handle that would bypass store selection.
  const { app } = loadLoreApp({ inv });
  try {
    if (app.runService === undefined) throw new Error("App was built without a runService");
    return await body(app.runService);
  } finally {
    app.close();
  }
}

async function runRegister(args: Record<string, unknown>, inv: Invocation): Promise<ExitReport> {
  const harness = stringArg(args, "harness");
  const session = stringArg(args, "session");
  if (harness === undefined) return usageError(inv.io, "lore run register requires --harness <name>");
  if (session === undefined) return usageError(inv.io, "lore run register requires --session <session id>");
  const agentId = stringArg(args, "agent-id");
  const agentType = stringArg(args, "agent-type");
  const parent = stringArg(args, "parent");
  const branch = stringArg(args, "branch");

  const messageAddress = composeMessageAddress(harness, args["messaging-socket"]);
  if ("error" in messageAddress) return usageError(inv.io, messageAddress.error);

  const composition = await computeComposition(agentId !== undefined ? agentType : undefined, inv);
  if ("error" in composition) {
    inv.io.stderr.write(`Error: cannot compute the run composition: ${composition.error}\n`);
    return VALIDATION_EXIT;
  }
  const runProcess = await measureRunProcess(inv.io, stringArg(args, "harness-pid"), inv.cwd, inv.env);
  if (runProcess !== undefined && "error" in runProcess) return usageError(inv.io, runProcess.error);

  return await withRunService(inv, async (service): Promise<number> => {
    const result = await service.register({
      harness,
      sessionId: session,
      ...(agentId !== undefined ? { agentId } : {}),
      ...(agentType !== undefined ? { agentType } : {}),
      ...(parent !== undefined ? { parentRunId: parent } : {}),
      ...(branch !== undefined ? { branch } : {}),
      composition,
      ...(runProcess !== undefined ? { process: runProcess } : {}),
      ...(messageAddress.address !== undefined ? { messageAddress: messageAddress.address } : {}),
    });
    if (!result.ok) {
      inv.io.stderr.write(`${formatErrorFor(inv, result.error)}\n`);
      return exitCode(result.error);
    }
    inv.io.stdout.write(args["json"] === true ? `${JSON.stringify({ ok: true, data: result.value }, null, 2)}\n` : `${result.value.id}\n`);
    return 0;
  });
}

async function runShow(args: Record<string, unknown>, inv: Invocation): Promise<ExitReport> {
  const id = stringArg(args, "id");
  if (id === undefined) return usageError(inv.io, "lore run show requires a run id");
  return await withRunService(inv, async (service): Promise<number> => {
    const result = await service.show(id);
    if (!result.ok) {
      inv.io.stderr.write(`${formatErrorFor(inv, result.error)}\n`);
      return exitCode(result.error);
    }
    inv.io.stdout.write(args["json"] === true ? `${JSON.stringify({ ok: true, data: result.value }, null, 2)}\n` : renderRunText(result.value));
    return 0;
  });
}

async function runEnd(args: Record<string, unknown>, inv: Invocation): Promise<ExitReport> {
  const id = stringArg(args, "id");
  if (id === undefined) return usageError(inv.io, "lore run end requires a run id");
  const reason = stringArg(args, "reason");
  if (reason === undefined) return usageError(inv.io, "lore run end requires --reason <reason>");
  return await withRunService(inv, async (service): Promise<number> => {
    const result = await service.end(id, reason);
    if (!result.ok) {
      inv.io.stderr.write(`${formatErrorFor(inv, result.error)}\n`);
      return exitCode(result.error);
    }
    const ended = result.value;
    if (args["json"] === true) {
      inv.io.stdout.write(`${JSON.stringify({ ok: true, data: { run: id, ...ended } }, null, 2)}\n`);
      return 0;
    }
    if (ended.outcome === "unknown-run") {
      inv.io.stdout.write(`Run ${id} is not registered: nothing to end\n`);
      return 0;
    }
    const lines = [
      `Run ${id} ${ended.outcome === "ended" ? "ended" : "was already ended"} (${reason})`,
      ...ended.claims.map((c) =>
        c.action === "released"
          ? `  released ${c.task_slug} (worktree: ${c.worktree})`
          : `  kept ${c.task_slug} as orphaned_dirty (uncommitted changes in ${c.worktree})`,
      ),
    ];
    inv.io.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  });
}

async function runOccupancy(args: Record<string, unknown>, inv: Invocation): Promise<ExitReport> {
  const worktree = stringArg(args, "worktree");
  if (worktree === undefined) return usageError(inv.io, "lore run occupancy requires --worktree <path>");
  // reason: a claim may record the worktree's BRANCH instead of its path (issue #158); an unmeasurable branch
  // (absent directory, detached HEAD) leaves only the path comparison.
  const measured = await detectWorktreeBranch(worktree);
  return await withRunService(inv, async (service): Promise<number> => {
    const result = await service.occupancy({
      worktree,
      ...(measured.status === "measured" ? { branch: measured.branch } : {}),
    });
    if (!result.ok) {
      inv.io.stderr.write(`${formatErrorFor(inv, result.error)}\n`);
      return exitCode(result.error);
    }
    const occupancy = result.value;
    if (args["json"] === true) {
      inv.io.stdout.write(`${JSON.stringify({ ok: true, data: occupancy }, null, 2)}\n`);
      return 0;
    }
    const run = occupancy.agent_run;
    const lines = [
      `Worktree: ${occupancy.worktree}`,
      run === null
        ? "Agent run: none (not an agent-<id> worktree)"
        : `Agent run: ${run.id} (${run.ended ? "ended" : "no end recorded"}; parent ${run.parent_ended === null ? "not measured" : run.parent_ended ? "ended" : "no end recorded"})`,
      ...occupancy.open_claims.map(
        (c) => `Claim: ${c.task_slug} run ${c.run_id ?? "-"} (${c.run_ended === null ? "not measured" : c.run_ended ? "ended" : "no end recorded"})`,
      ),
      `Occupied: ${occupancy.occupied ? "yes" : "no"}`,
    ];
    inv.io.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  });
}

async function runTasks(args: Record<string, unknown>, inv: Invocation): Promise<ExitReport> {
  const id = stringArg(args, "id");
  if (id === undefined) return usageError(inv.io, "lore run tasks requires a run id");
  return await withRunService(inv, async (service): Promise<number> => {
    const result = await service.tasks(id);
    if (!result.ok) {
      inv.io.stderr.write(`${formatErrorFor(inv, result.error)}\n`);
      return exitCode(result.error);
    }
    if (args["json"] === true) {
      inv.io.stdout.write(`${JSON.stringify({ ok: true, data: result.value }, null, 2)}\n`);
      return 0;
    }
    const lines = [
      `Run: ${result.value.run}`,
      ...(result.value.tasks.length === 0
        ? ["Tasks: none claimed"]
        : result.value.tasks.map((t) => `  ${t.slug} (${t.status}) anchors: ${t.file_anchors.join(", ") || "-"}`)),
    ];
    inv.io.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  });
}

const REAP_FAILURE_EXIT = 1;

/** Human rendering of a reap report: one line per run ending / process, then the legacy decision. */
function renderReapText(report: ReapReport): string {
  const lines: string[] = [report.apply ? "Reap (applied)" : "Reap (dry run: nothing signalled, ended or recorded; pass --apply)"];
  for (const run of report.runs) lines.push(`  run ${run.run_id}: ${run.action} (${run.reason})`);
  if (report.legacy !== null) {
    lines.push(
      `  legacy runs without a recorded pid (${report.legacy.run_ids.length}): ${report.legacy.verdict}` +
        `${report.legacy.already_pending ? " (one decision already pending)" : ""} — ${report.legacy.run_ids.join(", ")}`,
    );
  }
  for (const entry of report.processes) {
    lines.push(`  pid ${entry.pid} ${entry.action} [${entry.proof}] cwd ${entry.cwd} :: ${entry.command}`);
    for (const reason of entry.reasons) lines.push(`      ${reason}`);
  }
  if (report.runs.length === 0 && report.legacy === null && report.processes.length === 0) lines.push("  nothing to do");
  return `${lines.join("\n")}\n`;
}

/**
 * `lore run reap [--apply] [--json]`. Exit 0 on a completed sweep (escalations are reported, not failures);
 * 1 when the process table cannot be measured, a decision cannot be recorded, a signal is denied, or a reaped
 * process survived SIGKILL. Writes nothing without --apply.
 */
async function runReap(args: Record<string, unknown>, inv: Invocation): Promise<ExitReport> {
  const { app } = loadLoreApp({ inv });
  try {
    if (app.runReapService === undefined) throw new Error("App was built without a runReapService");
    const result = await app.runReapService.reap({ apply: args["apply"] === true });
    if (!result.ok) {
      inv.io.stderr.write(`${formatErrorFor(inv, result.error)}\n`);
      return REAP_FAILURE_EXIT;
    }
    const report = result.value;
    inv.io.stdout.write(args["json"] === true ? `${JSON.stringify({ ok: true, data: report }, null, 2)}\n` : renderReapText(report));
    const failed = report.processes.some((entry) => entry.action === "denied" || entry.action === "survived");
    if (failed || report.runs.some((entry) => entry.action === "end-failed")) return REAP_FAILURE_EXIT;
  } finally {
    app.close();
  }
  return 0;
}

const preToolUsePayloadSchema =z.object({
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
  if (LORE_MCP_TOOL.test(payload.tool_name)) return rewriteMcpInput(payload.tool_input, run);
  const command = payload.tool_input["command"];
  if (payload.tool_name !== "Bash" || typeof command !== "string") return null;
  const rewritten = rewriteBashCommand(command, run);
  return rewritten === command ? null : { ...payload.tool_input, command: rewritten };
}

/** Read the whole of `input` as UTF-8 text. */
async function readAllText(input: Invocation["io"]["stdin"]): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of input) text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

async function runAttestInput(io: Invocation["io"]): Promise<number> {
  let raw: string;
  try {
    raw = await readAllText(io.stdin);
  } catch {
    return 0; // reason: no stdin attached — nothing to attest, pass through
  }
  const updatedInput = computeUpdatedInput(raw);
  if (updatedInput === null) return 0;
  // ⛔ no `permissionDecision` key, ever (D12) — see module header.
  io.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput } })}\n`);
  return 0;
}

export default defineLoreCommand({
  meta: {
    name: "run",
    description:
      "Harness run identity: `register --harness claude-code --session <id> [--agent-id <id> --agent-type <t>]`, " +
      "`show <run id> [--json]`, `end <run id> --reason <r>`, `occupancy --worktree <path> [--json]`, " +
      "`tasks <run id> [--json]`, `attest-input` (PreToolUse payload on stdin -> hook JSON).",
  },
  args: {
    action: { type: "positional", description: "register | show | end | attest-input", required: false },
    id: { type: "positional", description: "show | end | tasks: run id", required: false },
    harness: { type: "string", description: "register: harness name (claude-code)" },
    session: { type: "string", description: "register: harness session id" },
    "agent-id": { type: "string", description: "register: subagent id (makes the run a subagent)" },
    "agent-type": { type: "string", description: "register: subagent type (required with --agent-id)" },
    parent: { type: "string", description: "register: the parent run id; omitted => stored as unknown" },
    branch: { type: "string", description: "register: branch the run works on" },
    "harness-pid": { type: "string", description: "register: pid of the harness process (its start time and checkout are recorded for `reap`)" },
    "messaging-socket": { type: "string", description: "register: absolute path of the session's messaging socket (stored as the run's address)" },
    apply: { type: "boolean", description: "reap: actually end dead runs and reap proven orphans (default: report only)" },
    reason: { type: "string", description: "end: why the run ended (required)" },
    worktree: { type: "string", description: "occupancy: worktree directory to measure (required)" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const action = typeof args.action === "string" ? args.action : "";
    if (!isAction(action)) return usageError(inv.io, `lore run requires an action: ${ACTIONS.join(" | ")} (got "${action}")`);
    const rest = args as Record<string, unknown>;
    switch (action) {
      case "register":
        return runRegister(rest, inv);
      case "show":
        return runShow(rest, inv);
      case "end":
        return runEnd(rest, inv);
      case "occupancy":
        return runOccupancy(rest, inv);
      case "tasks":
        return runTasks(rest, inv);
      case "reap":
        return runReap(rest, inv);
      case "attest-input":
        return await runAttestInput(inv.io);
      default: {
        const unreachable: never = action;
        throw new Error(`lore run: unhandled action ${String(unreachable)}`);
      }
    }
  },
});
