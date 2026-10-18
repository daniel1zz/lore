/**
 * @spec_ref spec-one-worktree-removal-test-for-the-guard-lore-done-and-a (D1, D2, D4; BR-1079)
 * @task task-single-worktree-removal-test-used-by-the-hook-lore-done
 *
 * `WorktreeRemovalService` over FAKE ports (git probe, process scan, run occupancy, run store): fact measurement,
 * caller-session ownership, the sweep (dry run vs --apply, hint), and the not-measured discipline.
 *
 * HAPPY / NEGATIVE / ERROR (every port failing -> not-measured) / STATE (session main run liveness) / BOUNDARY
 * (dry run touches nothing; main checkout never a sweep row) / REGRESSION (never forced, branch -d only)
 */

import { describe, expect, it } from "vitest";
import { err, ok, type LoreError, type Result, type RunRecord } from "@lore/core";
import {
  WorktreeRemovalService,
  type OccupancyData,
  type RunOccupancyPort,
  type WorktreeRemovalRunStore,
} from "../../../src/service/worktree-removal-service.js";
import type { ListedWorktree, ProbeResult, WorktreeGitProbe } from "../../../src/service/worktree-cleanup.js";
import { DecisionService } from "../../../src/service/decision-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type { ProcessScanPort } from "../../../src/adapters/real-process-scan-port.js";

const REPO = "/repo";
const WT = "/wt/agent-AAA";

interface World {
  listed: ProbeResult<readonly ListedWorktree[]>;
  exists: boolean;
  dirty: ProbeResult<boolean>;
  ahead: ProbeResult<number>;
  integration: ProbeResult<string>;
  cwd: string;
  occupancy: Result<OccupancyData, LoreError>;
  scan: ReturnType<ProcessScanPort["processesInside"]>;
  runs: Record<string, { sessionRef: string; harness: string }>;
  runEnds: Record<string, string | null>; // run id -> endedAt; absent = unregistered
  calls: string[];
  removeOk: boolean;
}

const occupancyOf = (over: Partial<OccupancyData> = {}): OccupancyData => ({
  worktree: WT,
  agent_run: { id: "cc:S1:AAA", ended: true, parent_ended: false },
  open_claims: [],
  occupied: false,
  ...over,
});

function build(over: Partial<World> = {}): { service: WorktreeRemovalService; world: World } {
  const world: World = {
    listed: {
      ok: true,
      value: [
        { path: REPO, branch: "main", locked: false },
        { path: WT, branch: "agent-AAA", locked: false },
      ],
    },
    exists: true,
    dirty: { ok: true, value: false },
    ahead: { ok: true, value: 0 },
    integration: { ok: true, value: "main" },
    cwd: REPO,
    occupancy: ok(occupancyOf()),
    scan: { ok: true, value: [] },
    runs: { "cc:S1:AAA": { sessionRef: "S1", harness: "claude-code" } },
    runEnds: { "cc:S1": null, "cc:S1:AAA": "2026-10-12T00:00:00Z" },
    calls: [],
    removeOk: true,
    ...over,
  };
  const probe: WorktreeGitProbe = {
    pathExists: () => world.exists,
    realPath: (p) => p,
    currentWorkingDirectory: () => world.cwd,
    listWorktrees: () => world.listed,
    isDirty: () => world.dirty,
    countCommits: (_cwd, range) => {
      world.calls.push(`count ${range}`);
      return world.ahead;
    },
    integrationBranch: () => world.integration,
    headSha: () => ({ ok: true, value: "abc" }),
    branchTip: () => ({ ok: true, value: "abc" }),
    removeWorktree: (root, p) => {
      world.calls.push(`remove ${root} ${p}`);
      return world.removeOk ? { ok: true, value: true } : { ok: false, reason: "refused" };
    },
    deleteBranch: (root, b) => {
      world.calls.push(`branch -d ${root} ${b}`);
      return { ok: true, value: true };
    },
    ignoredPaths: () => ({ ok: true, value: [] }),
    scratchOwner: () => ({ ok: true, value: null }),
    isPidAlive: () => false,
    removeScratchWorktree: () => ({ ok: true, value: true }),
  };
  const processScan: ProcessScanPort = { processesInside: () => world.scan };
  const occupancy: RunOccupancyPort = { occupancy: async () => world.occupancy };
  const runs = {
    getRun: async (id: string) =>
      ok(
        world.runs[id] === undefined
          ? null
          : ({ id, sessionRef: world.runs[id].sessionRef, harness: world.runs[id].harness } as unknown as RunRecord),
      ),
    getRunEnd: async (id: string) => ok(id in world.runEnds ? { endedAt: world.runEnds[id] ?? null } : null),
  } as unknown as WorktreeRemovalRunStore;
  return { service: new WorktreeRemovalService({ probe, processScan, occupancy, runs, decisions: new DecisionService({ store: new InMemoryStore(), executorRun: null }) }), world };
}

