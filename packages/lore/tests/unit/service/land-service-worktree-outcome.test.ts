/**
 * land-service-worktree-outcome.test.ts — `lore land <task>` carries the worktree outcome of the `lore done` walk it runs through
 * unchanged, one line per task, in the form `lore done` prints (`worktree: removed <path>` / `worktree: kept <path>: <reason>`).
 * The autopilot skill (Phase 4 step 1) tells agents to "follow the reason" of a kept worktree, so land must not drop it.
 *
 * LandService runs on in-memory ports: a one-task store, a git that resolves the task branch, a pass-through queue and integrate,
 * and a `done` port that returns the outcomes under test.
 *
 * Coverage: HAPPY (removed line) / NEGATIVE (kept line carries its reason) / BOUNDARY (no outcome, no line)
 */

import { describe, expect, it } from "vitest";
import { ok, type DocRecord, type LoreError, type Result } from "@lore/core";
import { LandService, type LandPorts } from "../../../src/service/land-service.js";
import type { WorktreeOutcome } from "../../../src/service/worktree-cleanup.js";

const SLUG = "task-land-prints-the-worktree-outcome";
const BRANCH = "worktree-land-outcome";
const TIP = "a".repeat(40);
const WORKTREE = "/repo/.claude/worktrees/agent-land-outcome";

function taskRecord(status: string): DocRecord {
  return {
    id: "01TESTLANDWORKTREEOUTCOME0001",
    slug: SLUG,
    type: "task",
    status,
    deleted_at: null,
    extra: {
      done_contract: {
        compiled_at_commit: TIP,
        kind: "code",
        base_branch: "main",
        oracles: [],
        red_required: false,
        landing_route: "main",
        new_symbols: [],
        added_oracles: [],
      },
      claim: { by: "agent:test", at: "2026-11-01T00:00:00.000Z", branch: BRANCH, finished_commit: TIP },
    },
  } as unknown as DocRecord;
}

function serviceWith(status: string, outcomes: readonly WorktreeOutcome[]): { service: LandService; doneCalls: string[] } {
  const doneCalls: string[] = [];
  const task = taskRecord(status);
  const ports = {
    store: {
      find: async () => ok(task),
      findBySlug: async () => ok(task),
    },
    git: (args: readonly string[]) =>
      args[0] === "rev-parse" ? { status: 0, stdout: `${TIP}\n`, stderr: "" } : { status: 0, stdout: "", stderr: "" },
    queue: { runInTurn: async <T>(_taker: unknown, fn: () => Promise<T>): Promise<T> => fn() },
    integrate: { integrate: async () => undefined },
    done: async (slug: string): Promise<Result<unknown, LoreError>> => {
      doneCalls.push(slug);
      return ok({ worktree_outcomes: outcomes });
    },
    log: { appendEntries: async () => ok([]) },
    session: "test-session",
    now: () => "2026-11-01T00:00:00.000Z",
  } as unknown as LandPorts;
  return { service: new LandService(ports), doneCalls };
}

describe("lore land prints the worktree outcome of its done walk", () => {
  it("a kept worktree is printed as `worktree: kept <path>: <reason>`, exactly as lore done prints it", async () => {
    const reason = "ignored files at .env.local would be lost; see decision record";
    const { service, doneCalls } = serviceWith("approved", [{ worktree: WORKTREE, decision: "keep", reason }]);
    const landed = await service.land(SLUG);
    expect(landed.ok).toBe(true);
    if (!landed.ok) return;
    expect(doneCalls).toEqual([SLUG]);
    expect(landed.value.exit).toBe(0);
    expect(landed.value.lines).toEqual([
      `land: landed ${BRANCH} on main`,
      `land: archived ${SLUG}`,
      `worktree: kept ${WORKTREE}: ${reason}`,
    ]);
  });

  it("a removed worktree is printed as `worktree: removed <path>`", async () => {
    const { service } = serviceWith("approved", [{ worktree: WORKTREE, decision: "remove", reason: "removed" }]);
    const landed = await service.land(SLUG);
    expect(landed.ok).toBe(true);
    if (!landed.ok) return;
    expect(landed.value.lines).toEqual([`land: landed ${BRANCH} on main`, `land: archived ${SLUG}`, `worktree: removed ${WORKTREE}`]);
  });

  it("a done walk that reports no worktree prints no worktree line", async () => {
    const { service, doneCalls } = serviceWith("approved", []);
    const landed = await service.land(SLUG);
    expect(landed.ok).toBe(true);
    if (!landed.ok) return;
    expect(doneCalls).toEqual([SLUG]);
    expect(landed.value.lines.filter((line) => line.startsWith("worktree:"))).toEqual([]);
  });
});
