// @spawns packages/lore/src/index.ts
// @spawns packages/lore/tests/integration/fixtures/autonomy-decide-driver.ts
// @spawns assets/hooks/pre-bash-git-safety-gate.mjs
// @reads packages/lore/src/adapters/mcp/**
// @reads packages/lore/src/adapters/http/**
/**
 * AC-AU-3 oracle — the human answers an escalation through a channel the agent cannot use.
 *
 * Everything runs in a THROWAWAY corpus (mkdtemp + `lore init`), never the repo's own `.lore/`. Pseudo-terminals are
 * real (Bun.spawn `terminal`): the test process plays the human reading the terminal and typing the nonce back.
 *
 * Ancestry design (this test process may itself run under an agent harness): the SUCCESS path runs a test driver that
 * calls the real `runDecideFlow` with ONE injected port, the process-table reader. The PRODUCTION wiring is asserted
 * separately: the real CLI under an agent env (5b), the real CLI under a real fake-`claude` ancestor process found by
 * the real `ps` reader (5b-ancestry), and the live reader's own chain.
 *
 * Halves (spec AC-AU-3): (1) non-TTY stdin -> exit 4 naming the TTY rule; (2) TTY + wrong nonce -> exit 4; (3) the
 * shipped PreToolUse hook denies `lore decide` (exit 2, rule name) and leaves git refusals alone; (4) no MCP tool /
 * HTTP route for decide; (5) agent-asserted record does not resolve; (5b) agent identity -> exit 4 agent-ancestry;
 * (5c) no nonce in any agent-readable output; (6) TTY + correct nonce -> exit 0, resolved, re-run proceeds.
 *
 * @spec_ref AC-AU-3
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { DecisionService } from "../../src/service/decision-service.js";
import {
  findAgentEnvMarker,
  findAgentHarnessAncestor,
  proveHumanChannel,
  checkHumanChannelPreconditions,
} from "../../src/service/human-channel.js";
import { readLiveProcessTable } from "../../src/adapters/real-human-channel-port.js";
import { LORE_MCP_TOOL_NAMES } from "../../src/adapters/mcp/tool-names.js";
import { scriptedHumanPorts } from "./fixtures/scripted-human-ports.js";
import { actedStore } from "../live-invocation.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const DRIVER_TS = join(PACKAGE_ROOT, "tests", "integration", "fixtures", "autonomy-decide-driver.ts");
const HOOK = join(REPO_ROOT, "assets", "hooks", "pre-bash-git-safety-gate.mjs");

const CLASS_ID = "stash-drop";
const WEAK = { recoverability: "loss-free-by-proof", blast: "calling-session", evidence: "none" } as const;
const NONCE_RE = /Confirmation code: ([A-Z0-9]{8})/;

let corpus = "";
let dbPath = "";

/** A clean environment: no agent marker of any kind, so only the check under test can refuse. */
function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: process.env["PATH"] ?? "", HOME: corpus, EDITOR: "true", ...extra };
}

function runLore(args: string[], env: Record<string, string> = cleanEnv()): { stdout: string; stderr: string; exitCode: number } {
  const r = spawnSync("bun", ["run", INDEX_TS, ...args], { cwd: corpus, env, encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 };
}

interface PtyResult {
  readonly code: number;
  readonly output: string;
  readonly nonce: string | null;
}

/** Runs `cmd` on a real pseudo-terminal; types `answer(nonce)` back when the nonce appears. */
async function ptyRun(cmd: string[], env: Record<string, string>, answer: (nonce: string) => string): Promise<PtyResult> {
  let output = "";
  let nonce: string | null = null;
  const proc = Bun.spawn(cmd, {
    cwd: corpus,
    env,
    terminal: {
      cols: 120,
      rows: 40,
      data(_terminal: unknown, chunk: Uint8Array) {
        output += new TextDecoder().decode(chunk);
        const match = nonce === null ? NONCE_RE.exec(output) : null;
        if (match !== null && match[1] !== undefined) {
          nonce = match[1];
          proc.terminal?.write(`${answer(nonce)}\n`);
        }
      },
    },
  });
  const timer = setTimeout(() => proc.kill(), 45_000);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, output, nonce };
}