describe("WorktreeRemovalService.check", () => {
  it("HAPPY: own stopped agent -> removable, owner reported mine", async () => {
    const { service } = build();
    const check = await service.check(WT, "S1");
    expect(check).toMatchObject({ verdict: "removable", reasons: [], owner: { run_id: "cc:S1:AAA", session: "S1", mine: true } });
  });

  it("NEGATIVE: another live session -> foreign-live-session; that session ended -> removable", async () => {
    const live = build();
    expect((await live.service.check(WT, "S9")).reasons).toEqual(["foreign-live-session"]);
    const ended = build({ runEnds: { "cc:S1": "2026-10-12T00:00:00Z", "cc:S1:AAA": "2026-10-12T00:00:00Z" } });
    expect((await ended.service.check(WT, "S9")).verdict).toBe("removable");
  });

  it("STATE: an unknown caller session (null) is never the owner", async () => {
    const { service } = build();
    const check = await service.check(WT, null);
    expect(check.owner?.mine).toBe(false);
    expect(check.reasons).toEqual(["foreign-live-session"]);
  });

  it("NEGATIVE: live owning run, an open claim, a process inside, dirty, unmerged, locked and caller-inside each keep with their token", async () => {
    expect((await build({ occupancy: ok(occupancyOf({ agent_run: { id: "cc:S1:AAA", ended: false, parent_ended: false }, occupied: true })) }).service.check(WT, "S1")).reasons).toEqual(["run-not-ended"]);
    expect(
      (await build({ occupancy: ok(occupancyOf({ open_claims: [{ task_slug: "t", run_id: null, run_ended: null }], occupied: true })) }).service.check(WT, "S1")).reasons,
    ).toEqual(["open-claim"]);
    expect((await build({ scan: { ok: true, value: [{ pid: 9, command: "vim" }] } }).service.check(WT, "S1")).reasons).toEqual(["process-inside"]);
    expect((await build({ dirty: { ok: true, value: true } }).service.check(WT, "S1")).reasons).toEqual(["uncommitted-changes"]);
    expect((await build({ ahead: { ok: true, value: 2 } }).service.check(WT, "S1")).reasons).toEqual(["unmerged-commits"]);
    const lockedList = { ok: true, value: [{ path: REPO, branch: "main", locked: false }, { path: WT, branch: "agent-AAA", locked: true }] } as const;
    expect((await build({ listed: lockedList }).service.check(WT, "S1")).reasons).toEqual(["locked"]);
    expect((await build({ cwd: `${WT}/sub` }).service.check(WT, "S1")).reasons).toEqual(["caller-inside"]);
  });

  it("an earlier run of the same agent being live (occupied with no live owning run and no claim) is run-not-ended", async () => {
    const { service } = build({ occupancy: ok(occupancyOf({ occupied: true })) });
    expect((await service.check(WT, "S1")).reasons).toEqual(["run-not-ended"]);
  });

  it("the main checkout is kept: main-checkout", async () => {
    const { service } = build();
    expect((await service.check(REPO, "S1")).reasons).toContain("main-checkout");
  });

  it("ERROR: failing ports are not-measured, never removable (path missing, git list, occupancy, scan, store, integration branch)", async () => {
    const storeDown: LoreError = { code: "STORE_ERROR", message: "down" };
    const cases: Partial<World>[] = [
      { exists: false },
      { listed: { ok: false, reason: "not a repo" } },
      { occupancy: err(storeDown) },
      { scan: { ok: false, reason: "no lsof and no /proc" } },
      { integration: { ok: false, reason: "no main" } },
      { dirty: { ok: false, reason: "status failed" } },
      { runs: {} }, // owning run id unknown to the store
    ];
    for (const over of cases) {
      const check = await build(over).service.check(WT, "S1");
      expect(check.verdict, JSON.stringify(Object.keys(over))).toBe("not-measured");
    }
  });

  it("ERROR: a foreign owner whose session main run is unregistered is not-measured", async () => {
    const { service } = build({ runEnds: { "cc:S1:AAA": "2026-10-12T00:00:00Z" } });
    const check = await service.check(WT, "S9");
    expect(check.verdict).toBe("not-measured");
    expect(check.owner?.session_ended).toBeNull();
  });

  it("no owning run (hand-made worktree) -> removable with owner null", async () => {
    const { service } = build({ occupancy: ok(occupancyOf({ agent_run: null })) });
    expect(await service.check(WT, "S9")).toMatchObject({ verdict: "removable", owner: null });
  });
});

