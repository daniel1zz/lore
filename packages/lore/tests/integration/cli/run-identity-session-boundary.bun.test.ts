/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and#AC-RV-9
 * @task task-red-tests-export-prefix-ancestry-verification-refusal (RED; implementation lands in a later task of the same plan)
 * @spawns packages/lore/src/index.ts
 *
 * Trust boundary (user decision D19): verification is per SESSION. Two harness processes exist: A (a bash process that
 * runs lore, registered as the harness of cc:A, cc:A:x and cc:A:y) and B (a sleeping process registered as the harness of
 * cc:B). Under A:
 *   - LORE_HARNESS_RUN=cc:B is REFUSED (exit 4) naming B's harness process, and nothing is written;
 *   - LORE_HARNESS_RUN=cc:A:y is ACCEPTED (exit 0) and recorded as cc:A:y (the documented in-session residual).
 *
 * Throwaway corpus and HOME; the real CLI is spawned as a descendant of the registered harness process. Runs are seeded
 * with the store's existing insertRun + recordRunProcess. No new symbol is imported.
 */
import { Database } from "bun:sqlite";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunId } from "@lore/core";
import { createRealProcessTablePort } from "../../../src/adapters/process-table-port.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { actedStore } from "../../live-invocation.js";

import { insertRequirementsDocWithoutHistory } from "../../helpers/parented-create.js";
const INDEX_TS = new URL("../../../src/index.ts", import.meta.url).pathname;
const STAMP = "2026-10-27T00:00:00.000Z";

let root: string;
let corpus: string;
let dbPath: string;
let harnessB: ChildProcess;
let parentId: string;

function baseEnv(): Record<string, string> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg"),
    EDITOR: "true",
    CLAUDECODE: "1",
    // reason: stop the test run's known-party spawn shim (scripts/test-known-party-spawn.ts) from injecting a run of its own.
    LORE_TEST_IDENTITY: "none",
  };
  delete env["LORE_HARNESS_RUN"];
  return env as Record<string, string>;
}

function makeRun(id: string, kind: "main" | "subagent", agentRef: string | null): Record<string, unknown> {
  return {
    id,
    kind,
    harness: "claude-code",
    sessionRef: id.split(":")[1],
    agentRef,
    agentType: null,
    parentRunId: null,
    branch: "main",
    composition: { schemaVersion: 1, fragments: [{ id: "frag-1", sha256: "a".repeat(64) }] },
    registeredAt: STAMP,
  };
}

async function startTimeOf(pid: number): Promise<string> {
  const inspected = await createRealProcessTablePort({ env: process.env, cwd: process.cwd() }).inspect(pid);
  if (inspected === null || inspected.startTime === null) throw new Error(`cannot read the start time of pid ${pid}`);
  return inspected.startTime;
}

async function seedRun(id: string, kind: "main" | "subagent", agentRef: string | null, harnessPid: number): Promise<void> {
  const startTime = await startTimeOf(harnessPid);
  const store = actedStore(new SQLiteStore(dbPath)) as unknown as {
    insertRun: (r: unknown) => Promise<{ ok: boolean; error?: unknown }>;
    recordRunProcess: (id: RunId, p: { pid: number | null; startTime: string | null; worktree: string | null }) => Promise<{ ok: boolean; error?: unknown }>;
    close?: () => void;
  };
  try {
    const inserted = await store.insertRun(makeRun(id, kind, agentRef));
    if (!inserted.ok) throw new Error(`insertRun failed: ${JSON.stringify(inserted.error)}`);
    const recorded = await store.recordRunProcess(id as RunId, { pid: harnessPid, startTime, worktree: null });
    if (!recorded.ok) throw new Error(`recordRunProcess failed: ${JSON.stringify(recorded.error)}`);
  } finally {
    store.close?.();
  }
}

function auditRows(): Record<string, unknown>[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.query("SELECT * FROM audit ORDER BY rowid").all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

/**
 * Run `lore <args>` as a descendant of a fresh bash process (harness A) with `value` as LORE_HARNESS_RUN. The harness is
 * registered AFTER it starts (its pid and start time are needed) and released with a line on its stdin.
 */
async function runUnderHarnessA(value: string, args: string[]): Promise<{ exit: number; out: string; harnessPid: number }> {
  const script = `read go; export LORE_HARNESS_RUN='${value}'; bun run '${INDEX_TS}' ${args.map((a) => `'${a}'`).join(" ")}; echo "EXIT=$?"`;
  const child = spawn("bash", ["-c", script], { cwd: corpus, env: baseEnv(), stdio: ["pipe", "pipe", "pipe"] });
  if (child.pid === undefined) throw new Error("could not start harness A");
  let out = "";
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
  await seedRun("cc:A", "main", null, child.pid);
  await seedRun("cc:A:x", "subagent", "x", child.pid);
  await seedRun("cc:A:y", "subagent", "y", child.pid);
  const done = new Promise<void>((resolve) => child.on("close", () => resolve()));
  child.stdin?.write("go\n");
  child.stdin?.end();
  await done;
  const match = /EXIT=(\d+)/.exec(out);
  return { exit: match === null ? -1 : Number(match[1]), out, harnessPid: child.pid };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "lore-session-boundary-"));
  mkdirSync(join(root, "home"), { recursive: true });
  corpus = join(root, "corpus");
  dbPath = join(corpus, ".lore", "lore.db");
  mkdirSync(corpus, { recursive: true });
  // reason: Bun.spawnSync, not node:child_process: the test run's spawn shims patch the node call twice under Bun.
  const init = Bun.spawnSync(["bun", "run", INDEX_TS, "init"], { cwd: corpus, env: baseEnv() });
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stdout.toString()}${init.stderr.toString()}`);
  // reason: a plan needs a parent (spec-documents-that-need-a-parent-are-refused-without-one-an-ad D6). The requirements document is
  // inserted without history, so it adds no audit row: the tests below count and attribute every create row.
  const seedStore = new SQLiteStore(dbPath);
  parentId = await insertRequirementsDocWithoutHistory(seedStore);
  seedStore.close();
  harnessB = spawn("sleep", ["600"], { stdio: "ignore" });
  if (harnessB.pid === undefined) throw new Error("could not start harness B");
});

afterEach(() => {
  harnessB.kill("SIGKILL");
  rmSync(root, { recursive: true, force: true });
});

describe("AC-RV-9: the trust boundary is the session", () => {
  it("a value naming a run of ANOTHER session's harness process (B), used under A, is refused with exit 4 naming B's process", async () => {
    await seedRun("cc:B", "main", null, harnessB.pid as number);
    const before = auditRows().length;
    const r = await runUnderHarnessA("cc:B", ["create", "plan", "--parent", parentId, "--title", "Cross-session plan"]);
    expect(r.exit, r.out).toBe(4);
    expect(r.out).toContain(`harness process ${String(harnessB.pid)}`);
    expect(auditRows()).toHaveLength(before);
  }, 120_000);

  it("a value naming a SIBLING run of the same session (cc:A:y, used from cc:A:x's call) is accepted, exit 0, recorded as cc:A:y", async () => {
    await seedRun("cc:B", "main", null, harnessB.pid as number);
    const r = await runUnderHarnessA("cc:A:y", ["create", "plan", "--parent", parentId, "--title", "Sibling plan"]);
    expect(r.exit, r.out).toBe(0);
    const creates = auditRows().filter((row) => row["action"] === "create");
    expect(creates.length).toBeGreaterThan(0);
    expect(creates.every((row) => row["harness_run"] === "cc:A:y")).toBe(true);
  }, 120_000);
});