async function seed(subjectId: string, version = "v1"): Promise<number> {
  const store = actedStore(new SQLiteStore(dbPath));
  try {
    const service = new DecisionService({ store, executorRun: null });
    const out = await service.decide(CLASS_ID, { id: subjectId, version }, WEAK);
    if (!out.ok) throw new Error(`seed failed: ${JSON.stringify(out.error)}`);
    expect(out.value.effective.verdict).toBe("escalate");
    const pending = await service.listPending();
    if (!pending.ok) throw new Error(`listPending failed: ${JSON.stringify(pending.error)}`);
    const row = pending.value.find((p) => p.subject_id === subjectId && p.subject_version === version);
    if (row === undefined) throw new Error("seeded escalation is not pending");
    return row.id;
  } finally {
    store.close();
  }
}

async function withService<T>(fn: (service: DecisionService) => Promise<T>): Promise<T> {
  const store = actedStore(new SQLiteStore(dbPath));
  try {
    return await fn(new DecisionService({ store, executorRun: null }));
  } finally {
    store.close();
  }
}

async function pendingIds(): Promise<number[]> {
  return withService(async (service) => {
    const pending = await service.listPending();
    if (!pending.ok) throw new Error("listPending failed");
    return pending.value.map((p) => p.id);
  });
}

function dumpDecisionLog(): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    return JSON.stringify(db.query("SELECT * FROM decision_log").all());
  } finally {
    db.close();
  }
}

function runHook(command: string): { code: number; stderr: string } {
  const r = spawnSync("node", [HOOK], { input: JSON.stringify({ cwd: corpus, tool_input: { command } }), encoding: "utf8" });
  return { code: r.status ?? -1, stderr: r.stderr ?? "" };
}

beforeAll(() => {
  corpus = mkdtempSync(join(tmpdir(), "lore-au3-"));
  const init = runLore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  dbPath = join(corpus, ".lore", "lore.db");
});

afterAll(() => {
  if (corpus.startsWith(tmpdir())) rmSync(corpus, { recursive: true, force: true });
});

