/**
 * @spec_ref spec-lore-owns-worktree-cleanup-archive-removes-the-task-s AC-WTC-1 AC-WTC-2
 * @task task-implement-106-make-ac-wtc-1-ac-wtc-2-ac-wtc-3-green
 *
 * Unit coverage for `service/worktree-cleanup.ts` over a FAKE probe and a FAKE removal-facts port: the pure decision
 * (every clause), claim-history collection, the not-measured discipline (a failing git call is never `remove`), and
 * removal ordering (plain remove then branch -d).
 *
 * RE-BASELINE (task-single-worktree-removal-test-used-by-the-hook-lore-done, AC-WS-5): the quiet window
 * (`recent-activity`, `parseQuietMinutes`, reflog age) is deleted — the removal clauses now come from the single
 * `decideWorktreeRemoval` (covered by worktree-removal-test.test.ts); only the clauses `lore done` adds itself
 * (own commits, claim-time base, active claim, branch) are asserted here, plus that the single test's verdict flows through.
 */

import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@lore/core";
import {
  applyWorktreeRemoval,
  buildActiveClaimedPathSet,
  collectRecordedWorktrees,
  decideWorktreeCleanup,
  evaluateRecordedWorktree,
  formatWorktreeOutcomeLine,
  type ListedWorktree,
  type ProbeResult,
  type RecordedWorktree,
  type WorktreeFacts,
  type WorktreeGitProbe,
} from "../../../src/service/worktree-cleanup.js";
import type { Measured, WorktreeRemovalFacts, WorktreeRemovalFactsPort } from "../../../src/service/worktree-removal-test.js";

const ok = <T,>(value: T): Measured<T> => ({ ok: true, value });

const removableFacts = (over: Partial<WorktreeRemovalFacts> = {}): WorktreeRemovalFacts => ({
  linked: ok(true),
  callerInside: ok(false),
  dirty: ok(false),
  unmerged: ok(false),
  locked: ok(false),
  agentRunLive: ok(false),
  openClaims: ok([]),
  processesInside: ok([]),
  owner: ok(null),
  ...over,
});

const measured = (
  over: { removal?: Partial<WorktreeRemovalFacts>; ownCommitCount?: Measured<number> } = {},
): WorktreeFacts => ({
  kind: "measured",
  removal: removableFacts(over.removal),
  ownCommitCount: over.ownCommitCount ?? ok(2),
});

describe("decideWorktreeCleanup (pure)", () => {
  it("removes when the removal test says removable and the branch has own commits", () => {
    expect(decideWorktreeCleanup(measured())).toEqual({ decision: "remove", reason: "clean, merged, unoccupied" });
  });

  it.each([
    ["locked", measured({ removal: { locked: ok(true) } }), "locked"],
    ["dirty", measured({ removal: { dirty: ok(true) } }), "uncommitted-changes"],
    ["zero own commits", measured({ ownCommitCount: ok(0) }), "no-own-commits"],
    ["unmerged", measured({ removal: { unmerged: ok(true) } }), "unmerged-commits"],
    ["owning run not ended", measured({ removal: { agentRunLive: ok(true) } }), "run-not-ended"],
    ["main checkout", measured({ removal: { linked: ok(false) } }), "main-checkout"],
    ["caller inside", measured({ removal: { callerInside: ok(true) } }), "caller-inside"],
  ] as const)("keeps with a reason token: %s", (_name, facts, token) => {
    const d = decideWorktreeCleanup(facts);
    expect(d.decision).toBe("keep");
    expect(d.reason).toContain(token);
  });

  it("lists every failing clause: the removal test's tokens, then no-own-commits", () => {
    const d = decideWorktreeCleanup(measured({ removal: { dirty: ok(true) }, ownCommitCount: ok(0) }));
    expect(d.reason).toBe("uncommitted-changes, no-own-commits");
  });

  it("a measured fact set carries no time value: nothing recent can keep a worktree", () => {
    expect(JSON.stringify(measured())).not.toMatch(/reflog|epoch|recent|quiet/i);
  });

  it("an unmeasurable removal clause or own-commit count is not-measured, never remove; a proven keep outranks it", () => {
    const processes = decideWorktreeCleanup(measured({ removal: { processesInside: { ok: false, reason: "no lsof" } } }));
    expect(processes.decision).toBe("not-measured");
    expect(processes.reason).toContain("processes-not-measured");
    const base = decideWorktreeCleanup(measured({ ownCommitCount: { ok: false, reason: "no claim-time base" } }));
    expect(base).toEqual({ decision: "not-measured", reason: "no claim-time base" });
    const both = decideWorktreeCleanup(measured({ removal: { dirty: ok(true) }, ownCommitCount: { ok: false, reason: "x" } }));
    expect(both).toEqual({ decision: "keep", reason: "uncommitted-changes" });
  });

  it("non-measured facts map to their own decisions, never remove", () => {
    expect(decideWorktreeCleanup({ kind: "gone" }).decision).toBe("gone");
    expect(decideWorktreeCleanup({ kind: "not-measured", reason: "boom" })).toEqual({ decision: "not-measured", reason: "boom" });
    expect(decideWorktreeCleanup({ kind: "claimed-by-active-task" })).toEqual({ decision: "keep", reason: "claimed-by-active-task" });
  });
});

