/**
 * @spec_ref spec-lore-done-closes-a-commitless-task-through-an-audited-no
 *
 * The pure landing predicate and the evidence-counting rule, over a scripted {@link LandingGitFacts}. Coverage:
 * HAPPY (no-change, commits), NEGATIVE (tip not on main, dirty copy, rows that do not count), BOUNDARY (tip = start, no branch),
 * ERROR (unreadable branch / object, no recorded tip), STATE (the newest recorded tip is used only when the ref is gone).
 */
import { describe, expect, it } from "vitest";
import { countsAsLandedPass, landingOf, readMeasuredLanding, type FactResult, type LandingGitFacts } from "./landing.js";

const START = "a".repeat(40);
const TIP = "b".repeat(40);
const MAIN = "c".repeat(40);

const ok = <T>(value: T): FactResult<T> => ({ ok: true, value });

function facts(over: Partial<LandingGitFacts> & { onMain?: readonly string[]; refs?: Record<string, string>; dirty?: readonly string[] } = {}): LandingGitFacts {
  const onMain = new Set([START, MAIN, ...(over.onMain ?? [])]);
  const refs = over.refs ?? {};
  return {
    integrationBranch: () => ok("main"),
    integrationHead: () => ok(MAIN),
    isOnIntegration: (commit) => (commit.startsWith("dead") ? { ok: false, reason: "bad object" } : ok(onMain.has(commit))),
    isAncestor: (commit, of) => ok(commit === of),
    branchTip: (name) => ok(refs[name] ?? null),
    worktreeOfBranch: (name) => ok(name in refs ? `/wt/${name}` : null),
    pathExists: (path) => path.startsWith("/wt/"),
    isDirty: (path) => ok((over.dirty ?? []).includes(path)),
    headOf: () => ok(MAIN),
    isInsideBranchWorktree: () => ok(false),
    pathExistsInIntegration: () => ok(true),
    ...over,
  };
}

describe("landingOf", () => {
  it("HAPPY: a branch whose tip is its start is no-change", () => {
    const verdict = landingOf({ start_head: START, branches: ["b"], worktrees: [] }, facts({ refs: { b: START } }));
    expect(verdict).toMatchObject({ state: "landed", kind: "no-change", start_head: START, tip: START, integration_head: MAIN });
  });

  it("HAPPY: a tip on main that is not the start is commits, reached by any route", () => {
    const verdict = landingOf({ start_head: START, branches: ["b"], worktrees: [] }, facts({ refs: { b: TIP }, onMain: [TIP] }));
    expect(verdict).toMatchObject({ state: "landed", kind: "commits", tip: TIP });
  });

  it("NEGATIVE: a tip not on main refuses tip-not-on-main naming the branch", () => {
    const verdict = landingOf({ start_head: START, branches: ["b"], worktrees: [] }, facts({ refs: { b: TIP } }));
    expect(verdict).toMatchObject({ state: "not-landed", reason: "tip-not-on-main", branch: "b", tip: TIP });
  });

  it("NEGATIVE: an existing worktree with uncommitted work refuses uncommitted-work, before the tip is judged", () => {
    const verdict = landingOf({ start_head: START, branches: ["b"], worktrees: [] }, facts({ refs: { b: START }, dirty: ["/wt/b"] }));
    expect(verdict).toMatchObject({ state: "not-landed", reason: "uncommitted-work", dirty_paths_in: "/wt/b" });
  });

  it("BOUNDARY: a claim that named no branch and no worktree is no-change at its start", () => {
    expect(landingOf({ start_head: START, branches: [], worktrees: [] }, facts())).toMatchObject({ state: "landed", kind: "no-change", tip: START });
    expect(landingOf({ branches: [], worktrees: [] }, facts())).toMatchObject({ state: "landed", kind: "no-change", start_head: MAIN });
  });

  it("STATE: a gone branch is judged by its recorded end_tip, never by the start", () => {
    expect(landingOf({ start_head: START, branches: ["gone"], worktrees: [], end_tip: START }, facts())).toMatchObject({ state: "landed", kind: "no-change" });
    expect(landingOf({ start_head: START, branches: ["gone"], worktrees: [], end_tip: TIP }, facts())).toMatchObject({ state: "not-landed", reason: "tip-not-on-main" });
  });

  it("ERROR: a gone branch with no recorded tip is unmeasurable, naming release and re-claim", () => {
    const verdict = landingOf({ start_head: START, branches: ["gone"], worktrees: [] }, facts());
    expect(verdict.state).toBe("unmeasurable");
    expect(verdict.state === "unmeasurable" ? verdict.reason : "").toMatch(/release/);
  });

  it("ERROR: a tip object git cannot read is unmeasurable", () => {
    const verdict = landingOf({ start_head: START, branches: ["gone"], worktrees: [], end_tip: `dead${"0".repeat(36)}` }, facts());
    expect(verdict.state).toBe("unmeasurable");
  });

  it("ERROR: a claim with no recorded start is unmeasurable, never started at the tip", () => {
    expect(landingOf({ branches: ["b"], worktrees: [] }, facts({ refs: { b: TIP }, onMain: [TIP] })).state).toBe("unmeasurable");
  });

  it("ERROR: an unreadable integration branch is unmeasurable", () => {
    const verdict = landingOf({ start_head: START, branches: ["b"], worktrees: [] }, facts({ integrationBranch: () => ({ ok: false, reason: "no main" }) }));
    expect(verdict.state).toBe("unmeasurable");
  });
});