describe("AC-AU-3 human channel", () => {
  it("(1) non-TTY stdin and stdout -> exit 4 naming the TTY requirement; the decision stays pending", async () => {
    const id = await seed("half-1");
    const r = runLore(["decide", String(id), "--accept"]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr + r.stdout).toMatch(/tty-required/);
    expect(r.stderr).toMatch(/TTY/);
    expect(await pendingIds()).toContain(id);
  });

  it("(2) TTY with a WRONG nonce -> exit 4 naming the nonce rule; still pending", async () => {
    const id = await seed("half-2");
    const r = await ptyRun(["bun", "run", DRIVER_TS, dbPath, String(id), "--accept"], cleanEnv(), () => "WRONGWRO");
    expect(r.nonce).not.toBeNull();
    expect(r.code).toBe(4);
    expect(r.output).toMatch(/nonce-mismatch/);
    expect(await pendingIds()).toContain(id);
  });

  it("(2b) an empty answer and an answer with the right nonce plus a suffix are both wrong", async () => {
    const id = await seed("half-2b");
    const empty = await ptyRun(["bun", "run", DRIVER_TS, dbPath, String(id), "--accept"], cleanEnv(), () => "");
    expect(empty.code).toBe(4);
    const suffixed = await ptyRun(["bun", "run", DRIVER_TS, dbPath, String(id), "--accept"], cleanEnv(), (n) => `${n}X`);
    expect(suffixed.code).toBe(4);
    expect(await pendingIds()).toContain(id);
  });

  it("(3) the shipped PreToolUse hook denies a Bash call containing `lore decide` (exit 2, rule named) and still allows the rest", () => {
    for (const command of [
      "lore decide 3 --accept",
      "lore decide 3 --reject --reason nope",
      "FOO=1 lore decide 3 --accept",
      "./dist/lore decide 3 --accept",
      "cd /tmp && lore decide 3 --accept",
      `bash -c "lore decide 3 --accept"`,
      "lore --by someone decide 3 --accept",
      "bun run packages/lore/src/index.ts decide 3 --accept",
    ]) {
      const r = runHook(command);
      expect(r.code, command).toBe(2);
      expect(r.stderr, command).toMatch(/human-channel-only/);
    }
    for (const command of [
      "lore pending",
      "lore pending --json",
      'git commit -m "docs: lore decide is human only"',
      "echo lore decide",
      "lore get decide-something",
    ]) {
      expect(runHook(command).code, command).toBe(0);
    }
    // git refusals are untouched
    const git = runHook("git reset --hard HEAD");
    expect(git.code).toBe(2);
    expect(git.stderr).toMatch(/git-safety-gate/);
  }, { timeout: 60_000 });

  it("(4) MCP and HTTP expose no decide tool or route", () => {
    expect(LORE_MCP_TOOL_NAMES.filter((name) => /decid/i.test(name))).toEqual([]);
    const offenders: string[] = [];
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) scan(path);
        else if (path.endsWith(".ts") && /lore_decide|['"`]\/api\/[^'"`]*decide/.test(readFileSync(path, "utf8"))) offenders.push(path);
      }
    };
    scan(join(PACKAGE_ROOT, "src", "adapters", "mcp"));
    scan(join(PACKAGE_ROOT, "src", "adapters", "http"));
    expect(offenders).toEqual([]);
  });

  it("(5) an agent-asserted record does not resolve the pending decision", async () => {
    const id = await seed("half-5");
    const store = actedStore(new SQLiteStore(dbPath));
    try {
      const appended = await store.appendDecisionRecord({
        ts: "2026-01-01T00:00:00.000Z",
        class: CLASS_ID,
        subject_id: "half-5",
        subject_version: "v1",
        facts: "{}",
        factors: "{}",
        score: 1,
        threshold: null,
        verdict: "auto",
        reasons: "[]",
        executor_run: "run-agent",
        channel: "agent-asserted",
      });
      expect(appended.ok).toBe(true);
    } finally {
      store.close();
    }
    expect(await pendingIds()).toContain(id);
    const effective = await withService((s) => s.effectiveVerdict(CLASS_ID, { id: "half-5", version: "v1" }));
    expect(effective.ok && effective.value).toMatchObject({ verdict: "escalate", channel: "machine" });
  });

  it("(5b) the real CLI on a real pty with an agent identity in the environment -> exit 4 naming agent-ancestry; still pending", async () => {
    const id = await seed("half-5b");
    for (const env of [
      cleanEnv({ CLAUDECODE: "1" }),
      cleanEnv({ CLAUDE_CODE_SESSION_ID: "abc" }),
      cleanEnv({ AI_AGENT: "claude-code" }),
    ]) {
      const r = await ptyRun(["bun", "run", INDEX_TS, "decide", String(id), "--accept"], env, (n) => n);
      expect(r.code).toBe(4);
      expect(r.output).toMatch(/agent-ancestry/);
      expect(r.nonce, "no nonce is even shown to an agent-identified process").toBeNull();
    }
    expect(await pendingIds()).toContain(id);
  });

  it("(5b-ancestry) the real CLI under a real process named claude, read by the real ps reader -> exit 4 agent-ancestry", async () => {
    const id = await seed("half-5b-ancestry");
    const bin = join(corpus, "fake-harness");
    mkdirSync(bin, { recursive: true });
    const claude = join(bin, "claude");
    writeFileSync(claude, '#!/bin/sh\n"$@"\n');
    chmodSync(claude, 0o755);
    const r = await ptyRun([claude, "bun", "run", INDEX_TS, "decide", String(id), "--accept"], cleanEnv(), (n) => n);
    expect(r.code).toBe(4);
    expect(r.output).toMatch(/agent-ancestry/);
    expect(r.nonce).toBeNull();
    expect(await pendingIds()).toContain(id);
  });

  it("(5b-driver) a fixture ancestry that contains the harness refuses even on a clean env and a TTY", async () => {
    const id = await seed("half-5b-fixture");
    const r = await ptyRun(["bun", "run", DRIVER_TS, dbPath, String(id), "--accept"], cleanEnv({ FIXTURE_ANCESTRY_COMMAND: "claude --dangerously" }), (n) => n);
    expect(r.code).toBe(4);
    expect(r.output).toMatch(/agent-ancestry/);
    expect(await pendingIds()).toContain(id);
  });

  it("(6) control + (5c): TTY + correct nonce -> exit 0, resolved human-tty with ancestry and chain head, the operation proceeds on re-run; the nonce is in no agent-readable output", async () => {
    const id = await seed("half-6");
    const before = await withService((s) => s.chainHead());
    const r = await ptyRun(["bun", "run", DRIVER_TS, dbPath, String(id), "--accept", "reviewed by hand"], cleanEnv(), (n) => n);
    expect(r.code).toBe(0);
    expect(r.nonce).not.toBeNull();
    expect(await pendingIds()).not.toContain(id);

    // re-running the escalated operation: the effective verdict is now the human's
    const rerun = await withService((s) => s.decide(CLASS_ID, { id: "half-6", version: "v1" }, WEAK));
    expect(rerun.ok && rerun.value.decision.verdict).toBe("escalate"); // this call's own facts are unchanged...
    expect(rerun.ok && rerun.value.effective).toMatchObject({ verdict: "auto", channel: "human-tty" }); // ...but the human decided

    // the record
    const db = new Database(dbPath, { readonly: true });
    type HumanRow = { channel: string; facts: string; verdict: string; reasons: string };
    const readRow = (): HumanRow | null => {
      try {
        return db.query("SELECT channel, facts, verdict, reasons FROM decision_log WHERE channel = 'human-tty' AND subject_id = 'half-6'").get() as HumanRow | null;
      } finally {
        db.close();
      }
    };
    const row = readRow();
    expect(row).not.toBeNull();
    expect(row?.verdict).toBe("auto");
    const facts = JSON.parse(row?.facts ?? "{}") as { human?: Record<string, unknown> };
    expect(facts.human?.["pending_id"]).toBe(id);
    expect(facts.human?.["answer"]).toBe("accept");
    expect(facts.human?.["reason"]).toBe("reviewed by hand");
    expect(Array.isArray(facts.human?.["ancestry"]) && (facts.human?.["ancestry"] as unknown[]).length).toBeGreaterThan(0);
    expect(facts.human?.["chain_head"]).toMatchObject({ head_id: before.ok && before.value !== null ? before.value.head_id : -1 });

    // (5c) the nonce appears in no agent-readable surface
    const nonce = r.nonce as string;
    const list = runLore(["pending"]);
    const listJson = runLore(["pending", "--json"]);
    const refusal = runLore(["decide", String(id), "--accept"]);
    for (const surface of [list.stdout + list.stderr, listJson.stdout + listJson.stderr, refusal.stdout + refusal.stderr, dumpDecisionLog()]) {
      expect(surface).not.toContain(nonce);
    }
    // a second resolution of the same decision is refused: it is no longer pending
    const again = await ptyRun(["bun", "run", DRIVER_TS, dbPath, String(id), "--reject"], cleanEnv(), (n) => n);
    expect(again.code).toBe(4);
    expect(again.output).toMatch(/not pending/);
  }, { timeout: 60_000 });

  it("(6b) a human reject makes the version refuse; every invocation gets a fresh nonce", async () => {
    const a = await seed("half-6b-a");
    const b = await seed("half-6b-b");
    const first = await ptyRun(["bun", "run", DRIVER_TS, dbPath, String(a), "--reject"], cleanEnv(), (n) => n);
    const second = await ptyRun(["bun", "run", DRIVER_TS, dbPath, String(b), "--reject"], cleanEnv(), (n) => n);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(first.nonce).not.toBe(second.nonce);
    const effective = await withService((s) => s.effectiveVerdict(CLASS_ID, { id: "half-6b-a", version: "v1" }));
    expect(effective.ok && effective.value).toMatchObject({ verdict: "refuse", channel: "human-tty" });
  });

  it("argument errors are exit 4 and change nothing: neither/both of --accept --reject, unknown id", async () => {
    const id = await seed("half-args");
    expect(runLore(["decide", String(id)]).exitCode).toBe(4);
    expect(runLore(["decide", String(id), "--accept", "--reject"]).exitCode).toBe(4);
    const unknown = await ptyRun(["bun", "run", DRIVER_TS, dbPath, "999999", "--accept"], cleanEnv(), (n) => n);
    expect(unknown.code).toBe(4);
    expect(unknown.output).toMatch(/not pending/);
    expect(await pendingIds()).toContain(id);
  }, { timeout: 60_000 });

  it("`lore pending` lists open decisions with score, factors and the recommended answer (text and --json)", async () => {
    const id = await seed("half-list");
    const json = runLore(["pending", "--json"]);
    expect(json.exitCode).toBe(0);
    const parsed = JSON.parse(json.stdout) as { data: { decisions: Array<Record<string, unknown>> } };
    const row = parsed.data.decisions.find((d) => d["id"] === id);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ class: CLASS_ID, subject_id: "half-list", subject_version: "v1" });
    expect(typeof row?.["score"]).toBe("number");
    expect(row?.["factors"]).toMatchObject({ R: expect.any(Number), B: expect.any(Number), E: expect.any(Number), C: expect.any(Number) });
    expect(["accept", "reject"]).toContain(row?.["recommended"]);
    expect(Object.keys(row ?? {})).not.toContain("nonce");
    const text = runLore(["pending"]);
    expect(text.stdout).toContain("half-list");
    expect(text.stdout).toMatch(new RegExp(`lore decide ${id} --accept\\|--reject`));
  });
});

