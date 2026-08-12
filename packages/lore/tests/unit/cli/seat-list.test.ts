/**
 * seat-list.test.ts — SPEC-057 AC-S-7, the spec's own declared oracle path for the
 * `lore seat list --json` data surface (`branch`/`created_at`/`merged` per seat — the
 * G13 cost counter-metric data surface). `commands/seat.ts` transitively imports
 * `loader.ts` (`bun:sqlite`), which vitest cannot resolve, so this suite exercises the
 * two vitest-safe units that jointly deliver `seat list --json`'s behavior:
 *   - `SeatService.list()` (`packages/lore/src/service/seat-service.ts`) against a
 *     fake `GitPort` fixture built locally in this file (independent of
 *     `seat-service.test.ts`'s own fixture, per this task's instruction to author
 *     this file as a standalone oracle).
 *   - `buildSeatListJsonPayload` / `formatSeatList`
 *     (`packages/lore/src/adapters/cli/seat-render.ts`) — the pure envelope/rendering
 *     `commands/seat.ts`'s `list` subcommand calls verbatim.
 *
 * Coverage:
 *   HAPPY:      multiple seat worktrees, mixed merged/unmerged → every entry carries
 *               branch/created_at/merged, in the `--json` envelope
 *   NEGATIVE:   zero worktrees → empty list, `formatSeatList` renders the explicit
 *               "No active seats." message (never a blank line)
 *   BOUNDARY:   a detached-HEAD worktree (branch: null) and a non-seat branch
 *               ("feature/foo") are both EXCLUDED from the list — only genuine
 *               `plan/...` seat branches are counted
 *   ERROR:      `worktreeList()` failing propagates the error untouched (no partial
 *               list, no swallowed failure)
 *   STATE:      `merged` reflects each branch's OWN `isMerged` outcome, not a
 *               constant — proven via two seats with opposite merge state
 *   REGRESSION: `buildSeatListJsonPayload`'s envelope shape is `{ok: true, data:
 *               {seats: [...]}}` — a stable, non-re-derived wrap of `list()`'s output
 *
 * Source: spec-spec-057-two-tier-worktree-seat-model-lore-seat-verb-seat-a
 *   §Public Interface, §Acceptance Criteria AC-S-7.
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SeatService } from "../../../src/service/seat-service.js";
import type { GitPort, WorktreeInfo, SeatReadyReportLike } from "../../../src/service/seat-service.js";
import { buildSeatListJsonPayload, formatSeatList } from "../../../src/adapters/cli/seat-render.js";
import { ok, err } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

/** A minimal, independently-scripted fake `GitPort` — deliberately NOT imported from
 *  `seat-service.test.ts`'s own fixture, per this file's role as a standalone oracle
 *  for the CLI-level `seat list --json` contract. */
class FakeListGitPort implements GitPort {
  worktreeListResult: Result<WorktreeInfo[], LoreError> = ok([]);
  mergedByBranch: Record<string, boolean> = {};

  async worktreeAdd(): Promise<Result<void, LoreError>> {
    throw new Error("not used by this suite");
  }
  async worktreeList(): Promise<Result<WorktreeInfo[], LoreError>> {
    return this.worktreeListResult;
  }
  async worktreeRemove(): Promise<Result<void, LoreError>> {
    throw new Error("not used by this suite");
  }
  async isMerged(branch: string): Promise<Result<boolean, LoreError>> {
    return ok(this.mergedByBranch[branch] ?? false);
  }
  async countUnmergedCommits(): Promise<Result<number, LoreError>> {
    throw new Error("not used by this suite");
  }
  async rebaseFromMain(): Promise<Result<void, LoreError>> {
    throw new Error("not used by this suite");
  }
  async isDirty(): Promise<Result<boolean, LoreError>> {
    throw new Error("not used by this suite");
  }
}

async function alwaysReady(): Promise<SeatReadyReportLike> {
  return { anchor_conflicts: [] };
}