describe("collectRecordedWorktrees", () => {
  const row = (timestamp: string, details: Record<string, unknown>): AuditEntry => ({
    timestamp,
    actor: "a",
    session_id: "s",
    action: "claim",
    details,
  });

  it("keeps the EARLIEST base per path, includes the current claim path, skips rows without a worktree", () => {
    const rows = [
      row("2026-01-02T00:00:00Z", { worktree: "/wt/a", base_sha: "late" }),
      row("2026-01-01T00:00:00Z", { worktree: "/wt/a", base_sha: "early" }),
      row("2026-01-03T00:00:00Z", { by: "x" }),
    ];
    expect(collectRecordedWorktrees(rows, "/wt/b")).toEqual([
      { path: "/wt/a", baseSha: "early" },
      { path: "/wt/b", baseSha: undefined },
    ]);
  });

  it("returns [] when nothing was recorded", () => {
    expect(collectRecordedWorktrees([], undefined)).toEqual([]);
  });
});

interface FakeState {
  exists: boolean;
  listed: ProbeResult<readonly ListedWorktree[]>;
  dirty: ProbeResult<boolean>;
  own: ProbeResult<number>;
  removal: WorktreeRemovalFacts;
  removeOk: boolean;
  branchOk: boolean;
  calls: string[];
}

function fakeProbe(over: Partial<FakeState> = {}): { probe: WorktreeGitProbe; state: FakeState } {
  const state: FakeState = {
    exists: true,
    listed: { ok: true, value: [{ path: "/repo", branch: "main", locked: false }, { path: "/wt/a", branch: "feat", locked: false }] },
    dirty: { ok: true, value: false },
    own: { ok: true, value: 1 },
    removal: removableFacts(),
    removeOk: true,
    branchOk: true,
    calls: [],
    ...over,
  };
  const probe: WorktreeGitProbe = {
    pathExists: () => state.exists,
    realPath: (p) => p,
    currentWorkingDirectory: () => "/repo",
    listWorktrees: () => state.listed,
    isDirty: () => state.dirty,
    countCommits: () => state.own,
    integrationBranch: () => ({ ok: true, value: "main" }),
    headSha: () => ({ ok: true, value: "abc" }),
    removeWorktree: (root, p) => {
      state.calls.push(`remove ${root} ${p}`);
      return state.removeOk ? { ok: true, value: true } : { ok: false, reason: "dirty" };
    },
    deleteBranch: (root, b) => {
      state.calls.push(`branch -d ${root} ${b}`);
      return state.branchOk ? { ok: true, value: true } : { ok: false, reason: "not fully merged" };
    },
  };
  return { probe, state };
}

const ctx = (active: ReadonlySet<string> = new Set()) => ({ callerSession: "S1", activeClaimedPaths: active });
const portFor = (state: FakeState): WorktreeRemovalFactsPort & { asked: [string, string | null][] } => {
  const asked: [string, string | null][] = [];
  return {
    asked,
    gatherRemovalFacts: async (path, session) => {
      asked.push([path, session]);
      return state.removal;
    },
  };
};
const rec = { path: "/wt/a", baseSha: "base" };