describe("AC-AU-3 human channel units (injectable seams)", () => {
  it("findAgentHarnessAncestor walks the table to the harness, is cycle-safe and ignores look-alike arguments", () => {
    const table = [
      { pid: 10, ppid: 9, command: "bun run decide" },
      { pid: 9, ppid: 8, command: "-zsh" },
      { pid: 8, ppid: 7, command: "/usr/local/bin/claude --resume" },
      { pid: 7, ppid: 1, command: "login" },
    ];
    expect(findAgentHarnessAncestor(table, 10)?.pid).toBe(8);
    expect(findAgentHarnessAncestor([{ pid: 10, ppid: 9, command: "node /x/node_modules/@anthropic-ai/claude-code/cli.js" }, { pid: 9, ppid: 1, command: "sh" }], 10)?.pid).toBe(10);
    expect(findAgentHarnessAncestor([{ pid: 10, ppid: 9, command: "sh /tmp/claude" }, { pid: 9, ppid: 1, command: "sh" }], 10)?.pid).toBe(10);
    // look-alikes: an editor opening a file called claude, a directory named claude in a path
    expect(findAgentHarnessAncestor([{ pid: 10, ppid: 1, command: "vim claude" }], 10)).toBeNull();
    expect(findAgentHarnessAncestor([{ pid: 10, ppid: 1, command: "/home/u/claude/bin/mytool run" }], 10)).toBeNull();
    // a cycle terminates
    expect(findAgentHarnessAncestor([{ pid: 1, ppid: 2, command: "a" }, { pid: 2, ppid: 1, command: "b" }], 1)).toBeNull();
  });

  it("findAgentEnvMarker names the offending variable", () => {
    expect(findAgentEnvMarker({ PATH: "/bin" })).toBeNull();
    expect(findAgentEnvMarker({ CLAUDECODE: "1" })).toBe("CLAUDECODE");
    expect(findAgentEnvMarker({ CLAUDE_CODE_ENTRYPOINT: "cli" })).toBe("CLAUDE_CODE_ENTRYPOINT");
    expect(findAgentEnvMarker({ CLAUDE_SESSION_ID: "s" })).toBe("CLAUDE_SESSION_ID");
    expect(findAgentEnvMarker({ CLAUDECODE: "" })).toBeNull(); // unset-like value is not a marker
  });

  it("preconditions refuse in the documented order and name the rule", () => {
    const refusal = (opts: Parameters<typeof scriptedHumanPorts>[0]) => {
      const r = checkHumanChannelPreconditions(scriptedHumanPorts(opts));
      return r.ok ? null : r.error.rule;
    };
    expect(refusal({})).toBeNull();
    expect(refusal({ stdinIsTty: false })).toBe("tty-required");
    expect(refusal({ stdoutIsTty: false })).toBe("tty-required");
    expect(refusal({ stdinIsTty: false, env: { CLAUDECODE: "1" } })).toBe("tty-required"); // TTY rule first
    expect(refusal({ env: { CLAUDECODE: "1" } })).toBe("agent-ancestry");
    expect(refusal({ argv: ["decide", "3", "--accept", "--harness-run", "cc:S1"] })).toBe("agent-ancestry");
    expect(refusal({ parentCommand: "claude" })).toBe("agent-ancestry");
  });

  it("proveHumanChannel: correct nonce -> proof with ancestry; wrong -> nonce-mismatch; the nonce reaches only the terminal", () => {
    const log: string[] = [];
    const ok = proveHumanChannel(scriptedHumanPorts({ terminalLog: log }), { summary: "accept pending decision 1" });
    expect(ok.ok).toBe(true);
    expect(log.join("")).toMatch(/Confirmation code: TESTN001/);
    const bad = proveHumanChannel(scriptedHumanPorts({ typeBack: () => "nope" }), { summary: "x" });
    expect(!bad.ok && bad.error.rule).toBe("nonce-mismatch");
    expect(!bad.ok && JSON.stringify(bad.error)).not.toMatch(/TESTN/);
  });

  it("the service has no ungated human-tty writer, and a forged proof cannot resolve a decision", async () => {
    const id = await seed("unit-forged");
    expect((DecisionService.prototype as unknown as Record<string, unknown>)["recordHumanTtyUngated"]).toBeUndefined();
    const forged = { channel: "human-tty", ancestry: [], verified_at: "now" } as never;
    const out = await withService((s) => s.resolvePending(id, "accept", undefined, forged));
    expect(!out.ok && out.error.code).toBe("VALIDATION_ERROR");
    expect(await pendingIds()).toContain(id);
    // control: a proof from the injectable seam does resolve
    const proof = proveHumanChannel(scriptedHumanPorts(), { summary: "unit" });
    if (!proof.ok) throw new Error("scripted proof refused");
    const resolved = await withService((s) => s.resolvePending(id, "accept", undefined, proof.value));
    expect(resolved.ok).toBe(true);
    expect(await pendingIds()).not.toContain(id);
  });

  it("the live process-table reader sees this process and its parent chain (production wiring)", () => {
    const table = readLiveProcessTable();
    expect(table.ok).toBe(true);
    if (!table.ok) return;
    const self = table.value.find((e) => e.pid === process.pid);
    expect(self).toBeDefined();
    expect(table.value.some((e) => e.pid === process.ppid)).toBe(true);
  });
});
