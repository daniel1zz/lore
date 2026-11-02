/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and#AC-RV-3
 * @task task-a-helper-run-its-stop-hook-ended-is-reopened-on-its-next (issue #594)
 * @spawns packages/lore/src/index.ts
 *
 * A helper run that the SubagentStop hook ended (reason `subagent-stop`) is reopened by the helper's next verified lore
 * call: the real CLI runs as a descendant of the run's registered harness process. The reopen is ONE audited write
 * (a `run-reopen` audit row whose details say `subagent-resumed`) and clears `ended_at`.
 *
 * Failure-first cases (each must stay refused with exit 4 naming `ended at`, and write nothing):
 *   - the harness start time on record differs from the live process (pid reuse),
 *   - the run was ended for another reason (session end, `lore run end`).
 * Throwaway corpus and HOME; runs are seeded with the store's insertRun + recordRunProcess + endRun.
 */
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
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
const ENDED_AT = "2026-10-27T00:30:00.000Z";
const RUN = "cc:A:y";

let root: string;
let corpus: string;
let dbPath: string;
let parentId: string;

function baseEnv(): Record<string, string> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg"),
    EDITOR: "true",
    CLAUDECODE: "1",
    // reason: stop the test run's known-party spawn shim from injecting a run of its own.
    LORE_TEST_IDENTITY: "none",
  };
  delete env["LORE_HARNESS_RUN"];
  return env as Record<string, string>;
}

async function startTimeOf(pid: number): Promise<string> {
  const inspected = await createRealProcessTablePort({ env: process.env, cwd: process.cwd() }).inspect(pid);
  if (inspected === null || inspected.startTime === null) throw new Error(`cannot read the start time of pid ${pid}`);
  return inspected.startTime;
}

interface SeedOptions {
  endReason: string | null;
  /** A start time to record instead of the live one (simulates a reused pid). */
  recordedStartTime?: string;
}

async function seedRun(harnessPid: number, options: SeedOptions): Promise<void> {
  const startTime = options.recordedStartTime ?? (await startTimeOf(harnessPid));
  const store = actedStore(new SQLiteStore(dbPath)) as unknown as {
    insertRun: (r: unknown) => Promise<{ ok: boolean; error?: unknown }>;
    recordRunProcess: (id: RunId, p: { pid: number | null; startTime: string | null; worktree: string | null }) => Promise<{ ok: boolean; error?: unknown }>;
    endRun: (id: RunId, endedAt: string, reason: string) => Promise<{ ok: boolean; error?: unknown }>;
    close?: () => void;
  };
  try {
    const inserted = await store.insertRun({
      id: RUN,
      kind: "subagent",
      harness: "claude-code",
      sessionRef: "A",
      agentRef: "y",
      agentType: null,
      parentRunId: null,
      branch: "main",
      composition: { schemaVersion: 1, fragments: [{ id: "frag-1", sha256: "a".repeat(64) }] },
      registeredAt: STAMP,
    });
    if (!inserted.ok) throw new Error(`insertRun failed: ${JSON.stringify(inserted.error)}`);
    const recorded = await store.recordRunProcess(RUN as RunId, { pid: harnessPid, startTime, worktree: null });
    if (!recorded.ok) throw new Error(`recordRunProcess failed: ${JSON.stringify(recorded.error)}`);
    if (options.endReason !== null) {
      const ended = await store.endRun(RUN as RunId, ENDED_AT, options.endReason);
      if (!ended.ok) throw new Error(`endRun failed: ${JSON.stringify(ended.error)}`);
    }
  } finally {
    store.close?.();
  }
}