describe("evaluateRecordedWorktree (fake probe + fake removal facts)", () => {
  const evaluate = (over: Partial<FakeState>, recorded: RecordedWorktree = rec, active: ReadonlySet<string> = new Set()) => {
    const { probe, state } = fakeProbe(over);
    const port = portFor(state);
    return evaluateRecordedWorktree(probe, port, recorded, ctx(active)).then((e) => ({ e, port }));
  };

  it("remove for a fully eligible worktree, carrying repoRoot + branch; the caller session reaches the removal port", async () => {
    const { e, port } = await evaluate({});
    expect(e).toMatchObject({ decision: "remove", repoRoot: "/repo", branch: "feat" });
    expect(port.asked).toEqual([["/wt/a", "S1"]]);
  });

  it("gone when the path is missing (the removal port is never asked)", async () => {
    const { e, port } = await evaluate({ exists: false });
    expect(e.decision).toBe("gone");
    expect(port.asked).toEqual([]);
  });

  it("not-measured (never remove) when the claim recorded no base", async () => {
    const { e } = await evaluate({}, { path: "/wt/a", baseSha: undefined });
    expect(e.decision).toBe("not-measured");
    expect(e.reason).toContain("no claim-time base");
  });

  const failed = { ok: false, reason: "x" } as const;
  it.each<[string, Partial<FakeState>]>([
    ["listing fails", { listed: failed }],
    ["own-count fails", { own: failed }],
    ["a removal clause is unmeasurable", { removal: removableFacts({ dirty: failed }) }],
  ])("not-measured when a measurement fails: %s", async (_n, over) => {
    expect((await evaluate(over)).e.decision).toBe("not-measured");
  });

  it("the single test's keep verdict flows through (owning run not ended)", async () => {
    const { e } = await evaluate({ removal: removableFacts({ agentRunLive: ok(true) }) });
    expect(e).toMatchObject({ decision: "keep", reason: "run-not-ended" });
    expect(e.repoRoot).toBeUndefined();
  });

  it("not-measured when the path is not a listed worktree (a plain directory)", async () => {
    const listed = { ok: true, value: [{ path: "/repo", branch: "main", locked: false }] } as const;
    expect((await evaluate({ listed })).e.reason).toContain("not a linked worktree");
  });

  it("the main checkout is kept by the removal test's token; a detached worktree is not-measured", async () => {
    const main = await evaluate({ removal: removableFacts({ linked: ok(false) }) }, { path: "/repo", baseSha: "b" });
    expect(main.e).toMatchObject({ decision: "keep", reason: "main-checkout" });
    const listed = { ok: true, value: [{ path: "/repo", branch: "main", locked: false }, { path: "/wt/a", branch: undefined, locked: false }] } as const;
    expect((await evaluate({ listed })).e.decision).toBe("not-measured");
  });

  it("keeps a worktree still claimed by an active task", async () => {
    const { probe } = fakeProbe();
    const active = buildActiveClaimedPathSet(probe, ["/wt/a"]);
    expect((await evaluate({}, rec, active)).e.reason).toBe("claimed-by-active-task");
  });
});

describe("applyWorktreeRemoval", () => {
  const removeEval = { worktree: "/wt/a", decision: "remove" as const, reason: "ok", repoRoot: "/repo", branch: "feat" };

  it("removes the worktree first, then deletes the branch with -d, from the main checkout", () => {
    const { probe, state } = fakeProbe();
    expect(applyWorktreeRemoval(probe, removeEval)).toEqual({ worktree: "/wt/a", decision: "remove", reason: "removed" });
    expect(state.calls).toEqual(["remove /repo /wt/a", "branch -d /repo feat"]);
  });

  it("a failed worktree removal is not-measured and the branch is left alone", () => {
    const { probe, state } = fakeProbe({ removeOk: false });
    const o = applyWorktreeRemoval(probe, removeEval);
    expect(o.decision).toBe("not-measured");
    expect(o.reason).toContain("remove-failed");
    expect(state.calls).toEqual(["remove /repo /wt/a"]);
  });

  it("a failed branch delete after a successful removal is still reported (visible, not swallowed)", () => {
    const o = applyWorktreeRemoval(fakeProbe({ branchOk: false }).probe, removeEval);
    expect(o.decision).toBe("remove");
    expect(o.reason).toContain("branch feat kept");
  });

  it("never acts on a non-remove evaluation", () => {
    const { probe, state } = fakeProbe();
    applyWorktreeRemoval(probe, { worktree: "/wt/a", decision: "keep", reason: "locked" });
    expect(state.calls).toEqual([]);
  });
});

describe("formatWorktreeOutcomeLine", () => {
  it("renders the four line shapes", () => {
    expect(formatWorktreeOutcomeLine({ worktree: "/w", decision: "remove", reason: "removed" })).toBe("worktree: removed /w");
    expect(formatWorktreeOutcomeLine({ worktree: "/w", decision: "keep", reason: "locked" })).toBe("worktree: kept /w: locked");
    expect(formatWorktreeOutcomeLine({ worktree: "/w", decision: "not-measured", reason: "x" })).toBe("worktree: not-measured /w: x");
    expect(formatWorktreeOutcomeLine({ worktree: "/w", decision: "gone", reason: "path does not exist" })).toBe("worktree: gone /w");
  });
});
