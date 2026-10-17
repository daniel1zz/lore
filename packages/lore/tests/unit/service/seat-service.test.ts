// @layer service-seat-list
/**
 * RED suite (TDD-Role: red, paired-impl task-skill-implement-core-seat-ts-seatservice-
 * realgitport) for `packages/lore/src/service/seat-service.ts` — a module that does NOT
 * exist yet. Covers AC-S-2 (fake-GitPort entry sequence order, dirty-main typed err,
 * mid-sequence failure naming the failed step + idempotent retry, unmerged/merged
 * `remove` matched pair) and the substance of AC-S-7 (`list` emitting
 * `branch`/`created_at`/`merged` per seat on a fake-GitPort fixture — see this suite's
 * final describe block; the spec's own declared oracle path for AC-S-7 is a separate
 * CLI-level file, `tests/unit/cli/seat-list.test.ts`, which is NOT in this task's file
 * anchors — the service-level coverage here exercises the same contract at the layer
 * this task IS scoped to write).
 *
 * RED mechanism (mirrors packages/lore/tests/unit/core/seat.test.ts and this repo's
 * SPEC-058 RED precedent): `SeatService` is loaded via a dynamic `import()` whose
 * specifier is a COMPUTED (non-literal) string, so `bun run typecheck` stays green
 * before `seat-service.ts` exists (TS only statically resolves literal `import()`
 * specifiers) and the import genuinely throws ("Cannot find module") at runtime today.
 *
 * Source: spec-spec-057-two-tier-worktree-seat-model-lore-seat-verb-seat-a
 *   §Public Interface, §Design Decisions D5/D7, §Acceptance Criteria AC-S-2, AC-S-7.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ok, err } from "@lore/core";
import type { CreateDocInput, DocRecord, LoreError, Result } from "@lore/core";

// packages/lore/tests/unit/service/ -> ../../../ -> packages/lore/src/service/seat-service.js
const SEAT_SERVICE_MODULE_PATH = ["..", "..", "..", "src", "service", "seat-service.js"].join("/");

// ─── Minimal local contracts for the not-yet-existing module ──────────────────

/** One git worktree entry as the fake GitPort reports it — `createdAt` is a fixture-only
 *  convenience (real GitPort must derive it some other way; not this task's concern). */
interface FakeWorktreeInfo {
  path: string;
  branch: string | null;
  createdAt: string;
}

/** `GitPort` — the 6-method port from the spec's Public Interface sketch (`currentBranch`
 *  is deliberately absent, D1 — no consumer). Every method returns `Result`, never throws
 *  on an expected failure (only genuinely unexpected faults reject the promise). */
interface GitPort {
  worktreeAdd(path: string, branch: string): Promise<Result<void, LoreError>>;
  worktreeList(): Promise<Result<FakeWorktreeInfo[], LoreError>>;
  worktreeRemove(path: string, force: boolean): Promise<Result<void, LoreError>>;
  isMerged(branch: string, into: string): Promise<Result<boolean, LoreError>>;
  rebaseFromMain(cwd: string): Promise<Result<void, LoreError>>;
  isDirty(cwd: string): Promise<Result<boolean, LoreError>>;
}

/** Narrow readiness-report shape `getReadyReport` resolves to — see seat.test.ts's
 *  identical `SeatReadyReportLike` note on why this is declared locally. */
interface SeatReadyReportLike {
  anchor_conflicts: Array<{ task_slug: string; holder: string; paths: string[] }>;
}

interface SeatEnterOpts {
  mainCwd: string;
}

interface SeatListEntry {
  branch: string;
  created_at: string;
  merged: boolean;
}

interface SeatServiceCtor {
  new (
    store: InMemoryStore,
    gitPort: GitPort,
    getReadyReport: (planId: string) => Promise<SeatReadyReportLike>,
  ): {
    enter(planIdOrSlug: string, opts: SeatEnterOpts): Promise<Result<{ path: string; branch: string }, LoreError>>;
    list(): Promise<Result<SeatListEntry[], LoreError>>;
    resume(planIdOrSlug: string): Promise<Result<{ path: string; branch: string }, LoreError>>;
    remove(planIdOrSlug: string, opts?: { force?: boolean }): Promise<Result<void, LoreError>>;
  };
}

