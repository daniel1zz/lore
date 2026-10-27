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
import { describe, expect, it } from "vitest";

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
