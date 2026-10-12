/**
 * @spec_ref spec-lore-owns-worktree-cleanup-archive-removes-the-task-s AC-WTC-1 AC-WTC-2
 * @task task-implement-106-make-ac-wtc-1-ac-wtc-2-ac-wtc-3-green
 *
 * Unit coverage for `service/worktree-cleanup.ts` over a FAKE probe: the pure decision (every clause,
 * boundary of the quiet window), quiet-minutes parsing, claim-history collection, the not-measured
 * discipline (a failing git call is never `remove`), and removal ordering (plain remove then branch -d).
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
  parseQuietMinutes,
  type ListedWorktree,
  type ProbeResult,
  type WorktreeFacts,
  type WorktreeGitProbe,
} from "../../../src/service/worktree-cleanup.js";

const NOW = 1_000_000;

const measured = (over: Partial<Extract<WorktreeFacts, { kind: "measured" }>> = {}): WorktreeFacts => ({
  kind: "measured",
  locked: false,
  dirty: false,
  ownCommitCount: 2,
  unmergedCount: 0,
  newestReflogEpochSeconds: NOW - 3600,
  ...over,
});

describe("decideWorktreeCleanup (pure)", () => {
  it("removes when every clause holds", () => {
    expect(decideWorktreeCleanup(measured(), 30, NOW).decision).toBe("remove");
  });

  it.each([
    ["locked", measured({ locked: true }), "locked"],
    ["dirty", measured({ dirty: true }), "uncommitted-changes"],
    ["zero own commits", measured({ ownCommitCount: 0 }), "no-own-commits"],
    ["unmerged", measured({ unmergedCount: 1 }), "unmerged-commits"],
    ["recent", measured({ newestReflogEpochSeconds: NOW - 60 }), "recent-activity"],
  ] as const)("keeps with a reason token: %s", (_name, facts, token) => {
    const d = decideWorktreeCleanup(facts, 30, NOW);
    expect(d.decision).toBe("keep");
    expect(d.reason).toContain(token);
  });

  it("lists every failing clause, and does not report unmerged-commits when there are no own commits", () => {
    const d = decideWorktreeCleanup(measured({ dirty: true, ownCommitCount: 0, unmergedCount: 5 }), 30, NOW);
    expect(d.reason).toBe("uncommitted-changes, no-own-commits");
  });

  it("quiet window boundary: exactly N minutes old is quiet; one second younger is recent; N=0 never blocks", () => {
    expect(decideWorktreeCleanup(measured({ newestReflogEpochSeconds: NOW - 1800 }), 30, NOW).decision).toBe("remove");
    expect(decideWorktreeCleanup(measured({ newestReflogEpochSeconds: NOW - 1799 }), 30, NOW).reason).toContain("recent-activity");
    expect(decideWorktreeCleanup(measured({ newestReflogEpochSeconds: NOW }), 0, NOW).decision).toBe("remove");
  });

  it("non-measured facts map to their own decisions, never remove", () => {
    expect(decideWorktreeCleanup({ kind: "gone" }, 30, NOW).decision).toBe("gone");
    expect(decideWorktreeCleanup({ kind: "not-measured", reason: "boom" }, 30, NOW)).toEqual({ decision: "not-measured", reason: "boom" });
    for (const kind of ["main-checkout", "claimed-by-active-task", "cwd-inside-worktree"] as const) {
      expect(decideWorktreeCleanup({ kind }, 30, NOW)).toEqual({ decision: "keep", reason: kind });
    }
  });
});

describe("parseQuietMinutes", () => {
  it("defaults to 30, accepts 0 and integers, refuses everything else loudly", () => {
    expect(parseQuietMinutes(undefined)).toEqual({ ok: true, value: 30 });
    expect(parseQuietMinutes("0")).toEqual({ ok: true, value: 0 });
    expect(parseQuietMinutes("45")).toEqual({ ok: true, value: 45 });
    for (const bad of ["", "soon", "-1", "1.5"]) {
      const r = parseQuietMinutes(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("VALIDATION_ERROR");
    }
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
  unmerged: ProbeResult<number>;
  reflog: ProbeResult<number>;
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
    unmerged: { ok: true, value: 0 },
    reflog: { ok: true, value: NOW - 7200 },
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
    countCommits: (_cwd, range) => (range.startsWith("main..") ? state.unmerged : state.own),
    newestReflogEpochSeconds: () => state.reflog,
    headSha: () => ({ ok: true, value: "abc" }),
    branchTip: () => ({ ok: true, value: "abc" }),
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

const ctx = (active: ReadonlySet<string> = new Set()) => ({ quietMinutes: 30, nowEpochSeconds: NOW, activeClaimedPaths: active });
const rec = { path: "/wt/a", baseSha: "base" };

describe("evaluateRecordedWorktree (fake probe)", () => {
  it("remove for a fully eligible worktree, carrying repoRoot + branch", () => {
    const { probe } = fakeProbe();
    const e = evaluateRecordedWorktree(probe, rec, ctx());
    expect(e).toMatchObject({ decision: "remove", repoRoot: "/repo", branch: "feat" });
  });

  it("gone when the path is missing", () => {
    expect(evaluateRecordedWorktree(fakeProbe({ exists: false }).probe, rec, ctx()).decision).toBe("gone");
  });

  it("not-measured (never remove) when the claim recorded no base", () => {
    const e = evaluateRecordedWorktree(fakeProbe().probe, { path: "/wt/a", baseSha: undefined }, ctx());
    expect(e.decision).toBe("not-measured");
    expect(e.reason).toContain("no claim-time base");
  });

  const failed = { ok: false, reason: "x" } as const;
  it.each<[string, Partial<FakeState>]>([
    ["listing fails", { listed: failed }],
    ["status fails", { dirty: failed }],
    ["own-count fails", { own: failed }],
    ["merged check fails", { unmerged: failed }],
    ["reflog fails", { reflog: failed }],
  ])("not-measured when a git call fails: %s", (_n, over) => {
    expect(evaluateRecordedWorktree(fakeProbe(over).probe, rec, ctx()).decision).toBe("not-measured");
  });

  it("not-measured when the path is not a listed worktree (a plain directory)", () => {
    const listed = { ok: true, value: [{ path: "/repo", branch: "main", locked: false }] } as const;
    expect(evaluateRecordedWorktree(fakeProbe({ listed }).probe, rec, ctx()).reason).toContain("not a linked worktree");
  });

  it("keeps the main checkout, a detached worktree is not-measured", () => {
    expect(evaluateRecordedWorktree(fakeProbe().probe, { path: "/repo", baseSha: "b" }, ctx()).reason).toBe("main-checkout");
    const listed = { ok: true, value: [{ path: "/repo", branch: "main", locked: false }, { path: "/wt/a", branch: undefined, locked: false }] } as const;
    expect(evaluateRecordedWorktree(fakeProbe({ listed }).probe, rec, ctx()).decision).toBe("not-measured");
  });

  it("keeps a worktree still claimed by an active task", () => {
    const { probe } = fakeProbe();
    const active = buildActiveClaimedPathSet(probe, ["/wt/a"]);
    expect(evaluateRecordedWorktree(probe, rec, ctx(active)).reason).toBe("claimed-by-active-task");
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
