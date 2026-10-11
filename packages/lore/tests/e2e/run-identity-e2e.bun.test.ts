/**
 * @spec_ref AC-RID-18
 *
 * End-to-end: REAL hook scripts -> BUILT `dist/lore` -> stamped writes, with no live Claude Code session
 * (spec-run-identity-slice-1-harness-attested-runs-attested D1, D2, D10, D12).
 *
 * Expected behaviour (from the spec, before reading implementations):
 *   - run-register.mjs fed one SessionStart payload (session S) and two SubagentStart payloads (agents A1, A2)
 *     registers three DISTINCT runs: cc:S, cc:S:A1, cc:S:A2; both subagent runs name cc:S as parent
 *     (`lore run show --json`).
 *   - pre-tool-harness-run.mjs fed a Bash PreToolUse payload for `lore evidence <task> ...` prints hook JSON whose
 *     `updatedInput.command` is the command with the run flag injected; running THAT command with the built CLI
 *     leaves an evidence audit row whose harness_run is the run of the payload's session/agent.
 *   - The hook never emits `permissionDecision` (D12).
 *   - A payload from an agent id that was never registered: the write is stored unattested (harness_run NULL),
 *     never refused, and exactly one stderr line names the unregistered id (branch B2 input).
 *
 * Dimensions: HAPPY (three attested rows), STATE (parents, distinctness), NEGATIVE (unregistered agent),
 * REGRESSION (D12 no permissionDecision), BOUNDARY (the control: the raw un-rewritten command stays unattested).
 *
 * No mocks: real hooks (node), real `dist/lore`, throwaway git repo + `lore init` corpus. The repo's own `.lore/`
 * is never touched.
 */

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { AuditEntry } from "@lore/core";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

setDefaultTimeout(180_000);

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const HOOKS_DIR = join(REPO_ROOT, "assets", "hooks");
const RUN_REGISTER = join(HOOKS_DIR, "run-register.mjs");
const PRE_TOOL = join(HOOKS_DIR, "pre-tool-harness-run.mjs");

const SESSION = "e2e-session-7f3a";
const AGENT_1 = "agent-aaa111";
const AGENT_2 = "agent-bbb222";
const AGENT_GHOST = "agent-ghost999";
const AGENT_TYPE = "lore-implementer";

const MAIN_RUN = `cc:${SESSION}`;
const RUN_1 = `cc:${SESSION}:${AGENT_1}`;
const RUN_2 = `cc:${SESSION}:${AGENT_2}`;
const RUN_GHOST = `cc:${SESSION}:${AGENT_GHOST}`;

interface Out {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let root = "";
let corpus = "";

/** Hermetic child env: identity sources scrubbed, `dist/lore` first on PATH so the hooks' `lore` is the built binary. */
function childEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg"),
    CLAUDECODE: "1",
    EDITOR: "true",
    PATH: `${dirname(LORE_BIN)}${delimiter}${process.env["PATH"] ?? ""}`,
  };
  for (const k of ["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"]) delete e[k];
  return e;
}

function lore(args: string[]): Out {
  const p = spawnSync(LORE_BIN, args, { cwd: corpus, env: childEnv(), encoding: "utf8" });
  return { stdout: p.stdout, stderr: p.stderr, exitCode: p.status ?? 1 };
}

