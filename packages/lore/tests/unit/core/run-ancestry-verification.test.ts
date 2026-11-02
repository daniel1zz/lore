// @spawns-external bun starts a short-lived child process whose ancestry the test inspects
// @spawns-external ps runs a stub ps script written into a throwaway directory
/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and#AC-RV-3
 * @task task-red-tests-export-prefix-ancestry-verification-refusal (RED; implementation lands in a later task of the same plan)
 *
 * `verifyRunAncestry` (exported from `@lore/core/node`, file run-identity-node.ts) over a FAKE process table: one case per
 * row of the spec's Verification table, each refused with its named cause, plus the accepted cases.
 *
 * The new symbol cannot be exercised without importing it. It is imported DYNAMICALLY inside `loadVerify()`, so a
 * missing export fails each test at an assertion ("MISSING BEHAVIOUR") and not at collection.
 *
 * Contract pinned here (the implementer fits the production code to it, or amends this file deliberately):
 *   verifyRunAncestry({ run, record, table, selfPid }): Promise<{ ok: true } | { ok: false; cause: string; error: string }>
 *   - run: the id named by LORE_HARNESS_RUN / harness_run
 *   - record: the registry row (`RunLifecycle` shape: id, registeredAt, endedAt, endReason, process {pid, startTime, worktree}), or null = unknown run
 *   - table: { parentOf(pid): Promise<number | null>; startTimeOf(pid): Promise<string | null> }; a THROW is an unreadable table
 *   - selfPid: where the walk starts (production passes process.pid)
 *   - `cause` is a stable machine name; `error` is the human text with the wording the spec's table names.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRealProcessTablePort, ProcessTableUnreadableError } from "../../../src/adapters/process-table-port.js";

type Verdict = { ok: true } | { ok: false; cause: string; error: string };

interface FakeTable {
  parentOf(pid: number): Promise<number | null>;
  startTimeOf(pid: number): Promise<string | null>;
}

interface RunRow {
  id: string;
  registeredAt: string;
  endedAt: string | null;
  endReason: string | null;
  parentRunId: string | null;
  agentRef: string | null;
  process: { pid: number | null; startTime: string | null; worktree: string | null };
}

type VerifyFn = (input: { run: string; record: RunRow | null; table: FakeTable; selfPid: number }) => Promise<Verdict>;

async function loadVerify(): Promise<VerifyFn> {
  const mod = (await import("@lore/core/node")) as Record<string, unknown>;
  const fn = mod["verifyRunAncestry"];
  if (typeof fn !== "function") throw new Error("MISSING BEHAVIOUR: @lore/core/node exports no verifyRunAncestry");
  return fn as VerifyFn;
}

const T0 = "2026-10-27T01:00:00.000Z";
const T1 = "2026-10-27T02:00:00.000Z";

/** pid 500 (self) -> 400 (shell) -> 300 (harness) -> 1; every process started at T0. */
function chain(over: Partial<{ startTimes: Record<number, string>; broken: boolean }> = {}): FakeTable {
  const parents: Record<number, number> = { 500: 400, 400: 300, 300: 1 };
  const startTimes: Record<number, string> = { 500: T0, 400: T0, 300: T0, ...over.startTimes };
  return {
    parentOf: async (pid) => {
      if (over.broken === true) throw new Error("process table unreadable: ps exited 1");
      return parents[pid] ?? null;
    },
    startTimeOf: async (pid) => startTimes[pid] ?? null,
  };
}

function row(over: Partial<RunRow> = {}): RunRow {
  return {
    id: "cc:S",
    registeredAt: T0,
    endedAt: null,
    endReason: null,
    parentRunId: null,
    agentRef: null,
    process: { pid: 300, startTime: T0, worktree: null },
    ...over,
  };
}