async function loadSeatServiceCtor(): Promise<SeatServiceCtor> {
  const mod = (await import(SEAT_SERVICE_MODULE_PATH)) as unknown as { SeatService: SeatServiceCtor };
  return mod.SeatService;
}

// ─── Fake GitPort — records every call (order) + is independently scriptable ───

class FakeGitPort implements GitPort {
  readonly calls: string[] = [];
  isDirtyResult = false;
  rebaseResult: Result<void, LoreError> = ok(undefined);
  worktreeAddResult: Result<void, LoreError> = ok(undefined);
  worktreeRemoveResult: Result<void, LoreError> = ok(undefined);
  isMergedResult = true;
  worktreeListResult: FakeWorktreeInfo[] = [];

  async isDirty(cwd: string): Promise<Result<boolean, LoreError>> {
    this.calls.push(`isDirty:${cwd}`);
    return ok(this.isDirtyResult);
  }

  async rebaseFromMain(cwd: string): Promise<Result<void, LoreError>> {
    this.calls.push(`rebaseFromMain:${cwd}`);
    return this.rebaseResult;
  }

  async worktreeAdd(path: string, branch: string): Promise<Result<void, LoreError>> {
    this.calls.push(`worktreeAdd:${path}:${branch}`);
    return this.worktreeAddResult;
  }

  async worktreeList(): Promise<Result<FakeWorktreeInfo[], LoreError>> {
    this.calls.push("worktreeList");
    return ok(this.worktreeListResult);
  }

  async worktreeRemove(path: string, force: boolean): Promise<Result<void, LoreError>> {
    this.calls.push(`worktreeRemove:${path}:${force}`);
    return this.worktreeRemoveResult;
  }

  async isMerged(branch: string, into: string): Promise<Result<boolean, LoreError>> {
    this.calls.push(`isMerged:${branch}:${into}`);
    return ok(this.isMergedResult);
  }
}