describe("countsAsLandedPass", () => {
  const row = (attestation: Record<string, unknown> | undefined, recorded_at = "2026-01-02T00:00:00.000Z") => ({
    result: "pass",
    recorded_at,
    ...(attestation !== undefined ? { attestation } : {}),
  });
  const branch = { mode: "branch" as const, latestClaimAt: "2026-01-01T00:00:00.000Z", tip: TIP };

  it("HAPPY: a clean pass at a commit on main after the latest claim counts", () => {
    expect(countsAsLandedPass(row({ head_sha: START }), branch, facts())).toBe(true);
  });

  it("HAPPY: a pass at the branch's own tip counts for the branch claim (the not-landed floor judges the tip)", () => {
    expect(countsAsLandedPass(row({ head_sha: TIP }), branch, facts({ isAncestor: (c, of) => ok(c === of) }))).toBe(true);
  });

  it("NEGATIVE: a pass with no head, a dirty pass, a pass at a head on neither main nor the tip, and an unattested pass do not count", () => {
    expect(countsAsLandedPass(row({}), branch, facts())).toBe(false);
    expect(countsAsLandedPass(row({ head_sha: START, worktree_dirty: true }), branch, facts())).toBe(false);
    expect(countsAsLandedPass(row({ head_sha: "9".repeat(40) }), branch, facts())).toBe(false);
    expect(countsAsLandedPass(row(undefined), branch, facts())).toBe(false);
    expect(countsAsLandedPass({ result: "fail", recorded_at: "2026-01-02T00:00:00.000Z", attestation: { head_sha: START } }, branch, facts())).toBe(false);
  });

  it("NEGATIVE: a pass recorded before the latest claim does not count, even clean at a main commit", () => {
    expect(countsAsLandedPass(row({ head_sha: START }, "2025-12-31T00:00:00.000Z"), branch, facts())).toBe(false);
  });

  it("no-branch: counts only when head_sha equals the main_head recorded with it", () => {
    const ctx = { mode: "no-branch" as const };
    expect(countsAsLandedPass(row({ head_sha: MAIN, main_head: MAIN }), ctx, facts())).toBe(true);
    expect(countsAsLandedPass(row({ head_sha: START, main_head: MAIN }), ctx, facts())).toBe(false);
    expect(countsAsLandedPass(row({ head_sha: MAIN }), ctx, facts())).toBe(false);
  });

  it("unclaimed: the attestation alone decides", () => {
    expect(countsAsLandedPass(row({}), { mode: "unclaimed" }, facts())).toBe(true);
  });
});

describe("readMeasuredLanding", () => {
  it("reads a complete record and ignores an incomplete one", () => {
    const full = { kind: "commits", start_head: START, tip: TIP, integration_head: MAIN, measured_at: "t", branch: "b" };
    expect(readMeasuredLanding({ landing: full })).toMatchObject({ kind: "commits", tip: TIP });
    expect(readMeasuredLanding({ landing: { kind: "commits" } })).toBeUndefined();
    expect(readMeasuredLanding({})).toBeUndefined();
  });
});