describe("AC-RV-3: verifyRunAncestry over a fake process table", () => {
  it("ACCEPTED: the registered harness pid is an ancestor with the same start time", async () => {
    const verify = await loadVerify();
    expect(await verify({ run: "cc:S", record: row(), table: chain(), selfPid: 500 })).toEqual({ ok: true });
  });

  it("ACCEPTED: the harness pid is the lore process itself (an in-process test registered with its own pid)", async () => {
    const verify = await loadVerify();
    const verdict = await verify({ run: "cc:S", record: row({ process: { pid: 500, startTime: T0, worktree: null } }), table: chain(), selfPid: 500 });
    expect(verdict).toEqual({ ok: true });
  });

  it("REFUSED: unknown run names `unknown run <id>`", async () => {
    const verify = await loadVerify();
    const verdict = await verify({ run: "cc:never", record: null, table: chain(), selfPid: 500 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.cause).toBe("unknown-run");
      expect(verdict.error).toContain("unknown run cc:never");
    }
  });

  it("REFUSED: ended run names `run <id> ended at <t> (<reason>)`", async () => {
    const verify = await loadVerify();
    const verdict = await verify({ run: "cc:S", record: row({ endedAt: T1, endReason: "stop" }), table: chain(), selfPid: 500 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.cause).toBe("run-ended");
      expect(verdict.error).toContain(`run cc:S ended at ${T1} (stop)`);
    }
  });

  it("REFUSED: the run-ended verdict carries the recorded end reason (#594: the caller reopens only a subagent-stop end)", async () => {
    const verify = await loadVerify();
    const verdict = await verify({ run: "cc:S", record: row({ endedAt: T1, endReason: "subagent-stop" }), table: chain(), selfPid: 500 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.cause).toBe("run-ended");
      expect((verdict as { endReason?: string | null }).endReason).toBe("subagent-stop");
    }
  });

  it("REFUSED: a run-ended verdict with no recorded reason carries endReason null, never a guess", async () => {
    const verify = await loadVerify();
    const verdict = await verify({ run: "cc:S", record: row({ endedAt: T1, endReason: null }), table: chain(), selfPid: 500 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect((verdict as { endReason?: string | null }).endReason).toBeNull();
  });

  it("REFUSED: a legacy run with no harness pid names re-registration", async () => {
    const verify = await loadVerify();
    const verdict = await verify({ run: "cc:S", record: row({ process: { pid: null, startTime: null, worktree: null } }), table: chain(), selfPid: 500 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.cause).toBe("no-harness-pid");
      expect(verdict.error).toContain("registered before lore recorded harness processes");
      expect(verdict.error).toContain("re-registers");
    }
  });

  it("REFUSED: the harness pid is not among the ancestors", async () => {
    const verify = await loadVerify();
    const verdict = await verify({ run: "cc:S", record: row({ process: { pid: 999, startTime: T0, worktree: null } }), table: chain(), selfPid: 500 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.cause).toBe("harness-not-ancestor");
      expect(verdict.error).toContain("this process does not descend from run cc:S's harness process 999");
    }
  });

  it("REFUSED: the pid is found but its start time differs (pid reuse), naming both times", async () => {
    const verify = await loadVerify();
    const verdict = await verify({ run: "cc:S", record: row(), table: chain({ startTimes: { 300: T1 } }), selfPid: 500 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.cause).toBe("harness-pid-reused");
      expect(verdict.error).toContain("harness pid 300 now belongs to another process");
      expect(verdict.error).toContain(T1);
      expect(verdict.error).toContain(T0);
    }
  });

  it("REFUSED, never fail-open: an unreadable process table is refused with the port's reason", async () => {
    const verify = await loadVerify();
    const verdict = await verify({ run: "cc:S", record: row(), table: chain({ broken: true }), selfPid: 500 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.cause).toBe("process-table-unreadable");
      expect(verdict.error).toContain("ps exited 1");
    }
  });

  it("a legacy run re-registered with a pid is then accepted", async () => {
    const verify = await loadVerify();
    const legacy = row({ process: { pid: null, startTime: null, worktree: null } });
    expect((await verify({ run: "cc:S", record: legacy, table: chain(), selfPid: 500 })).ok).toBe(false);
    const reRegistered = row({ process: { pid: 300, startTime: T0, worktree: null } });
    expect(await verify({ run: "cc:S", record: reRegistered, table: chain(), selfPid: 500 })).toEqual({ ok: true });
  });
});

describe("verifyRunAncestry: a harness that exited during the walk (no such process) vs an unreadable table", () => {
  // reason: the spec's cause list has no "harness-exited"; the closest existing cause, harness-not-ancestor, carries it.
  it("REFUSED as exited (not as an unreadable table) when the harness pid was an ancestor but its start time is gone", async () => {
    const verify = await loadVerify();
    const table: FakeTable = { parentOf: chain().parentOf, startTimeOf: async () => null };
    const verdict = await verify({ run: "cc:S", record: row(), table, selfPid: 500 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.cause).toBe("harness-not-ancestor");
      expect(verdict.error).toContain("has exited");
      expect(verdict.error).not.toContain("process table unreadable");
    }
  });

  it("a ps that cannot run (startTimeOf throws) stays process-table-unreadable", async () => {
    const verify = await loadVerify();
    const table: FakeTable = {
      parentOf: chain().parentOf,
      startTimeOf: async () => {
        throw new Error("process table unreadable: ps could not run (spawn failed)");
      },
    };
    const verdict = await verify({ run: "cc:S", record: row(), table, selfPid: 500 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.cause).toBe("process-table-unreadable");
  });
});

describe("real process-table port: ps comes from fixed system locations, never PATH", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "ps-port-"));
    dirs.push(dir);
    return dir;
  };

  it("ignores a fake `ps` on PATH that prints a forged parent", async () => {
    const dir = scratch();
    writeFileSync(join(dir, "ps"), "#!/bin/sh\necho '99999 Mon Jan  1 00:00:00 2001'\n");
    chmodSync(join(dir, "ps"), 0o755);
    const port = createRealProcessTablePort({ env: { PATH: dir }, cwd: dir });
    expect(await port.parentOf(process.pid)).toBe(process.ppid);
  });

  it("a stub-only PATH still reads the table", async () => {
    const dir = scratch();
    const port = createRealProcessTablePort({ env: { PATH: dir }, cwd: dir });
    expect(await port.startTimeOf(process.pid)).not.toBeNull();
  });

  it("fails loud with the unreadable cause when no fixed ps exists (never falls back to PATH)", async () => {
    const dir = scratch();
    writeFileSync(join(dir, "ps"), "#!/bin/sh\necho '1 Mon Jan  1 00:00:00 2001'\n");
    chmodSync(join(dir, "ps"), 0o755);
    const port = createRealProcessTablePort({ env: { PATH: dir }, cwd: dir, psPaths: [join(dir, "absent", "ps")] });
    await expect(port.parentOf(process.pid)).rejects.toBeInstanceOf(ProcessTableUnreadableError);
    await expect(port.startTimeOf(process.pid)).rejects.toThrow(/process table unreadable/);
    expect((await port.snapshot()).ok).toBe(false);
  });

  it("an exited pid is gone (null), distinct from the unreadable table", async () => {
    const dir = scratch();
    const child = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
    const pid = child.pid as number;
    await new Promise((resolve) => child.on("exit", resolve));
    const port = createRealProcessTablePort({ env: process.env, cwd: dir });
    expect(await port.startTimeOf(pid)).toBeNull();
    expect(await port.parentOf(pid)).toBeNull();
  });
});