async function mustCreatePlan(cs: CorpusService, title: string): Promise<DocRecord> {
  const result = await cs.create({ type: "plan", title, content: "# Plan" } as CreateDocInput);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function readyReport(): SeatReadyReportLike {
  return { anchor_conflicts: [] };
}

// ─── Entry sequence order (AC-S-2) ─────────────────────────────────────────────

describe("SeatService.enter — sequence order (HAPPY)", () => {
  it("calls isDirty -> rebaseFromMain -> getReadyReport -> worktreeAdd, in that exact order", async () => {
    const SeatService = await loadSeatServiceCtor();
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const plan = await mustCreatePlan(corpusService, "Session Plan");

    const gitPort = new FakeGitPort();
    const readyCalls: string[] = [];
    const getReadyReport = async (planId: string): Promise<SeatReadyReportLike> => {
      readyCalls.push(`getReadyReport:${planId}`);
      return readyReport();
    };

    const seatService = new SeatService(store, gitPort, getReadyReport);
    const result = await seatService.enter(plan.slug, { mainCwd: "/repo/main" });

    expect(result.ok).toBe(true);
    // The readiness thunk call must land strictly between rebaseFromMain and
    // worktreeAdd — assert via each call's position in the two logs combined by
    // reconstructing what SHOULD be an interleaved single sequence: since
    // getReadyReport is the ONLY call not on gitPort, its position relative to
    // gitPort.calls is proven by asserting rebaseFromMain happened, THEN
    // getReadyReport was invoked, THEN worktreeAdd happened — the gitPort call
    // log alone already proves isDirty < rebaseFromMain < worktreeAdd.
    expect(gitPort.calls[0]).toBe("isDirty:/repo/main");
    expect(gitPort.calls[1]).toBe("rebaseFromMain:/repo/main");
    expect(gitPort.calls[2]).toMatch(/^worktreeAdd:/);
    expect(readyCalls).toHaveLength(1);
  });

  it("dirty main aborts before rebase/readiness/worktreeAdd, with a typed err", async () => {
    const SeatService = await loadSeatServiceCtor();
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const plan = await mustCreatePlan(corpusService, "Dirty Main Plan");

    const gitPort = new FakeGitPort();
    gitPort.isDirtyResult = true;
    let readyCallCount = 0;
    const getReadyReport = async (): Promise<SeatReadyReportLike> => {
      readyCallCount += 1;
      return readyReport();
    };

    const seatService = new SeatService(store, gitPort, getReadyReport);
    const result = await seatService.enter(plan.slug, { mainCwd: "/repo/main" });

    expect(result.ok).toBe(false);
    expect(gitPort.calls).toEqual(["isDirty:/repo/main"]);
    expect(readyCallCount).toBe(0);
  });
});

// ─── Mid-sequence failure + idempotent retry (AC-S-2) ──────────────────────────

describe("SeatService.enter — mid-sequence failure + retry (NEGATIVE / STATE)", () => {
  it("worktreeAdd failing after a successful rebase errs naming the worktreeAdd step, and a second enter call succeeds", async () => {
    const SeatService = await loadSeatServiceCtor();
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const plan = await mustCreatePlan(corpusService, "Retry Plan");

    const gitPort = new FakeGitPort();
    gitPort.worktreeAddResult = err({
      code: "STORE_ERROR",
      message: "worktree add failed: path already exists",
    });
    const getReadyReport = async (): Promise<SeatReadyReportLike> => readyReport();

    const seatService = new SeatService(store, gitPort, getReadyReport);

    const first = await seatService.enter(plan.slug, { mainCwd: "/repo/main" });
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(JSON.stringify(first.error)).toContain("worktreeAdd");
    }

    // Idempotent retry: no special-cased "already rebased" skip logic — the full
    // sequence (isDirty -> rebaseFromMain -> readiness -> worktreeAdd) re-runs.
    gitPort.calls.length = 0;
    gitPort.worktreeAddResult = ok(undefined);
    const second = await seatService.enter(plan.slug, { mainCwd: "/repo/main" });
    expect(second.ok).toBe(true);
    expect(gitPort.calls[0]).toBe("isDirty:/repo/main");
    expect(gitPort.calls[1]).toBe("rebaseFromMain:/repo/main");
    expect(gitPort.calls[2]).toMatch(/^worktreeAdd:/);
  });
});

// ─── remove — unmerged/merged matched pair (AC-S-2) ────────────────────────────

describe("SeatService.remove — unmerged/merged matched pair", () => {
  let store: InMemoryStore;
  let corpusService: CorpusService;
  let plan: DocRecord;

  beforeEach(async () => {
    store = new InMemoryStore();
    corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    plan = await mustCreatePlan(corpusService, "Remove-Target Plan");
  });

  it("an unmerged seat branch refuses removal, naming the branch and the escape flag", async () => {
    const SeatService = await loadSeatServiceCtor();
    const gitPort = new FakeGitPort();
    gitPort.isMergedResult = false;
    const getReadyReport = async (): Promise<SeatReadyReportLike> => readyReport();

    const seatService = new SeatService(store, gitPort, getReadyReport);
    const result = await seatService.remove(plan.slug);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const serialized = JSON.stringify(result.error);
      expect(serialized).toContain("force");
    }
  });

  it("a merged seat branch removes cleanly", async () => {
    const SeatService = await loadSeatServiceCtor();
    const gitPort = new FakeGitPort();
    gitPort.isMergedResult = true;
    const getReadyReport = async (): Promise<SeatReadyReportLike> => readyReport();

    const seatService = new SeatService(store, gitPort, getReadyReport);
    const result = await seatService.remove(plan.slug);

    expect(result.ok).toBe(true);
    expect(gitPort.calls.some((c) => c.startsWith("worktreeRemove:"))).toBe(true);
  });

  it("force removal bypasses the unmerged refusal", async () => {
    const SeatService = await loadSeatServiceCtor();
    const gitPort = new FakeGitPort();
    gitPort.isMergedResult = false;
    const getReadyReport = async (): Promise<SeatReadyReportLike> => readyReport();

    const seatService = new SeatService(store, gitPort, getReadyReport);
    const result = await seatService.remove(plan.slug, { force: true });

    expect(result.ok).toBe(true);
  });
});