function makeSeatService(gitPort: FakeListGitPort): SeatService {
  return new SeatService(new InMemoryStore(), gitPort, alwaysReady);
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("seat list --json — HAPPY", () => {
  it("emits branch, created_at, and merged per seat, wrapped in the --json envelope", async () => {
    const gitPort = new FakeListGitPort();
    gitPort.worktreeListResult = ok([
      { path: "/repo-seat-plan-a", branch: "plan/plan-a", createdAt: "2026-07-01T00:00:00.000Z" },
      { path: "/repo-seat-plan-b", branch: "plan/plan-b", createdAt: "2026-07-05T00:00:00.000Z" },
    ]);
    gitPort.mergedByBranch = { "plan/plan-a": false, "plan/plan-b": true };

    const seatService = makeSeatService(gitPort);
    const result = await seatService.list();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const payload = buildSeatListJsonPayload(result.value);
    expect(payload.ok).toBe(true);
    expect(payload.data.seats).toHaveLength(2);
    for (const seat of payload.data.seats) {
      expect(seat).toHaveProperty("branch");
      expect(seat).toHaveProperty("created_at");
      expect(seat).toHaveProperty("merged");
    }
    expect(payload.data.seats).toEqual(
      expect.arrayContaining([
        { branch: "plan/plan-a", created_at: "2026-07-01T00:00:00.000Z", merged: false },
        { branch: "plan/plan-b", created_at: "2026-07-05T00:00:00.000Z", merged: true },
      ]),
    );
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("seat list --json — NEGATIVE", () => {
  it("zero worktrees produces an empty seat list, and formatSeatList renders an explicit no-seats message", async () => {
    const gitPort = new FakeListGitPort();
    gitPort.worktreeListResult = ok([]);

    const seatService = makeSeatService(gitPort);
    const result = await seatService.list();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual([]);
    expect(buildSeatListJsonPayload(result.value)).toEqual({ ok: true, data: { seats: [] } });
    expect(formatSeatList(result.value)).toBe("No active seats.");
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("seat list --json — BOUNDARY", () => {
  it("excludes a detached-HEAD worktree (branch: null) and a non-seat branch, counting only genuine plan/ seats", async () => {
    const gitPort = new FakeListGitPort();
    gitPort.worktreeListResult = ok([
      { path: "/repo-detached", branch: null, createdAt: "2026-07-01T00:00:00.000Z" },
      { path: "/repo-feature", branch: "feature/foo", createdAt: "2026-07-02T00:00:00.000Z" },
      { path: "/repo-seat-plan-c", branch: "plan/plan-c", createdAt: "2026-07-03T00:00:00.000Z" },
    ]);
    gitPort.mergedByBranch = { "plan/plan-c": false };

    const seatService = makeSeatService(gitPort);
    const result = await seatService.list();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual([
      { branch: "plan/plan-c", created_at: "2026-07-03T00:00:00.000Z", merged: false },
    ]);
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("seat list --json — ERROR", () => {
  it("a worktreeList() failure propagates untouched — no partial list, no swallowed error", async () => {
    const gitPort = new FakeListGitPort();
    gitPort.worktreeListResult = err({ code: "STORE_ERROR", message: "git worktree list failed" });

    const seatService = makeSeatService(gitPort);
    const result = await seatService.list();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("seat list --json — STATE", () => {
  it("merged reflects each branch's own isMerged outcome, not a constant", async () => {
    const gitPort = new FakeListGitPort();
    gitPort.worktreeListResult = ok([
      { path: "/repo-seat-plan-d", branch: "plan/plan-d", createdAt: "2026-07-01T00:00:00.000Z" },
      { path: "/repo-seat-plan-e", branch: "plan/plan-e", createdAt: "2026-07-01T00:00:00.000Z" },
    ]);
    gitPort.mergedByBranch = { "plan/plan-d": true, "plan/plan-e": false };

    const seatService = makeSeatService(gitPort);
    const result = await seatService.list();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byBranch = new Map(result.value.map((e) => [e.branch, e.merged]));
    expect(byBranch.get("plan/plan-d")).toBe(true);
    expect(byBranch.get("plan/plan-e")).toBe(false);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("seat list --json — REGRESSION", () => {
  it("buildSeatListJsonPayload wraps list() output verbatim under {ok, data: {seats}} — no re-derivation", () => {
    const entries = [{ branch: "plan/plan-f", created_at: "2026-07-01T00:00:00.000Z", merged: true }];
    expect(buildSeatListJsonPayload(entries)).toEqual({ ok: true, data: { seats: entries } });
    // Identity check: the SAME array reference is threaded through, not a copy/rebuild.
    expect(buildSeatListJsonPayload(entries).data.seats).toBe(entries);
  });
});