describe("real process-table port: an empty `ps` read is never 'no such process' (#418 flaky ps)", () => {
  type PortOptions = Parameters<typeof createRealProcessTablePort>[0];
  type Runner = NonNullable<PortOptions["spawn"]>;
  const empty = (): ReturnType<Runner> => ({ status: 0, stdout: "", stderr: "", pid: 1, output: [], signal: null });
  const realRun: Runner = (binary, args, options) => spawnSync(binary, [...args], options as never) as ReturnType<Runner>;
  /** Empty for the first `emptyReads` calls, then the real answer. */
  const flaky = (emptyReads: number): { runner: Runner; calls: () => number } => {
    let calls = 0;
    return { runner: (binary, args, options) => (++calls <= emptyReads ? empty() : realRun(binary, args, options)), calls: () => calls };
  };
  const port = (spawnFn: Runner) => createRealProcessTablePort({ env: process.env, cwd: tmpdir(), spawn: spawnFn });
  const runRow = (startTime: string | null): RunRow => ({
    id: "cc:S", registeredAt: T0, endedAt: null, endReason: null, parentRunId: null, agentRef: null,
    process: { pid: process.pid, startTime, worktree: null },
  });

  it("(a) one empty read then the real row: the walk reads the row, no refusal", async () => {
    expect(await port(flaky(1).runner).parentOf(process.pid)).toBe(process.ppid);
    expect(await port(flaky(2).runner).startTimeOf(process.pid)).not.toBeNull();
    const start = await port(realRun).startTimeOf(process.pid);
    const verify = await loadVerify();
    const verdict = await verify({ run: "cc:S", record: runRow(start), table: port(flaky(1).runner), selfPid: process.pid });
    expect(verdict.ok).toBe(true);
  });

  it("(b) empty on every attempt for a LIVE pid: process-table-unreadable, never 'exited'", async () => {
    const t = port(() => empty());
    await expect(t.parentOf(process.pid)).rejects.toBeInstanceOf(ProcessTableUnreadableError);
    await expect(t.startTimeOf(process.pid)).rejects.toBeInstanceOf(ProcessTableUnreadableError);
    await expect(t.inspect(process.pid)).rejects.toBeInstanceOf(ProcessTableUnreadableError);
    await expect(t.resolveHarnessPid(process.pid)).rejects.toBeInstanceOf(ProcessTableUnreadableError);
    const verify = await loadVerify();
    const verdict = await verify({ run: "cc:S", record: runRow(T0), table: t, selfPid: process.pid });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.cause).toBe("process-table-unreadable");
  });

  it("(b2) retries a bounded number of times (3 reads) before deciding", async () => {
    let calls = 0;
    const t = port(() => {
      calls++;
      return empty();
    });
    await expect(t.parentOf(process.pid)).rejects.toBeInstanceOf(ProcessTableUnreadableError);
    expect(calls).toBe(3);
  });

  it("(c) empty on every attempt for a DEAD pid: gone (null), i.e. 'has exited'", async () => {
    const child = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
    const pid = child.pid as number;
    await new Promise((resolve) => child.on("exit", resolve));
    const t = port(() => empty());
    expect(await t.parentOf(pid)).toBeNull();
    expect(await t.startTimeOf(pid)).toBeNull();
    expect(await t.inspect(pid)).toBeNull();
    expect(await t.resolveHarnessPid(pid)).toBeNull();
  });

  it("(d) a spawn that times out is process-table-unreadable (injected ETIMEDOUT)", async () => {
    const timedOut: Runner = () => ({
      status: null, stdout: "", stderr: "", pid: 1, output: [], signal: "SIGKILL",
      error: Object.assign(new Error("spawnSync ps ETIMEDOUT"), { code: "ETIMEDOUT" }),
    });
    const t = port(timedOut);
    await expect(t.parentOf(process.pid)).rejects.toBeInstanceOf(ProcessTableUnreadableError);
    await expect(t.inspect(process.pid)).rejects.toBeInstanceOf(ProcessTableUnreadableError);
    await expect(t.resolveHarnessPid(process.pid)).rejects.toBeInstanceOf(ProcessTableUnreadableError);
  });

  it("(d2) a hung ps binary is SIGKILLed at the timeout and reported unreadable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ps-hang-"));
    try {
      writeFileSync(join(dir, "ps"), "#!/bin/sh\nexec sleep 30\n");
      chmodSync(join(dir, "ps"), 0o755);
      const t = createRealProcessTablePort({ env: process.env, cwd: dir, psPaths: [join(dir, "ps")], timeoutMs: 300 });
      const began = Date.now();
      await expect(t.parentOf(process.pid)).rejects.toBeInstanceOf(ProcessTableUnreadableError);
      expect(Date.now() - began).toBeLessThan(10_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(e) `lore run register`'s measurement (resolveHarnessPid then inspect) survives a flaky first read", async () => {
    const f = flaky(1);
    const t = port(f.runner);
    const pid = await t.resolveHarnessPid(process.pid);
    expect(pid).not.toBeNull();
    const inspected = await t.inspect(pid as number);
    expect(inspected?.startTime).not.toBeNull();
  });
});