function mustLore(args: string[]): Out {
  const r = lore(args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

/** Runs a real hook script exactly as Claude Code would: payload JSON on stdin, cwd = project. */
function runHook(script: string, payload: Record<string, unknown>): Out {
  const p = spawnSync("node", [script], { cwd: corpus, env: childEnv(), input: JSON.stringify(payload), encoding: "utf8" });
  return { stdout: p.stdout, stderr: p.stderr, exitCode: p.status ?? 1 };
}

/** Executes a (rewritten) Bash command string the way the harness would: through a shell, same env, in the project. */
function runShell(command: string): Out {
  const p = spawnSync("bash", ["-c", command], { cwd: corpus, env: childEnv(), encoding: "utf8" });
  return { stdout: p.stdout, stderr: p.stderr, exitCode: p.status ?? 1 };
}

const evidenceCommand = (task: string): string => `lore evidence ${task} --oracle manual --command "e2e probe" --result pass --output-tail "e2e probe ok"`;

function preToolPayload(task: string, agentId?: string): Record<string, unknown> {
  return {
    session_id: SESSION,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: evidenceCommand(task) },
    ...(agentId === undefined ? {} : { agent_id: agentId, agent_type: AGENT_TYPE }),
  };
}

function newTask(title: string): string {
  const r = mustLore(["create", "task", "--adhoc", "--title", title, "--ac-scope", "", "--json"]);
  const data = JSON.parse(r.stdout).data as { slug: string; id: string };
  docIds.set(data.slug, data.id);
  return data.slug;
}

/** Audit rows are keyed by document id, not slug. */
const docIds = new Map<string, string>();

async function evidenceAuditRows(): Promise<AuditEntry[]> {
  const store = new SQLiteStore(join(corpus, ".lore", "lore.db"));
  try {
    const r = await store.queryAudit({ limit: 100_000 });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value.filter((row) => /evidence/i.test(row.action)).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } finally {
    store.close();
  }
}

/** Rewrites via the real pre-tool hook, asserts the D12 invariant on the way, and returns the rewritten command. */
function rewriteViaHook(payload: Record<string, unknown>): string {
  const hook = runHook(PRE_TOOL, payload);
  expect(hook.exitCode).toBe(0);
  expect(hook.stdout).not.toContain("permissionDecision");
  const parsed = JSON.parse(hook.stdout) as { hookSpecificOutput: { updatedInput: { command: string } } };
  return parsed.hookSpecificOutput.updatedInput.command;
}

const tasks = { main: "", a1: "", a2: "", ghost: "", control: "" };
const hookStdout: string[] = [];
const rewritten: Record<string, string> = {};
const writeResults: Record<string, Out> = {};

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);

  root = realpathSync(mkdtempSync(join(tmpdir(), "run-identity-e2e-")));
  if (root.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "xdg"), { recursive: true });
  corpus = join(root, "corpus");
  mkdirSync(corpus, { recursive: true });
  const git = (a: string[]) => execFileSync("git", a, { cwd: corpus, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "e2e@example.invalid"]);
  git(["config", "user.name", "run identity e2e"]);
  writeFileSync(join(corpus, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);

  mustLore(["init"]);
  mustLore(["create", "prd", "--title", "E2E Root", "--content", "root", "--no-ai"]);
  tasks.main = newTask("e2e main evidence target");
  tasks.a1 = newTask("e2e agent one evidence target");
  tasks.a2 = newTask("e2e agent two evidence target");
  tasks.ghost = newTask("e2e unregistered agent evidence target");
  tasks.control = newTask("e2e control (no hook) evidence target");

  // Real run-register hook: one SessionStart, two SubagentStart payloads.
  const start = (extra: Record<string, unknown>) => runHook(RUN_REGISTER, { session_id: SESSION, ...extra });
  const regs = [
    start({ hook_event_name: "SessionStart", source: "startup" }),
    start({ hook_event_name: "SubagentStart", agent_id: AGENT_1, agent_type: AGENT_TYPE }),
    start({ hook_event_name: "SubagentStart", agent_id: AGENT_2, agent_type: AGENT_TYPE }),
  ];
  for (const r of regs) hookStdout.push(r.stdout);

  // Real pre-tool hook -> execute the rewritten command with the built CLI, in the order main, A1, A2, ghost.
  const cases: Array<[string, string, string | undefined]> = [
    ["main", tasks.main, undefined],
    ["a1", tasks.a1, AGENT_1],
    ["a2", tasks.a2, AGENT_2],
    ["ghost", tasks.ghost, AGENT_GHOST],
  ];
  for (const [key, task, agent] of cases) {
    rewritten[key] = rewriteViaHook(preToolPayload(task, agent));
    writeResults[key] = runShell(rewritten[key] as string);
  }
  // Control: the SAME command, never passed through the hook.
  writeResults["control"] = runShell(evidenceCommand(tasks.control));
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("AC-RID-18: run-register hook registers distinct runs against the built CLI", () => {
  it("the register hook is silent on success for all three payloads (no failure additionalContext)", () => {
    expect(hookStdout).toEqual(["", "", ""]);
  });

  it("main, agent 1 and agent 2 are three distinct registered runs (run show succeeds for each)", () => {
    for (const id of [MAIN_RUN, RUN_1, RUN_2]) {
      const r = lore(["run", "show", id, "--json"]);
      expect({ id, code: r.exitCode }).toEqual({ id, code: 0 });
      expect(JSON.parse(r.stdout).data.id).toBe(id);
    }
    expect(new Set([MAIN_RUN, RUN_1, RUN_2]).size).toBe(3);
  });

  it("both subagent runs show parent cc:<session> via `lore run show --json`", () => {
    for (const id of [RUN_1, RUN_2]) {
      const data = JSON.parse(lore(["run", "show", id, "--json"]).stdout).data;
      expect(data.kind).toBe("subagent");
      expect(data.parentRunId).toBe(MAIN_RUN);
      expect(data.agentType).toBe(AGENT_TYPE);
    }
  });

  it("the main run has no parent", () => {
    const data = JSON.parse(lore(["run", "show", MAIN_RUN, "--json"]).stdout).data;
    expect(data.kind).toBe("main");
    expect(data.parentRunId).toBeNull();
  });

  it("the never-registered agent has no run (the control for the unattested case)", () => {
    expect(lore(["run", "show", RUN_GHOST, "--json"]).exitCode).not.toBe(0);
  });
});

describe("AC-RID-18: pre-tool hook output, executed with the built CLI, stamps each write with its run", () => {
  it("each rewritten command carries the derived run flag for its own session/agent", () => {
    expect(rewritten["main"]).toContain(MAIN_RUN);
    expect(rewritten["a1"]).toContain(RUN_1);
    expect(rewritten["a2"]).toContain(RUN_2);
    expect(rewritten["main"]).not.toContain(`${MAIN_RUN}:`);
  });

  it("all four hook-routed writes and the control write succeed (an unattested write is never refused)", () => {
    for (const [key, r] of Object.entries(writeResults)) expect({ key, exitCode: r.exitCode, err: r.stderr }).toMatchObject({ key, exitCode: 0 });
  });

  it("the evidence audit rows carry cc:S, cc:S:A1, cc:S:A2 for main, agent 1 and agent 2", async () => {
    const rows = await evidenceAuditRows();
    const byTask = (slug: string) => rows.filter((r) => r.doc_id === docIds.get(slug));
    expect(byTask(tasks.main).map((r) => r.harness_run)).toEqual([MAIN_RUN]);
    expect(byTask(tasks.a1).map((r) => r.harness_run)).toEqual([RUN_1]);
    expect(byTask(tasks.a2).map((r) => r.harness_run)).toEqual([RUN_2]);
  });

  it("the three attested evidence rows hold three distinct runs", async () => {
    const attested = (await evidenceAuditRows()).map((r) => r.harness_run).filter((h): h is string => typeof h === "string");
    expect(attested.length).toBe(3);
    expect(new Set(attested).size).toBe(3);
  });

  it("control: the same command that skipped the hook is stored unattested (the stamp comes from the hook, not the CLI)", async () => {
    const rows = (await evidenceAuditRows()).filter((r) => r.doc_id === docIds.get(tasks.control));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.harness_run ?? null).toBeNull();
  });

  it("D12: the pre-tool hook never emits permissionDecision, for a main or a subagent payload", () => {
    for (const agent of [undefined, AGENT_1]) {
      const out = runHook(PRE_TOOL, preToolPayload(tasks.main, agent));
      expect(out.stdout.length).toBeGreaterThan(0); // liveness: it did print something
      expect(out.stdout).not.toContain("permissionDecision");
    }
  });
});

describe("AC-RID-18 / branch B2 input: a payload from an agent id that never registered", () => {
  it("the hook still rewrites with the derived (unregistered) run id", () => {
    expect(rewritten["ghost"]).toContain(RUN_GHOST);
  });

  it("the write is stored unattested: harness_run NULL on its evidence audit row", async () => {
    const rows = (await evidenceAuditRows()).filter((r) => r.doc_id === docIds.get(tasks.ghost));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.harness_run ?? null).toBeNull();
  });

  it("exactly one stderr warning names the unregistered id", () => {
    const lines = (writeResults["ghost"]?.stderr ?? "").split("\n").filter((l) => l.includes(RUN_GHOST) || l.includes(AGENT_GHOST));
    // eslint-disable-next-line no-console
    console.log(`B2 input: unattested subagent writes in this run = 1; stderr warning lines naming the id = ${lines.length}`);
    expect(lines).toHaveLength(1);
  });

  it("registered runs' writes print no unregistered-run warning", () => {
    for (const key of ["main", "a1", "a2"]) {
      expect(writeResults[key]?.stderr ?? "").not.toMatch(/not registered|unregistered|unknown run|unattested/i);
    }
  });
});