function runRow(): { ended_at: string | null; end_reason: string | null } {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.query("SELECT ended_at, end_reason FROM runs WHERE id = ?").get(RUN) as { ended_at: string | null; end_reason: string | null };
  } finally {
    db.close();
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

function resumedRows(): Record<string, unknown>[] {
  return auditRows().filter((row) => String(row["details"]).includes("subagent-resumed"));
}

/**
 * Run `lore create plan` `times` times, one after the other, as descendants of one fresh bash process (the harness).
 * The run is seeded AFTER the harness starts (its pid and start time are needed) and the harness is released with a line.
 */
async function runUnderHarness(options: SeedOptions, times = 1): Promise<{ exits: number[]; out: string }> {
  const calls = Array.from({ length: times }, (_, i) => `bun run '${INDEX_TS}' create plan --parent '${parentId}' --title 'Resumed plan ${String(i)}'; echo "EXIT=$?"`).join("; ");
  const script = `read go; export LORE_HARNESS_RUN='${RUN}'; ${calls}`;
  const child = spawn("bash", ["-c", script], { cwd: corpus, env: baseEnv(), stdio: ["pipe", "pipe", "pipe"] });
  if (child.pid === undefined) throw new Error("could not start the harness");
  let out = "";
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
  await seedRun(child.pid, options);
  const done = new Promise<void>((resolve) => child.on("close", () => resolve()));
  child.stdin?.write("go\n");
  child.stdin?.end();
  await done;
  const exits = [...out.matchAll(/EXIT=(\d+)/g)].map((m) => Number(m[1]));
  return { exits, out };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "lore-run-reopen-"));
  mkdirSync(join(root, "home"), { recursive: true });
  corpus = join(root, "corpus");
  dbPath = join(corpus, ".lore", "lore.db");
  mkdirSync(corpus, { recursive: true });
  // reason: Bun.spawnSync, not node:child_process: the test run's spawn shims patch the node call twice under Bun.
  const init = Bun.spawnSync(["bun", "run", INDEX_TS, "init"], { cwd: corpus, env: baseEnv() });
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stdout.toString()}${init.stderr.toString()}`);
  const seedStore = new SQLiteStore(dbPath);
  parentId = await insertRequirementsDocWithoutHistory(seedStore);
  seedStore.close();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("AC-RV-3: a helper run ended by its stop hook reopens on its next verified call (#594)", () => {
  it("HAPPY: a subagent-stop run called from its own harness tree succeeds, ended_at is cleared, one subagent-resumed audit row", async () => {
    const before = auditRows().length;
    const r = await runUnderHarness({ endReason: "subagent-stop" });
    expect(r.exits, r.out).toEqual([0]);
    expect(runRow()).toEqual({ ended_at: null, end_reason: null });
    const resumed = resumedRows();
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.["harness_run"]).toBe(RUN);
    expect(auditRows().length).toBeGreaterThan(before);
  }, 120_000);

  it("STATE: a second call after the reopen finds an open run and writes no second reopen row", async () => {
    const r = await runUnderHarness({ endReason: "subagent-stop" }, 2);
    expect(r.exits, r.out).toEqual([0, 0]);
    expect(resumedRows()).toHaveLength(1);
  }, 180_000);

  it("NEGATIVE: a mismatched harness start time stays refused with run-ended (exit 4); the run stays ended; no reopen row", async () => {
    const r = await runUnderHarness({ endReason: "subagent-stop", recordedStartTime: "1999-01-01T00:00:00.000Z" });
    expect(r.exits, r.out).toEqual([4]);
    expect(r.out).toContain(`run ${RUN} ended at ${ENDED_AT} (subagent-stop)`);
    expect(runRow().ended_at).toBe(ENDED_AT);
    expect(resumedRows()).toHaveLength(0);
  }, 120_000);

  it("NEGATIVE: a run ended by session end stays refused with exit 4 and is not reopened", async () => {
    const r = await runUnderHarness({ endReason: "other" });
    expect(r.exits, r.out).toEqual([4]);
    expect(r.out).toContain(`run ${RUN} ended at ${ENDED_AT} (other)`);
    expect(runRow()).toEqual({ ended_at: ENDED_AT, end_reason: "other" });
    expect(resumedRows()).toHaveLength(0);
  }, 120_000);
});