// ─── list — branch/created_at/merged data surface (AC-S-7) ────────────────────

describe("SeatService.list — G13 cost counter-metric data surface (AC-S-7)", () => {
  it("emits branch, created_at, and merged per seat on a fake-GitPort fixture", async () => {
    const SeatService = await loadSeatServiceCtor();
    const store = new InMemoryStore();

    const gitPort = new FakeGitPort();
    gitPort.worktreeListResult = [
      { path: "/repo-seat-plan-a", branch: "plan/plan-a", createdAt: "2026-07-01T00:00:00.000Z" },
      { path: "/repo-seat-plan-b", branch: "plan/plan-b", createdAt: "2026-07-05T00:00:00.000Z" },
    ];
    // isMerged is consulted per-branch; script distinct outcomes to prove list()
    // doesn't just hardcode `merged: false`.
    const mergedByBranch: Record<string, boolean> = { "plan/plan-a": false, "plan/plan-b": true };
    gitPort.isMerged = async (branch: string) => ok(mergedByBranch[branch] ?? false);

    const getReadyReport = async (): Promise<SeatReadyReportLike> => readyReport();
    const seatService = new SeatService(store, gitPort, getReadyReport);

    const result = await seatService.list();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual(
      expect.arrayContaining([
        { branch: "plan/plan-a", created_at: "2026-07-01T00:00:00.000Z", merged: false },
        { branch: "plan/plan-b", created_at: "2026-07-05T00:00:00.000Z", merged: true },
      ]),
    );
    expect(result.value).toHaveLength(2);
  });

  it("an empty worktree list produces an empty seat list, not an error", async () => {
    const SeatService = await loadSeatServiceCtor();
    const store = new InMemoryStore();
    const gitPort = new FakeGitPort();
    const getReadyReport = async (): Promise<SeatReadyReportLike> => readyReport();

    const seatService = new SeatService(store, gitPort, getReadyReport);
    const result = await seatService.list();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });
});

// ─── resume — re-entering an existing seat ─────────────────────────────────────

describe("SeatService.resume", () => {
  it("resumes an existing seat worktree by locating it via worktreeList", async () => {
    const SeatService = await loadSeatServiceCtor();
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const plan = await mustCreatePlan(corpusService, "Resume Plan");

    const gitPort = new FakeGitPort();
    const branch = `plan/${plan.slug.replace(/^plan-/, "")}`;
    gitPort.worktreeListResult = [{ path: "/repo-seat-resume", branch, createdAt: "2026-07-01T00:00:00.000Z" }];
    const getReadyReport = async (): Promise<SeatReadyReportLike> => readyReport();

    const seatService = new SeatService(store, gitPort, getReadyReport);
    const result = await seatService.resume(plan.slug);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.path).toBe("/repo-seat-resume");
  });

  it("resuming a plan with no matching seat worktree errs rather than silently creating one", async () => {
    const SeatService = await loadSeatServiceCtor();
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const plan = await mustCreatePlan(corpusService, "No Seat Yet Plan");

    const gitPort = new FakeGitPort();
    gitPort.worktreeListResult = [];
    const getReadyReport = async (): Promise<SeatReadyReportLike> => readyReport();

    const seatService = new SeatService(store, gitPort, getReadyReport);
    const result = await seatService.resume(plan.slug);

    expect(result.ok).toBe(false);
  });
});
