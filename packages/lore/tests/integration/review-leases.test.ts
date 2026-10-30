// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/service/review-batch-lease.ts
// @reads packages/lore/src/service/review-batch-service.ts
// @reads packages/lore/src/service/suite-result-service.ts
// @reads packages/lore/src/service/issue-filing-service.ts
// @reads packages/lore/src/service/known-defects-at-close.ts
// @reads assets/skills/lore/SKILL.md
// @reads assets/skills/lore-autopilot/SKILL.md
/**
 * @spec_ref spec-review-work-is-leased-per-plan-per-commit-and-per-root (AC-RL-1, AC-RL-2, AC-RL-3, AC-RL-4, BR-1511, BR-1379, BR-1510)
 *
 * Review work is leased per key, not by one corpus-wide batch lease. Every concurrency test drives two holders against ONE
 * real SQLite store (a throwaway file, never the repo's `.lore/`) with real lease rows and an injected clock; the judge, the
 * suite runner, the issue creator and the comment writer are stubs that count their calls. The CLI tests run the real
 * `lore assess` in a throwaway corpus (`lore init`).
 *
 * Dimensions: HAPPY (a free key runs), NEGATIVE (a held key refuses or waits), BOUNDARY (expiry, different keys),
 * ERROR (takeover fences a stale holder), STATE (a second holder after the first released), REGRESSION (no `review-batch`).
 */

import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MILESTONE_DIMENSIONS, err, ok, type DocRecord, type LoreError, type MilestoneDimension, type MilestoneReview, type PlanBundle } from "@lore/core";
import assessCommand, { ASSESS_EXIT_CODES } from "../../src/adapters/cli/commands/assess.js";
import { ASSESS_EXIT_LEASE_HELD, renderAssessExitCodes } from "../../src/adapters/cli/assess-exit-codes.js";
import { IssueFilingService, type IssuePort, type IssueRef } from "../../src/service/issue-filing-service.js";
import { retryPendingIssueWrites, type IssueWriteAuditRow } from "../../src/service/known-defects-at-close.js";
import { coverFailedDimensions, type SuiteRun } from "../../src/service/milestone-review-inputs.js";
import { MILESTONE_REVIEW_SUB_TYPE, planStateFingerprint } from "../../src/service/milestone-review.js";
import type { MilestoneReviewResult } from "../../src/service/milestone-review-service.js";
import * as leaseModule from "../../src/service/review-batch-lease.js";
import { ReviewLeases, REVIEW_LEASE_EXPIRY_MS, LEASE_WAIT_POLL_MS, issueLeaseKey, planLeaseKey, suiteFileLeaseKey, suiteLeaseKey } from "../../src/service/review-batch-lease.js";
import { ReviewBatchRunner, skippedEveryPlan, type BatchRunPorts } from "../../src/service/review-batch-service.js";
import { SuiteResultService, type CommitSuiteRunnerPort, type FileRunOutcome } from "../../src/service/suite-result-service.js";
import type { FailedFinding } from "../../src/service/root-cause-fingerprint.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { createLiveApp } from "../helpers/live-app.js";
import { installStubClaude, stubClaudeEnv } from "../helpers/stub-claude.js";
import { ensureRequirementsDocSlug } from "../helpers/parented-create.js";

// ─── Shared fixtures ──────────────────────────────────────────────────────────────────────────────────────────────

const T0 = Date.parse("2026-10-30T12:00:00.000Z");
const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

