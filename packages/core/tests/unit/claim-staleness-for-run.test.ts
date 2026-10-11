/**
 * @spec_ref spec-run-only-write-identity-and-run-end-claim-release (Scope 5; AC-ROI-5; BR-1058)
 *
 * `isClaimStaleForRun` — the pure staleness rule that reads the holder run's end and an `orphaned_dirty` mark.
 * Truth table, one row per case; `worktreeClean: null` is "not measured" and must NEVER behave like clean.
 */

import { describe, expect, it } from "vitest";
import { isClaimStaleForRun, type TaskClaim } from "../../src/task-workflow.js";

const TTL = 120;
const NOW = "2026-10-11T12:00:00.000Z";
const FRESH: TaskClaim = { by: "a", at: "2026-10-11T11:59:00.000Z", harness_run: "cc:r" };
const OLD: TaskClaim = { by: "a", at: "2026-10-11T08:00:00.000Z", harness_run: "cc:r" };
const orphaned = (base: TaskClaim): TaskClaim => ({ ...base, orphaned_dirty: { worktree: "/wt", at: base.at } });

describe("isClaimStaleForRun", () => {
  it("HAPPY: an ended run with a MEASURED clean worktree is stale at once, however young the claim", () => {
    expect(isClaimStaleForRun(FRESH, NOW, TTL, { runEnded: true, worktreeClean: true })).toBe(true);
  });

  it("NEGATIVE: an ended run whose worktree is dirty is NOT stale while young", () => {
    expect(isClaimStaleForRun(FRESH, NOW, TTL, { runEnded: true, worktreeClean: false })).toBe(false);
  });

  it("NEGATIVE: an ended run whose worktree was not measured is not stale while young (not-measured is never clean)", () => {
    expect(isClaimStaleForRun(FRESH, NOW, TTL, { runEnded: true, worktreeClean: null })).toBe(false);
  });

  it("REGRESSION: a run that has not ended follows the TTL — clean worktree or not", () => {
    expect(isClaimStaleForRun(FRESH, NOW, TTL, { runEnded: false, worktreeClean: true })).toBe(false);
    expect(isClaimStaleForRun(OLD, NOW, TTL, { runEnded: false, worktreeClean: false })).toBe(true);
  });

  it("BOUNDARY: an ended run with a dirty worktree falls back to the TTL (the crash/kill fallback)", () => {
    expect(isClaimStaleForRun(OLD, NOW, TTL, { runEnded: true, worktreeClean: false })).toBe(true);
  });

  it("HAPPY: an orphaned_dirty claim is exempt from age — an old one stays fresh while the worktree is dirty or unmeasured", () => {
    expect(isClaimStaleForRun(orphaned(OLD), NOW, TTL, { runEnded: true, worktreeClean: false })).toBe(false);
    expect(isClaimStaleForRun(orphaned(OLD), NOW, TTL, { runEnded: true, worktreeClean: null })).toBe(false);
  });

  it("STATE: an orphaned_dirty claim becomes stale the moment its worktree is measured clean, at any age", () => {
    expect(isClaimStaleForRun(orphaned(FRESH), NOW, TTL, { runEnded: true, worktreeClean: true })).toBe(true);
    expect(isClaimStaleForRun(orphaned(OLD), NOW, TTL, { runEnded: true, worktreeClean: true })).toBe(true);
  });
});