describe("WorktreeRemovalService.sweep", () => {
  it("BOUNDARY: a dry run lists linked worktrees only and removes nothing", async () => {
    const { service, world } = build();
    const result = await service.sweep({ apply: false, callerSession: "S1", cwd: REPO });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((row) => row.path)).toEqual([WT]);
    expect(result.value[0]?.verdict).toBe("removable");
    expect(world.calls.some((call) => call.startsWith("remove") || call.startsWith("branch"))).toBe(false);
  });

  it("--apply removes exactly the removable worktree with plain remove then branch -d from the main checkout", async () => {
    const { service, world } = build();
    const result = await service.sweep({ apply: true, callerSession: "S1", cwd: REPO });
    expect(result.ok && result.value[0]?.removed).toBe(true);
    expect(world.calls.filter((c) => !c.startsWith("count"))).toEqual([`remove ${REPO} ${WT}`, `branch -d ${REPO} agent-AAA`]);
  });

  it("--apply keeps a non-removable worktree untouched; a refused removal is reported, not swallowed", async () => {
    const kept = build({ dirty: { ok: true, value: true } });
    const keptRes = await kept.service.sweep({ apply: true, callerSession: "S1", cwd: REPO });
    expect(keptRes.ok && keptRes.value[0]?.removed).toBeUndefined();
    expect(kept.world.calls.some((c) => c.startsWith("remove"))).toBe(false);
    const refused = build({ removeOk: false });
    const refusedRes = await refused.service.sweep({ apply: true, callerSession: "S1", cwd: REPO });
    expect(refusedRes.ok && refusedRes.value[0]).toMatchObject({ removed: false, error: "remove-failed: refused" });
    expect(refused.world.calls.some((c) => c.startsWith("branch -d"))).toBe(false);
  });

  it("D4: a worktree kept ONLY because its owning run has no end carries a `lore run end` hint; a foreign live session's does not", async () => {
    const live = occupancyOf({ agent_run: { id: "cc:S1:AAA", ended: false, parent_ended: false }, occupied: true });
    const own = build({ occupancy: ok(live) });
    const ownRes = await own.service.sweep({ apply: false, callerSession: "S1", cwd: REPO });
    expect(ownRes.ok && ownRes.value[0]?.hint).toContain('lore run end cc:S1:AAA --reason "<why>"');
    const foreign = build({ occupancy: ok(live) });
    const foreignRes = await foreign.service.sweep({ apply: false, callerSession: "S9", cwd: REPO });
    expect(foreignRes.ok && foreignRes.value[0]?.hint).toBeUndefined();
  });

  it("ERROR: sweep outside a git repository is a VALIDATION_ERROR", async () => {
    const { service } = build({ listed: { ok: false, reason: "not a git repository" } });
    const result = await service.sweep({ apply: false, callerSession: "S1", cwd: "/nowhere" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});