/** A macrotask pause: concurrent stubs must yield to timers, or a microtask-only wait would starve the holder it waits for. */
const pause = (ms = 3): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A promise settled from outside: the way a stub holds a lease open until the test lets it finish. */
function gate(): { readonly wait: Promise<void>; readonly open: () => void } {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

/** One real SQLite store over a throwaway file, an injected clock, and a lease factory whose waits are recorded. */
class LeaseWorld {
  readonly dir = mkdtempSync(join(tmpdir(), "lore-review-leases-"));
  readonly store = new SQLiteStore(join(this.dir, "corpus.db"));
  now = T0;
  /** Every `sleep` a waiter asked for (ms), so a test can assert the poll bound. */
  readonly sleeps: number[] = [];
  /** Added to the clock on each sleep: how a test lets a dead holder's lease expire while a waiter waits. */
  advanceOnSleepMs = 0;
  /** Every lease name any holder acquired through {@link leases}. */
  readonly acquired: string[] = [];

  leases(holder: string): ReviewLeases {
    const recording = new Proxy(this.store, {
      get: (target, prop, receiver) => {
        if (prop === "acquireLease") {
          return (name: string, ...rest: [string, string, string]) => {
            this.acquired.push(name);
            return target.acquireLease(name, ...rest);
          };
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    return new ReviewLeases(
      recording,
      holder,
      () => this.now,
      () => () => undefined,
      async (ms) => {
        this.sleeps.push(ms);
        this.now += this.advanceOnSleepMs;
        await pause();
      },
    );
  }

  iso(ms: number = this.now): string {
    return new Date(ms).toISOString();
  }

  close(): void {
    this.store.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

const worlds: LeaseWorld[] = [];
function newWorld(): LeaseWorld {
  const world = new LeaseWorld();
  worlds.push(world);
  return world;
}
afterEach(() => {
  for (const world of worlds.splice(0)) world.close();
});

// ─── AC-RL-1: per-plan lease (the batch runner over stub judge / tracker, real leases) ───────────────────────────────

interface WorldPlan {
  readonly slug: string;
  readonly bundle: PlanBundle;
  readonly docs: DocRecord[];
  archived: boolean;
  failing: MilestoneDimension[];
}

function stubDoc(partial: Record<string, unknown>): DocRecord {
  return { deleted_at: null, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", version: 1, content: "", tags: [], parent_id: null, ...partial } as unknown as DocRecord;
}

function makePlan(slug: string, failing: MilestoneDimension[] = []): WorldPlan {
  const progress = { state: "complete", open: 0, total: 1, at: "2026-10-01T00:00:00.000Z" };
  const plan = stubDoc({ id: `id-${slug}`, slug, type: "plan", status: "active", title: slug, extra: { progress } });
  const task = stubDoc({ id: `id-${slug}-t1`, slug: `${slug}-t1`, type: "task", status: "archived", title: "t", extra: {} });
  const spec = stubDoc({ id: `id-spec-${slug}`, slug: `spec-${slug}`, type: "spec", status: "approved", title: "s", extra: { acceptance_criteria: [{ id: "AC-W-1", statement: "works", verify: { mode: "human" } }] } });
  return { slug, bundle: { plan, spec, tasks: [task] } as unknown as PlanBundle, docs: [], archived: false, failing };
}

/** The in-memory tracker the batch files into (no dedupe by title: only the lease can stop a duplicate). */
class FakeIssues implements IssuePort {
  readonly open: { number: number; title: string }[] = [];
  readonly links: { plan: string; issue: number; dimensions: string[] }[] = [];
  creates = 0;
  /** Held while `file` runs, so a second creator overlaps the first. */
  createDelayMs = 0;
  async findOpenByFingerprint(short: string) {
    const hit = this.open.find((i) => i.title.includes(`[fp:${short}]`));
    return ok<IssueRef | undefined>(hit === undefined ? undefined : { number: hit.number });
  }
  async file(input: { title: string }) {
    if (this.createDelayMs > 0) await pause(this.createDelayMs);
    this.creates += 1;
    const number = 500 + this.creates;
    this.open.push({ number, title: input.title });
    return ok<IssueRef>({ number });
  }
  async recordKnownDefects(plan: string, issue: IssueRef, findings: readonly { dimension: string }[]) {
    for (const finding of findings) {
      const hit = this.links.find((l) => l.plan === plan && l.issue === issue.number);
      if (hit === undefined) this.links.push({ plan, issue: issue.number, dimensions: [finding.dimension] });
      else if (!hit.dimensions.includes(finding.dimension)) hit.dimensions.push(finding.dimension);
    }
    return ok(undefined);
  }
}

class BatchWorld {
  readonly plans = new Map<string, WorldPlan>();
  readonly issues = new FakeIssues();
  readonly judged: string[] = [];
  /** When set, the judge of that plan waits on it (a long review another batch is running). */
  judgeGate: Map<string, Promise<void>> = new Map();

  constructor(readonly leaseWorld: LeaseWorld) {}

  add(plan: WorldPlan): WorldPlan {
    this.plans.set(plan.slug, plan);
    return plan;
  }

  private find(ref: string): WorldPlan {
    const found = this.plans.get(ref);
    if (found === undefined) throw new Error(`unknown plan ${ref}`);
    return found;
  }

  private bundleOf(plan: WorldPlan): PlanBundle {
    return { ...plan.bundle, plan: { ...plan.bundle.plan, status: plan.archived ? "archived" : "active" } } as PlanBundle;
  }

  runner(): ReviewBatchRunner {
    return new ReviewBatchRunner({
      getPlanBundle: async (ref) => ok(this.bundleOf(this.find(ref))),
      listReviewDocs: async (planId) => ok([...this.plans.values()].find((p) => p.bundle.plan.id === planId)?.docs ?? []),
      issueCoverage: async (planId, failed) => {
        const slug = [...this.plans.values()].find((p) => p.bundle.plan.id === planId)?.slug;
        const entries = this.issues.links.filter((l) => l.plan === slug).flatMap((l) => l.dimensions.map((dimension) => ({ number: l.issue, dimension, state: "open" as const })));
        return ok(coverFailedDimensions(failed, entries));
      },
    });
  }

  ports(holder: string, overrides: Partial<BatchRunPorts> = {}): BatchRunPorts {
    const leases = this.leaseWorld.leases(holder);
    return {
      acquirePlanLease: (planId) => leases.acquire(planLeaseKey(planId)),
      settleRetirement: async () => ok({ state: "none" as const }),
      measureSuite: async () => undefined,
      reviewPlan: async (ref) => this.judge(ref),
      closePlan: async (ref) => {
        this.find(ref).archived = true;
        return ok(undefined);
      },
      recordError: async () => ok(undefined),
      filing: new IssueFilingService(this.issues, undefined, this.leaseWorld.leases(`${holder}-issues`)),
      now: () => this.leaseWorld.iso(),
      ...overrides,
    };
  }

  async judge(ref: string) {
    const plan = this.find(ref);
    this.judged.push(plan.slug);
    const waiting = this.judgeGate.get(plan.slug);
    if (waiting !== undefined) await waiting;
    const dimensions = Object.fromEntries(
      MILESTONE_DIMENSIONS.map((d) => [d, { verdict: plan.failing.includes(d) ? "fail" : "pass", reason: plan.failing.includes(d) ? `${d} failed` : "ok", reference: "fixture", ...(plan.failing.includes(d) ? { cites: [`src/${d}.ts`] } : {}) }]),
    ) as MilestoneReview["dimensions"];
    const review: MilestoneReview = {
      plan_id: plan.bundle.plan.id,
      fingerprint: planStateFingerprint(plan.bundle.plan, plan.bundle.tasks, plan.bundle.spec),
      overall: plan.failing.length > 0 ? "fail" : "pass",
      dimensions,
      decisions: [],
      prompt_version: "fixture",
      diff_source: "fixture",
    };
    const doc = stubDoc({ id: `rev-${this.judged.length}`, slug: `review-${plan.slug}-${this.judged.length}`, type: "knowledge", extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review } });
    plan.docs.push(doc);
    return ok<MilestoneReviewResult>({ doc, review });
  }
}

async function runOf(promise: ReturnType<ReviewBatchRunner["runBatch"]>) {
  const run = await promise;
  if (!run.ok) throw new Error(`batch failed: ${JSON.stringify(run.error)}`);
  return run.value;
}

describe("AC-RL-1 per-plan lease", () => {
  it("per-plan lease: a batch selecting P1 and P2 with P1 held reviews P2, skips P1 as held naming the holder, and is not an all-held batch (exit 0)", async () => {
    const lw = newWorld();
    const world = new BatchWorld(lw);
    const p1 = world.add(makePlan("p1"));
    world.add(makePlan("p2"));
    const holder = await lw.leases("other-batch").acquire(planLeaseKey(p1.bundle.plan.id));
    expect(holder.ok && holder.value.state).toBe("held");
    const run = await runOf(world.runner().runBatch(["p1", "p2"], world.ports("batch")));
    expect(run.rows.map((r) => [r.plan, r.outcome])).toEqual([["p1", "skipped"], ["p2", "accepted"]]);
    expect(run.rows[0]?.held?.holder).toContain("other-batch");
    expect(run.rows[0]?.held?.expires_at).toBe(lw.iso(T0 + REVIEW_LEASE_EXPIRY_MS));
    expect(run.rows[0]?.detail).toContain("held by");
    expect(world.judged).toEqual(["p2"]);
    // exit 0 on a partly held batch; a global lease would have skipped P2 too
    expect(skippedEveryPlan(run, 2)).toBe(false);
  });

  it("per-plan lease: a batch whose every selected plan is held ran nothing (exit 75); after the holder's lease expires the next run reviews P1", async () => {
    const lw = newWorld();
    const world = new BatchWorld(lw);
    const p1 = world.add(makePlan("p1"));
    await lw.leases("other-batch").acquire(planLeaseKey(p1.bundle.plan.id));
    const first = await runOf(world.runner().runBatch(["p1"], world.ports("batch")));
    expect(first.rows[0]).toMatchObject({ outcome: "skipped", reviewed: false });
    expect(skippedEveryPlan(first, 1)).toBe(true);
    expect(world.judged).toEqual([]);
    lw.now += REVIEW_LEASE_EXPIRY_MS + 1;
    const second = await runOf(world.runner().runBatch(["p1"], world.ports("batch")));
    expect(second.rows[0]).toMatchObject({ outcome: "accepted", reviewed: true });
    expect(skippedEveryPlan(second, 1)).toBe(false);
    expect(world.judged).toEqual(["p1"]);
  });

  it("per-plan lease: while one batch is inside P1's judge, another batch reviews P2 at the same time and skips P1 (no global lease)", async () => {
    const lw = newWorld();
    const world = new BatchWorld(lw);
    world.add(makePlan("p1"));
    world.add(makePlan("p2"));
    const hold = gate();
    world.judgeGate.set("p1", hold.wait);
    const slow = world.runner().runBatch(["p1"], world.ports("batch-a"));
    await pause(15); // batch A is now blocked inside the judge of P1, holding plan:p1
    const fast = await runOf(world.runner().runBatch(["p1", "p2"], world.ports("batch-b")));
    expect(fast.rows.map((r) => [r.plan, r.outcome])).toEqual([["p1", "skipped"], ["p2", "accepted"]]);
    expect(fast.rows[0]?.held?.holder).toContain("batch-a");
    hold.open();
    const finished = await runOf(slow);
    expect(finished.rows[0]).toMatchObject({ outcome: "accepted", reviewed: true });
    expect(world.judged.sort()).toEqual(["p1", "p2"]);
  });

  it("per-plan lease: a second batch that gets P1's lease after the first batch closed it judges nothing and writes no second review document (exit 0, not 75)", async () => {
    const lw = newWorld();
    const world = new BatchWorld(lw);
    const p1 = world.add(makePlan("p1"));
    const first = await runOf(world.runner().runBatch(["p1"], world.ports("batch-a")));
    expect(first.rows[0]).toMatchObject({ outcome: "accepted", reviewed: true });
    const second = await runOf(world.runner().runBatch(["p1"], world.ports("batch-b")));
    expect(second.rows[0]).toMatchObject({ outcome: "skipped", reviewed: false });
    expect(second.rows[0]?.held).toBeUndefined();
    expect(second.rows[0]?.detail).toContain("already archived");
    expect(skippedEveryPlan(second, 1)).toBe(false);
    expect(world.judged).toEqual(["p1"]);
    expect(p1.docs).toHaveLength(1);
  });

  it("per-plan lease: a batch skips a plan kept open that is already reviewed at its current state as `already reviewed`; a direct assess of it judges again", async () => {
    const lw = newWorld();
    const world = new BatchWorld(lw);
    const kept = world.add(makePlan("kept", ["security"]));
    const first = await runOf(world.runner().runBatch(["kept"], world.ports("batch-a")));
    expect(first.rows[0]).toMatchObject({ outcome: "kept-open", reviewed: true });
    expect(world.issues.creates).toBe(1);
    const second = await runOf(world.runner().runBatch(["kept"], world.ports("batch-b")));
    expect(second.rows[0]).toMatchObject({ outcome: "skipped", reviewed: false });
    expect(second.rows[0]?.detail).toContain("already reviewed");
    expect(skippedEveryPlan(second, 1)).toBe(false);
    expect(world.judged).toEqual(["kept"]);
    expect(kept.docs).toHaveLength(1);
    const direct = await runOf(world.runner().runBatch(["kept"], world.ports("direct", { mode: "direct" })));
    expect(direct.rows[0]).toMatchObject({ outcome: "kept-open", reviewed: true });
    expect(world.judged).toEqual(["kept", "kept"]);
  });

  it("per-plan lease: a holder whose lease row was taken over writes no review document and no archive (renewal fence)", async () => {
    const lw = newWorld();
    const world = new BatchWorld(lw);
    const p1 = world.add(makePlan("p1"));
    const leases = lw.leases("stalled");
    const run = await runOf(
      world.runner().runBatch(["p1"], {
        ...world.ports("stalled"),
        acquirePlanLease: async (planId) => {
          const taken = await leases.acquire(planLeaseKey(planId));
          // the holder stalls past its expiry and another holder takes the row over before the holder writes anything
          lw.now += REVIEW_LEASE_EXPIRY_MS + 1;
          const thief = await lw.store.acquireLease(planLeaseKey(planId), "thief", lw.iso(), lw.iso(lw.now + REVIEW_LEASE_EXPIRY_MS));
          expect(thief).toMatchObject({ ok: true, value: { acquired: true, tookOver: true } });
          return taken;
        },
      }),
    );
    expect(run.rows[0]).toMatchObject({ outcome: "error", reviewed: false });
    expect(run.rows[0]?.detail).toContain("expired and was taken over");
    expect(world.judged).toEqual([]);
    expect(p1.docs).toEqual([]);
    expect(p1.archived).toBe(false);
  });

  it("per-plan lease: no code acquires a lease named review-batch (the name and its constant are retired)", async () => {
    const lw = newWorld();
    const world = new BatchWorld(lw);
    world.add(makePlan("p1", ["security"]));
    await runOf(world.runner().runBatch(["p1"], world.ports("batch")));
    expect(lw.acquired.length).toBeGreaterThan(0);
    expect(lw.acquired).not.toContain("review-batch");
    expect(lw.acquired.every((name) => /^(plan|suite|issue|issue-write):/.test(name))).toBe(true);
    expect("REVIEW_BATCH_LEASE_NAME" in leaseModule).toBe(false);
    for (const file of ["review-batch-lease.ts", "review-batch-service.ts", "suite-result-service.ts", "issue-filing-service.ts", "known-defects-at-close.ts"]) {
      const source = readFileSync(join(PACKAGE_ROOT, "src", "service", file), "utf8");
      expect(source, file).not.toMatch(/acquire(Lease)?\(\s*["'`]review-batch/);
    }
  });
});

// ─── AC-RL-1 (CLI half) and AC-RL-4: the real `lore assess` in a throwaway corpus ────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let tmpDir: string;

function runLore(args: string[]): RunResult {
  // reason: an agent harness exports its own per-call LORE_HARNESS_RUN (a run unknown to this throwaway corpus); the test
  // run's spawn wrapper names the test's own known run when none is set, so the leaked one is removed.
  const env = stubClaudeEnv(tmpDir, join(tmpDir, "stub-bin"));
  delete env["LORE_HARNESS_RUN"];
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], { cwd: tmpDir, env, encoding: "utf8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

function createPlan(title: string): { slug: string; id: string } {
  const parent = ensureRequirementsDocSlug((a) => runLore(a));
  const r = runLore(["create", "plan", "--parent", parent, "--title", title, "--no-ai", "--content", "body"]);
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  const slug = r.stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`no plan slug in: ${r.stdout}`);
  const got = JSON.parse(runLore(["get", slug, "--json"]).stdout) as { data?: { doc?: { id?: string } } };
  const id = got.data?.doc?.id;
  if (id === undefined) throw new Error(`no plan id in: ${JSON.stringify(got)}`);
  return { slug, id };
}

/** Holds `plan:<id>` for another holder in the corpus's own database, far past any test's clock. */
function holdPlanLease(planId: string, holder: string, expiresAt: string): void {
  const dbPath = join(tmpDir, ".lore", readdirSync(join(tmpDir, ".lore")).find((f) => f.endsWith(".db")) ?? "lore.db");
  const raw = new Database(dbPath);
  raw.prepare("INSERT OR REPLACE INTO review_leases (name, holder, expires_at) VALUES (?, ?, ?)").run(planLeaseKey(planId), holder, expiresAt);
  raw.close();
}

function reviewDocsSnapshot(): string {
  return runLore(["list", "--type", "knowledge", "--json"]).stdout;
}

describe("AC-RL-1 per-plan lease: the real CLI", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-review-leases-cli-"));
    mkdirSync(tmpDir, { recursive: true });
    installStubClaude(tmpDir);
    const init = runLore(["init"]);
    if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("per-plan lease: lore assess P1 --close with P1 held exits exactly 75, prints the holder and expiry, and writes nothing", () => {
    const plan = createPlan("Held close plan");
    const expiresAt = "2099-01-01T00:00:00.000Z";
    holdPlanLease(plan.id, "other-session:assess:4242", expiresAt);
    const before = { doc: runLore(["get", plan.slug, "--json"]).stdout, knowledge: reviewDocsSnapshot() };
    const held = runLore(["assess", plan.slug, "--close"]);
    expect(held.exitCode).toBe(ASSESS_EXIT_LEASE_HELD);
    expect(held.exitCode).toBe(75);
    expect(held.stdout).toContain("other-session:assess:4242");
    expect(held.stdout).toContain(expiresAt);
    expect({ doc: runLore(["get", plan.slug, "--json"]).stdout, knowledge: reviewDocsSnapshot() }).toEqual(before);
  });

  it("per-plan lease: lore assess P1 without --close with P1 held exits exactly 75, prints the holder and expiry, and writes nothing", () => {
    const plan = createPlan("Held hand plan");
    const expiresAt = "2099-02-02T00:00:00.000Z";
    holdPlanLease(plan.id, "other-session:assess:777", expiresAt);
    const before = { doc: runLore(["get", plan.slug, "--json"]).stdout, knowledge: reviewDocsSnapshot() };
    const held = runLore(["assess", plan.slug]);
    expect(held.exitCode).toBe(75);
    expect(held.stdout).toContain("other-session:assess:777");
    expect(held.stdout).toContain(expiresAt);
    expect({ doc: runLore(["get", plan.slug, "--json"]).stdout, knowledge: reviewDocsSnapshot() }).toEqual(before);
  });
});

describe("AC-RL-4 exit codes documented", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-review-leases-codes-"));
    installStubClaude(tmpDir);
    const init = runLore(["init"]);
    if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exit codes documented: every code the command is driven to return is a key of the exported table", () => {
    const plan = createPlan("Codes plan");
    holdPlanLease(plan.id, "other:assess:1", "2099-03-03T00:00:00.000Z");
    const observed = new Map<string, number>([
      ["held plan (75)", runLore(["assess", plan.slug, "--close"]).exitCode],
      ["unknown plan (1)", runLore(["assess", "no-such-plan-anywhere", "--close"]).exitCode],
      ["--no-ai (2)", runLore(["assess", plan.slug, "--no-ai"]).exitCode],
      ["accept-gate without decision (4)", runLore(["assess", plan.slug, "--accept-gate", "security"]).exitCode],
      ["empty needs-review batch (0)", runLore(["assess", "--where", "needs-review", "--close"]).exitCode],
    ]);
    expect(Object.fromEntries(observed)).toMatchObject({ "held plan (75)": 75, "--no-ai (2)": 2, "accept-gate without decision (4)": 4, "empty needs-review batch (0)": 0 });
    for (const [what, code] of observed) expect(Object.keys(ASSESS_EXIT_CODES).map(Number), `${what} returned ${String(code)}, which the table lacks`).toContain(code);
    expect(Object.keys(ASSESS_EXIT_CODES).map(Number)).toContain(ASSESS_EXIT_LEASE_HELD);
  });

  it("exit codes documented: `lore assess --help` prints every code of the table with its meaning, 75 included", () => {
    const help = runLore(["assess", "--help"]);
    const text = help.stdout + help.stderr;
    for (const [code, meaning] of Object.entries(ASSESS_EXIT_CODES)) {
      expect(text, `help lacks exit ${code}`).toContain(`${code.padStart(2)}  ${meaning}`);
    }
    expect(text).toContain("another holder leases the plan; nothing ran; re-run later");
  });

  it("exit codes documented: the help text is rendered from the table, not written by hand", () => {
    const meta = (assessCommand as unknown as { meta: { description: string } }).meta;
    expect(meta.description).toContain(renderAssessExitCodes());
    // a code added to the table shows up in the rendering with no other edit
    const rendered = renderAssessExitCodes();
    for (const [code, meaning] of Object.entries(ASSESS_EXIT_CODES)) expect(rendered).toContain(`${code.padStart(2)}  ${meaning}`);
  });

  it("exit codes documented: the lore and lore-autopilot skills each state that assess exit 75 means another holder leases the plan, nothing ran, re-run later", () => {
    for (const skill of ["assets/skills/lore/SKILL.md", "assets/skills/lore-autopilot/SKILL.md"]) {
      const text = readFileSync(join(REPO_ROOT, skill), "utf8");
      const line = text.split("\n").find((l) => /\b75\b/.test(l) && /assess/i.test(l));
      expect(line, `${skill} has no line naming assess exit 75`).toBeDefined();
      expect(line, skill).toMatch(/another holder leases the plan/i);
      expect(line, skill).toMatch(/nothing ran/i);
      expect(line, skill).toMatch(/re-run later/i);
    }
  });
});

// ─── AC-RL-2: suite single-flight (real SuiteResultService over a real store, stub runner) ───────────────────────────

const MEASURED = (commit: string): SuiteRun => ({
  status: "measured",
  commit,
  commands: [{ command: "bun run test", exit_code: 0, output_tail: "ok" }],
  skipped: [],
  failing_test_files: [],
});

/** A runner stub that counts its calls and holds each suite run for `runMs`. */
class StubRunner implements CommitSuiteRunnerPort {
  suiteRuns: string[] = [];
  fileRuns: string[] = [];
  runMs = 20;
  /** Per-commit gates: a suite run at that commit waits until the test opens it. */
  readonly gates = new Map<string, Promise<void>>();
  async resolveCommit(ref: string) {
    return ok({ commit: ref, tree: `tree-${ref}` });
  }
  async runSuite(commit: string) {
    this.suiteRuns.push(commit);
    const held = this.gates.get(commit);
    if (held !== undefined) await held;
    else await pause(this.runMs);
    return ok(MEASURED(commit));
  }
  async runFiles(commit: string, files: readonly string[]) {
    this.fileRuns.push(`${commit}:${files.join(",")}`);
    await pause(this.runMs);
    return ok<readonly FileRunOutcome[]>(files.map((file) => ({ file, exit_code: 0, output_tail: "ok", duration_ms: 1 })));
  }
}

function suiteService(lw: LeaseWorld, holder: string | undefined): SuiteResultService {
  let counter = 0;
  return new SuiteResultService({
    store: lw.store,
    now: () => lw.iso(),
    newId: () => `suite-${holder ?? "bare"}-${String((counter += 1))}`,
    clockMs: () => counter,
    ...(holder !== undefined ? { leases: lw.leases(holder) } : {}),
  });
}

describe("AC-RL-2 suite single-flight", () => {
  it("suite single-flight: two concurrent lookups at one commit invoke the runner once and return the same stored result id", async () => {
    const lw = newWorld();
    const runner = new StubRunner();
    const [a, b] = await Promise.all([suiteService(lw, "holder-a").lookupOrRun("c1", runner), suiteService(lw, "holder-b").lookupOrRun("c1", runner)]);
    expect(runner.suiteRuns).toEqual(["c1"]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.id).toBe(b.value.id);
      expect(a.value.status).toBe("measured");
    }
    expect(lw.sleeps.length).toBeGreaterThan(0); // the second caller really waited on the key
    expect(Math.max(...lw.sleeps)).toBeLessThanOrEqual(LEASE_WAIT_POLL_MS);
    const stored = await lw.store.listSuiteResultsForCommit("c1");
    expect(stored.ok && stored.value).toHaveLength(1);
  });

  it("suite single-flight: the app's own suite service single-flights two concurrent lookups at one commit (BR-1511 binding point)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-review-leases-app-"));
    try {
      const app = createLiveApp(join(dir, "corpus.db"));
      const service = app.suiteResultService;
      expect(service).toBeDefined();
      const runner = new StubRunner();
      // reason: the app's leases use the real clock and sleep, so the waiter polls once (up to LEASE_WAIT_POLL_MS) after the holder finishes.
      const [a, b] = await Promise.all([service!.lookupOrRun("c1", runner), service!.lookupOrRun("c1", runner)]);
      expect(runner.suiteRuns).toEqual(["c1"]);
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok) expect(a.value.id).toBe(b.value.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  it("suite single-flight: without the key the same two lookups run the suite twice (the guard is the lease)", async () => {
    const lw = newWorld();
    const runner = new StubRunner();
    await Promise.all([suiteService(lw, undefined).lookupOrRun("c1", runner), suiteService(lw, undefined).lookupOrRun("c1", runner)]);
    expect(runner.suiteRuns).toEqual(["c1", "c1"]);
  });

  it("suite single-flight: two concurrent single-file runs of one file at one commit invoke the runner once and share one stored row", async () => {
    const lw = newWorld();
    const runner = new StubRunner();
    const [a, b] = await Promise.all([
      suiteService(lw, "holder-a").runSingleFile("c1", "packages/x/tests/a.test.ts", "confirm", runner),
      suiteService(lw, "holder-b").runSingleFile("c1", "packages/x/tests/a.test.ts", "confirm", runner),
    ]);
    expect(runner.fileRuns).toEqual(["c1:packages/x/tests/a.test.ts"]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value).toEqual(b.value);
    expect(lw.acquired).toContain(suiteFileLeaseKey("c1", "packages/x/tests/a.test.ts"));
  });

  it("suite single-flight: lookups at two different commits run concurrently, each runner invoked once, neither waits on the other", async () => {
    const lw = newWorld();
    const runner = new StubRunner();
    const hold = gate();
    runner.gates.set("c1", hold.wait); // c1's suite run stays open until c2 has finished
    const first = suiteService(lw, "holder-a").lookupOrRun("c1", runner);
    await pause(10);
    const second = await suiteService(lw, "holder-b").lookupOrRun("c2", runner);
    expect(second.ok).toBe(true);
    expect(runner.suiteRuns.sort()).toEqual(["c1", "c2"]);
    hold.open();
    expect((await first).ok).toBe(true);
    expect(runner.suiteRuns.sort()).toEqual(["c1", "c2"]);
    expect(lw.sleeps).toEqual([]); // no waiter existed: the keys differ
  });

  it("suite single-flight: a waiter whose holder's lease expires without a stored result runs the suite itself, polling at most every 10 seconds", async () => {
    const lw = newWorld();
    const runner = new StubRunner();
    const dead = await lw.store.acquireLease(suiteLeaseKey("c1"), "dead-holder", lw.iso(), lw.iso(lw.now + REVIEW_LEASE_EXPIRY_MS));
    expect(dead).toMatchObject({ ok: true, value: { acquired: true } });
    lw.advanceOnSleepMs = 60_000; // each poll the clock moves a minute: the dead lease expires after ten of them
    const looked = await suiteService(lw, "waiter").lookupOrRun("c1", runner);
    expect(looked.ok && looked.value.status).toBe("measured");
    expect(runner.suiteRuns).toEqual(["c1"]);
    expect(lw.sleeps.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...lw.sleeps)).toBeLessThanOrEqual(LEASE_WAIT_POLL_MS);
  });

  it("suite single-flight: a waiter re-reads the store after the wait and runs nothing when the holder stored a measured result", async () => {
    const lw = newWorld();
    const runner = new StubRunner();
    const holderRun = suiteService(lw, "holder-a").lookupOrRun("c1", runner);
    await pause(5);
    const waiterRunner = new StubRunner();
    const waited = await suiteService(lw, "holder-b").lookupOrRun("c1", waiterRunner);
    const held = await holderRun;
    expect(waiterRunner.suiteRuns).toEqual([]);
    expect(waited.ok && held.ok && waited.value.id === held.value.id).toBe(true);
  });
});

// ─── AC-RL-3: one issue per root cause ───────────────────────────────────────────────────────────────────────────────

function findingOf(plan: string): FailedFinding {
  return { plan, dimension: "security", reason: "AC-ZZ-3 is violated", reference: "", cites: ["src/token-store.ts"], reviewSlug: `review-${plan}` };
}

describe("AC-RL-3 one issue per root cause", () => {
  it("one issue per root cause: two reviews of different plans filing one fingerprint concurrently create one issue and both plans record its number", async () => {
    const lw = newWorld();
    const issues = new FakeIssues();
    issues.createDelayMs = 25;
    const [a, b] = await Promise.all([
      new IssueFilingService(issues, undefined, lw.leases("review-a")).fileFindings([findingOf("plan-a")]),
      new IssueFilingService(issues, undefined, lw.leases("review-b")).fileFindings([findingOf("plan-b")]),
    ]);
    expect(issues.creates).toBe(1);
    expect(a.ok && b.ok).toBe(true);
    const numbers = [...issues.links].map((l) => [l.plan, l.issue]);
    expect(numbers.sort()).toEqual([["plan-a", 501], ["plan-b", 501]]);
    if (a.ok && b.ok) {
      expect(a.value[0]?.issue?.number).toBe(501);
      expect(b.value[0]?.issue?.number).toBe(501);
      expect([a.value[0]?.reused, b.value[0]?.reused].sort()).toEqual([false, true]);
    }
    expect(lw.acquired.every((name) => name.startsWith(issueLeaseKey("")))).toBe(true);
  });

  it("one issue per root cause: without the issue key the same two filings create two issues (the guard is the lease)", async () => {
    const issues = new FakeIssues();
    issues.createDelayMs = 25;
    await Promise.all([new IssueFilingService(issues).fileFindings([findingOf("plan-a")]), new IssueFilingService(issues).fileFindings([findingOf("plan-b")])]);
    expect(issues.creates).toBe(2);
  });

  it("one issue per root cause: a filing whose create failed is retried under the same key and re-searches before creating", async () => {
    const lw = newWorld();
    const issues = new FakeIssues();
    const failing: IssuePort = {
      findOpenByFingerprint: (short) => issues.findOpenByFingerprint(short),
      file: async () => err<LoreError>({ code: "STORE_ERROR", message: "injected create failure" }),
      recordKnownDefects: (plan, issue, findings) => issues.recordKnownDefects(plan, issue, findings),
    };
    const first = await new IssueFilingService(failing, undefined, lw.leases("review-a")).fileFindings([findingOf("plan-a")]);
    expect(first.ok && first.value[0]?.error?.code).toBe("STORE_ERROR");
    // another review created the issue meanwhile; the retry finds it instead of creating a second one
    await issues.file({ title: "security: x [fp:" + (first.ok ? first.value[0]?.cause.short ?? "" : "") + "]" });
    const retried = await new IssueFilingService(issues, undefined, lw.leases("review-a")).fileFindings([findingOf("plan-a")]);
    expect(retried.ok && retried.value[0]).toMatchObject({ reused: true, issue: { number: 501 } });
    expect(issues.creates).toBe(1);
  });

  it("one issue per root cause: two concurrent retry passes over one pending issue write call the comment writer once and leave one done audit row", async () => {
    const lw = newWorld();
    const rows: IssueWriteAuditRow[] = [{ id: 1, details: { writes: [{ plan: "p1", issue: 7, action: "comment", body: "closing review says pass", status: "pending" }] } }];
    let comments = 0;
    const writer = {
      commentIssue: async () => {
        comments += 1;
        await pause(25);
        return ok(undefined);
      },
      closeIssue: async () => ok(undefined),
    };
    const pass = (holder: string) =>
      retryPendingIssueWrites({
        listRows: async () => ok([...rows]),
        writer,
        leases: lw.leases(holder),
        appendRow: async (details) => {
          rows.push({ id: rows.length + 1, details: { ...details } });
          return ok(undefined);
        },
      });
    const [a, b] = await Promise.all([pass("retry-a"), pass("retry-b")]);
    expect(a.ok && b.ok).toBe(true);
    expect(comments).toBe(1);
    const doneRows = rows.filter((r) => JSON.stringify(r.details).includes('"status":"done"'));
    expect(doneRows).toHaveLength(1);
    expect(lw.acquired.some((name) => name === "issue-write:7")).toBe(true);
    // a third pass after the done row finds nothing pending and writes nothing
    expect(await pass("retry-c")).toEqual({ ok: true, value: [] });
    expect(comments).toBe(1);
  });

  it("one issue per root cause: without the issue-write key two concurrent retries comment twice (the guard is the lease)", async () => {
    const rows: IssueWriteAuditRow[] = [{ id: 1, details: { writes: [{ plan: "p1", issue: 7, action: "comment", body: "b", status: "pending" }] } }];
    let comments = 0;
    const writer = {
      commentIssue: async () => {
        comments += 1;
        await pause(25);
        return ok(undefined);
      },
      closeIssue: async () => ok(undefined),
    };
    const pass = () => retryPendingIssueWrites({ listRows: async () => ok([...rows]), writer, appendRow: async (d) => (rows.push({ id: rows.length + 1, details: { ...d } }), ok(undefined)) });
    await Promise.all([pass(), pass()]);
    expect(comments).toBe(2);
  });
});
