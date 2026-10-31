/**
 * @spec_ref spec-review-test-runs-are-capped-per-machine-and-a-run-that (AC-MC-1, AC-MC-2, BR-1511, BR-1532)
 * @reads packages/lore/src/adapters/cli/commands/assess.ts
 * @reads packages/lore/src/service/review-test-slots.ts
 * @reads packages/lore/src/service/review-batch-service.ts
 * @reads packages/lore/src/**
 *
 * One review batch runs per machine and every review test run takes a machine test slot. Every case drives the real
 * services over ONE real SQLite store (a throwaway file, never the repo's `.lore/`) with an injected machine identity, process probe,
 * clock and sleep. Nothing spawns a process: the batch spawner and the test runners are fakes.
 *
 * Dimensions: HAPPY (a landing starts one batch; one run at a time), NEGATIVE (a landing under a live batch starts none; invalid slot
 * counts refused), BOUNDARY (2 slots, 3 runs; an unknown machine identity), ERROR (a failed spawn gives the key back; a failed re-take
 * exits), STATE (two concurrent landings; a plan landed during the run; the loop ends), REGRESSION (no review run bypasses the slots).
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { err, ok, parseConfig, resolveMachineTestSlots, MILESTONE_DIMENSIONS, type DocRecord, type LoreError, type MilestoneReview, type PlanBundle, type Result } from "@lore/core";
import { REVIEW_BATCH_HANDOFF_ENV, readBatchHandoff, spawnDetachedReviewBatch } from "../../src/adapters/cli/review-batch-wiring.js";
import { describeBatchStart } from "../../src/service/integrate-service.js";
import { IssueFilingService, type IssuePort, type IssueRef } from "../../src/service/issue-filing-service.js";
import { MILESTONE_REVIEW_SUB_TYPE, planStateFingerprint } from "../../src/service/milestone-review.js";
import { ReviewBatchRunner, ReviewTriggerService, type BatchHandoff, type BatchRunPorts, type MachineBatchPorts } from "../../src/service/review-batch-service.js";
import { ReviewLeases, planLeaseKey, type LeaseOutcome } from "../../src/service/review-batch-lease.js";
import type { LocalProcessIdentity, ProcessProbe } from "../../src/service/review-lease-liveness.js";
import type { ReviewTestSlots } from "../../src/service/review-test-slots.js";
import { coverFailedDimensions } from "../../src/service/milestone-review-inputs.js";
import type { CommitSuiteRunnerPort } from "../../src/service/suite-result-service.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { noDecisionLog } from "../helpers/gate-acceptance-log.js";

const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const START_A = "2026-11-01T08:00:00.000Z";
const START_B = "2026-11-01T09:30:00.000Z";
const MACHINE = "m1";
// literals, not the key builders: the spec's key shapes are the contract, and a builder call at import would fail collection on a tree without it
const BATCH_KEY = "batch:m1";
const SLOT_0 = "test-slot:m1:0";
// reason: the slots module is loaded in a `beforeEach` of the slot describes, not at import, so a tree without it fails each slot test (a
// runner-visible red) instead of failing the file's collection, which a runner reports as "no tests" and the red-first floor cannot tell
// from a broken command. (`beforeAll` would SKIP the tests instead of failing them.)
let slotsModule: typeof import("../../src/service/review-test-slots.js");
const loadSlotsModule = async (): Promise<void> => {
  slotsModule = await import("../../src/service/review-test-slots.js");
};

const BASE_CONFIG ={ project: { name: "fixture", author: "fixture" } };
const identityOf = (pid: number, startIso = START_A, machineId = MACHINE): LocalProcessIdentity => ({ machineId, pid, startIso });

class World {
  readonly dir = mkdtempSync(join(tmpdir(), "lore-machine-cap-"));
  readonly store = new SQLiteStore(join(this.dir, "corpus.db"));
  /** pid -> alive process with its start time; a pid absent is "no such process" (dead). */
  readonly processes = new Map<number, { startTime: string }>();
  readonly probe: ProcessProbe = async (pid) => {
    const entry = this.processes.get(pid);
    return ok(entry === undefined ? { alive: false, startTime: null } : { alive: true, startTime: entry.startTime });
  };

  /** One process's leases; a live process is registered so the probe sees it. `null` identity = no machine identity. */
  leasesFor(identity: LocalProcessIdentity | null, base = "proc"): ReviewLeases {
    if (identity !== null) this.processes.set(identity.pid, { startTime: identity.startIso });
    return new ReviewLeases(this.store, base, () => T0, () => () => undefined, async () => undefined, { identity: async () => identity, probe: this.probe });
  }

  close(): void {
    this.store.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

const worlds: World[] = [];
function world(): World {
  const w = new World();
  worlds.push(w);
  return w;
}
afterEach(() => {
  for (const w of worlds.splice(0)) w.close();
});

async function heldOf(outcome: Promise<Result<LeaseOutcome, LoreError>>): Promise<Extract<LeaseOutcome, { state: "held" }>> {
  const taken = await outcome;
  if (!taken.ok || taken.value.state !== "held") throw new Error(`expected held, got ${JSON.stringify(taken)}`);
  return taken.value;
}

// ── fixtures: plans, a fake judge, a fake tracker ──────────────────────────────────────────────────────────────────

function stubDoc(partial: Record<string, unknown>): DocRecord {
  return { deleted_at: null, created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z", version: 1, content: "", tags: [], parent_id: null, ...partial } as unknown as DocRecord;
}

interface FakePlan {
  readonly slug: string;
  bundle: PlanBundle;
  docs: DocRecord[];
  archived: boolean;
  /** `not-measured`: the judge leaves regression not measured (cause unrunnable): the plan is kept open and stays in the trigger set. */
  verdict: "pass" | "regression-not-measured";
}

function makePlan(slug: string, verdict: FakePlan["verdict"] = "pass"): FakePlan {
  const plan = stubDoc({ id: `id-${slug}`, slug, type: "plan", status: "active", title: slug, extra: { progress: { state: "complete", open: 0, total: 1, at: "2026-11-01T00:00:00.000Z" } } });
  const task = stubDoc({ id: `id-${slug}-t1`, slug: `${slug}-t1`, type: "task", status: "archived", title: "t", extra: {} });
  const spec = stubDoc({ id: `id-spec-${slug}`, slug: `spec-${slug}`, type: "spec", status: "approved", title: "s", extra: { acceptance_criteria: [{ id: "AC-W-1", statement: "works", verify: { mode: "human" } }] } });
  return { slug, bundle: { plan, spec, tasks: [task] } as unknown as PlanBundle, docs: [], archived: false, verdict };
}

/** The plan's own task lands again: its stored state, hence its fingerprint, changes. */
function landOwnTask(plan: FakePlan): void {
  const task = plan.bundle.tasks[0];
  if (task === undefined) throw new Error("fixture plan has no task");
  plan.bundle = { ...plan.bundle, tasks: [{ ...task, version: task.version + 1 }] } as unknown as PlanBundle;
}

class FakeIssuePort implements IssuePort {
  readonly open: { number: number; title: string }[] = [];
  readonly links: { plan: string; issue: number; dimensions: string[] }[] = [];
  async findOpenByFingerprint(short: string) {
    const hit = this.open.find((i) => i.title.includes(`[fp:${short}]`));
    return ok<IssueRef | undefined>(hit === undefined ? undefined : { number: hit.number });
  }
  async file(input: { title: string }) {
    const number = 100 + this.open.length + 1;
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

/** Plans, judge, tracker and the real trigger and runner. `onSuite` runs inside each pass's one measurement (a landing during the run). */
class Batches {
  readonly plans = new Map<string, FakePlan>();
  readonly issues = new FakeIssuePort();
  judgeCalls: string[] = [];
  suiteCalls = 0;
  triggerReads = 0;
  onSuite: (pass: number) => void | Promise<void> = () => undefined;

  add(plan: FakePlan): FakePlan {
    this.plans.set(plan.slug, plan);
    return plan;
  }
  private find(ref: string): FakePlan {
    const plan = [...this.plans.values()].find((p) => p.slug === ref || p.bundle.plan.id === ref);
    if (plan === undefined) throw new Error(`unknown plan ${ref}`);
    return plan;
  }
  private coverage = async (planId: string, failed: readonly string[]) => {
    const slug = this.find(planId).slug;
    const openNumbers = new Set(this.issues.open.map((i) => i.number));
    const entries = this.issues.links.filter((l) => l.plan === slug).flatMap((l) => l.dimensions.map((dimension) => ({ number: l.issue, dimension, state: openNumbers.has(l.issue) ? ("open" as const) : ("closed" as const) })));
    return ok(coverFailedDimensions(failed, entries));
  };

  trigger(batchLease?: ReviewLeases, spawn: (handoff: BatchHandoff) => Result<{ pid: number | undefined }, LoreError> = () => ok({ pid: 4242 })): ReviewTriggerService {
    return new ReviewTriggerService({
      listPlans: async () => ok([...this.plans.values()].filter((p) => !p.archived).map((p) => p.bundle.plan)),
      getPlanBundle: async (ref) => ok(this.find(ref).bundle),
      listReviewDocs: async (planId) => ok(this.find(planId).docs),
      pendingDecisionSubjects: async () => ok(new Set<string>()),
      issueCoverage: this.coverage,
      spawnBatch: spawn,
      ...(batchLease !== undefined ? { batchLease } : {}),
    });
  }

  runner(): ReviewBatchRunner {
    return new ReviewBatchRunner({ getPlanBundle: async (ref) => ok(this.find(ref).bundle), listReviewDocs: async (planId) => ok(this.find(planId).docs), issueCoverage: this.coverage, acceptanceLog: noDecisionLog() });
  }

  /** The per-plan ports of a batch process holding `leases`. */
  batchPorts(leases: ReviewLeases): BatchRunPorts {
    return {
      acquirePlanLease: (planId) => leases.acquire(planLeaseKey(planId)),
      mode: "batch",
      settleRetirement: async () => ok({ state: "none" as const }),
      measureSuite: async () => {
        this.suiteCalls += 1;
        await this.onSuite(this.suiteCalls);
        return undefined;
      },
      reviewPlan: async (ref) => this.judge(ref),
      closePlan: async (ref) => {
        this.find(ref).archived = true;
        return ok(undefined);
      },
      recordError: async () => ok(undefined),
      filing: new IssueFilingService(this.issues),
      now: () => new Date(T0).toISOString(),
    };
  }

  /** The machine batch's ports: a step limit on trigger reads turns a loop that never ends into a failure, not a hang. */
  machinePorts(leases: ReviewLeases, lease: MachineBatchPorts["lease"], stepLimit = 12): MachineBatchPorts {
    const trigger = this.trigger();
    return {
      batch: this.batchPorts(leases),
      lease,
      retakeLease: () => leases.acquire(BATCH_KEY),
      readTriggerSet: async () => {
        this.triggerReads += 1;
        if (this.triggerReads > stepLimit) throw new Error(`step limit: the batch re-read the trigger set ${String(this.triggerReads)} times without ending`);
        const set = await trigger.computeTriggerSet();
        return set.ok ? ok(set.value.map((entry) => entry.plan)) : set;
      },
    };
  }

  async judge(ref: string) {
    const plan = this.find(ref);
    this.judgeCalls.push(plan.slug);
    const notMeasured = plan.verdict === "regression-not-measured";
    const dimensions = Object.fromEntries(
      MILESTONE_DIMENSIONS.map((d) => [d, d === "regression" && notMeasured ? { verdict: "not-measured", reason: "the suite could not complete", reference: "fixture", cites: ["src/fixture.ts"] } : { verdict: "pass", reason: "ok", reference: "fixture" }]),
    ) as MilestoneReview["dimensions"];
    const review: MilestoneReview = {
      plan_id: plan.bundle.plan.id,
      fingerprint: planStateFingerprint(plan.bundle.plan, plan.bundle.tasks, plan.bundle.spec),
      overall: "pass",
      dimensions,
      decisions: [],
      ...(notMeasured ? { regression_causes: ["unrunnable" as const] } : {}),
      prompt_version: "fixture",
      diff_source: "fixture",
    };
    const doc = stubDoc({ id: `rev-${String(this.judgeCalls.length)}`, slug: `review-${plan.slug}-${String(this.judgeCalls.length)}`, type: "knowledge", extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review } });
    plan.docs.push(doc);
    return ok({ doc, review });
  }
}

// ── AC-MC-1 ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("AC-MC-1: one batch per machine", () => {
  it("a landing while another live holder has batch:<machine> starts no batch and prints that the running batch covers it", async () => {
    const w = world();
    const b = new Batches();
    b.add(makePlan("p-needs"));
    const running = await heldOf(w.leasesFor(identityOf(111), "batch").acquire(BATCH_KEY));
    let spawns = 0;
    const started = await b.trigger(w.leasesFor(identityOf(222, START_B), "landing"), () => {
      spawns += 1;
      return ok({ pid: 1 });
    }).start();
    expect(spawns).toBe(0);
    expect(started.ok && started.value).toMatchObject({ state: "covered", triggered: 1, key: BATCH_KEY, machineUnknown: false, holder: running.handle.holder });
    if (!started.ok) throw new Error("start failed");
    const line = describeBatchStart(started.value);
    expect(line).toContain("covers this landing");
    expect(line).toContain(BATCH_KEY);
    expect(line).toContain(running.handle.holder);
  });

  it("two concurrent landings start exactly one batch (the take is one atomic acquire)", async () => {
    const w = world();
    const b = new Batches();
    b.add(makePlan("p-needs"));
    let spawns = 0;
    const spawn = (): Result<{ pid: number | undefined }, LoreError> => {
      spawns += 1;
      return ok({ pid: 4242 });
    };
    const [first, second] = await Promise.all([b.trigger(w.leasesFor(identityOf(301), "landing-a"), spawn).start(), b.trigger(w.leasesFor(identityOf(302), "landing-b"), spawn).start()]);
    expect(spawns).toBe(1);
    const states = [first, second].map((r) => (r.ok ? r.value.state : "error")).sort();
    expect(states).toEqual(["covered", "started"]);
  });

  it("the batch lease passes from the landing to the batch it spawned by one compare-and-set; a later landing is then covered by the child", async () => {
    const w = world();
    const b = new Batches();
    b.add(makePlan("p-needs"));
    const child = w.leasesFor(identityOf(777, START_B), "batch-child");
    let handedOff: BatchHandoff | undefined;
    const started = await b.trigger(w.leasesFor(identityOf(401), "landing"), (handoff) => {
      handedOff = handoff;
      return ok({ pid: 777 });
    }).start();
    expect(started.ok && started.value.state).toBe("started");
    // the starter's process is still alive; the child takes the lease from its exact holder name
    const row = await w.store.readLease(BATCH_KEY);
    if (!row.ok || row.value === null) throw new Error("the starter left no lease row");
    expect(handedOff).toEqual({ key: BATCH_KEY, holder: row.value.holder });
    const wrong = await child.acquireHandedOff(BATCH_KEY, "someone-else");
    expect(wrong.ok && wrong.value.state).toBe("busy");
    const childHandle = await heldOf(child.acquireHandedOff(BATCH_KEY, row.value.holder));
    expect(childHandle.tookOver).toBe(true);
    const after = await w.store.readLease(BATCH_KEY);
    expect(after.ok && after.value?.holder).toBe(childHandle.handle.holder);
    const later = await b.trigger(w.leasesFor(identityOf(402, START_B), "landing-2")).start();
    expect(later.ok && later.value).toMatchObject({ state: "covered", holder: childHandle.handle.holder });
  });

  it("a spawn that fails gives the key back, so the next landing can start the batch", async () => {
    const w = world();
    const b = new Batches();
    b.add(makePlan("p-needs"));
    const failed = await b.trigger(w.leasesFor(identityOf(501), "landing"), () => err<LoreError>({ code: "VALIDATION_ERROR", field: "spawn", message: "no run" })).start();
    expect(failed.ok).toBe(false);
    const retry = await b.trigger(w.leasesFor(identityOf(502), "landing-2")).start();
    expect(retry.ok && retry.value.state).toBe("started");
  });

  it("a dead batch holder's lease is taken over at once by the next landing", async () => {
    const w = world();
    const b = new Batches();
    b.add(makePlan("p-needs"));
    await heldOf(w.leasesFor(identityOf(601), "batch").acquire(BATCH_KEY));
    w.processes.delete(601);
    const started = await b.trigger(w.leasesFor(identityOf(602, START_B), "landing")).start();
    expect(started.ok && started.value.state).toBe("started");
  });

  it("with an unknown machine identity the key is batch:unknown and the output names it", async () => {
    const w = world();
    const b = new Batches();
    b.add(makePlan("p-needs"));
    const started = await b.trigger(w.leasesFor(null, "landing")).start();
    expect(started.ok && started.value).toMatchObject({ state: "started", key: "batch:unknown", machineUnknown: true });
    if (!started.ok) throw new Error("start failed");
    expect(describeBatchStart(started.value)).toContain("batch:unknown");
    const held = await w.store.readLease("batch:unknown");
    expect(held.ok && held.value).not.toBeNull();
  });

  it("lore integrate wires the batch lease into the trigger, and the production spawn refuses a start with no handoff", async () => {
    const integrate = readFileSync(new URL("../../src/adapters/cli/commands/integrate.ts", import.meta.url), "utf8");
    expect(integrate).toMatch(/buildReviewTriggerService\(app,[\s\S]*?\bbatchLeases,\s*\)/);
    expect(integrate).toMatch(/buildReviewLeases\(app, `\$\{resolveActor\(inv\)\}:integrate:/);
    const refused = await spawnDetachedReviewBatch({
      handoff: undefined,
      cwd: "/nowhere",
      corpusDir: "/nowhere",
      execPath: "/nowhere/lore",
      isCompiled: true,
      env: {},
      runService: undefined,
      caller: { claimedRun: null, verified: { ok: true, value: undefined } },
    });
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).toContain("no batch lease");
    // the handoff the child reads back is exactly what the starter wrote
    expect(readBatchHandoff({ [REVIEW_BATCH_HANDOFF_ENV]: JSON.stringify({ key: BATCH_KEY, holder: "h" }) })).toEqual({ ok: true, value: { key: BATCH_KEY, holder: "h" } });
    expect(readBatchHandoff({})).toEqual({ ok: true, value: undefined });
    expect(readBatchHandoff({ [REVIEW_BATCH_HANDOFF_ENV]: "{not json" }).ok).toBe(false);
  });

  it("an empty trigger set starts nothing and takes no lease", async () => {
    const w = world();
    const b = new Batches();
    const started = await b.trigger(w.leasesFor(identityOf(701), "landing")).start();
    expect(started.ok && started.value.state).toBe("empty");
    const row = await w.store.readLease(BATCH_KEY);
    expect(row.ok && row.value).toBeNull();
  });
});

describe("AC-MC-1: one batch per machine: the batch re-reads the trigger set after releasing, and the loop ends", () => {
  it("a plan that landed during the run is reviewed by the same batch before it exits", async () => {
    const w = world();
    const b = new Batches();
    b.add(makePlan("p-first"));
    const process = w.leasesFor(identityOf(801, START_B), "batch");
    const lease = await heldOf(process.acquire(BATCH_KEY));
    b.onSuite = (pass) => {
      if (pass === 1) b.add(makePlan("p-landed-during-run"));
    };
    const run = await b.runner().runMachineBatch(["p-first"], b.machinePorts(process, lease.handle));
    expect(run.ok && run.value).toMatchObject({ passes: 2, ended: "drained" });
    expect(b.judgeCalls).toEqual(["p-first", "p-landed-during-run"]);
    expect([...b.plans.values()].every((p) => p.archived)).toBe(true);
    const row = await w.store.readLease(BATCH_KEY);
    expect(row.ok && row.value).toBeNull();
  });

  it("a plan held by another holder and a plan kept open with regression not measured stay in the trigger set yet the batch exits after one pass", async () => {
    const w = world();
    const b = new Batches();
    b.add(makePlan("p-kept-open", "regression-not-measured"));
    const held = b.add(makePlan("p-held-elsewhere"));
    const other = w.leasesFor(identityOf(901), "other-batch");
    await heldOf(other.acquire(planLeaseKey(held.bundle.plan.id)));
    const process = w.leasesFor(identityOf(902, START_B), "batch");
    const lease = await heldOf(process.acquire(BATCH_KEY));
    const run = await b.runner().runMachineBatch(["p-kept-open", "p-held-elsewhere"], b.machinePorts(process, lease.handle));
    expect(run.ok && run.value).toMatchObject({ passes: 1, ended: "drained" });
    if (!run.ok) throw new Error("batch failed");
    expect(run.value.rows.map((r) => `${r.plan}:${r.outcome}:${r.detail}`)).toEqual([expect.stringMatching(/^p-kept-open:kept-open:/), expect.stringMatching(/^p-held-elsewhere:skipped:/)]);
    // both are still in the trigger set, yet nothing was visited twice
    const set = await b.trigger().computeTriggerSet();
    expect(set.ok && set.value.map((e) => e.plan).sort()).toEqual(["p-held-elsewhere", "p-kept-open"]);
    expect(b.judgeCalls).toEqual(["p-kept-open"]);
    expect(b.suiteCalls).toBe(1);
    expect(b.triggerReads).toBe(1);
  });

  it("a plan whose fingerprint changed during the run is visited again once, then the loop ends", async () => {
    const w = world();
    const b = new Batches();
    const kept = b.add(makePlan("p-kept-open", "regression-not-measured"));
    const process = w.leasesFor(identityOf(1001, START_B), "batch");
    const lease = await heldOf(process.acquire(BATCH_KEY));
    b.onSuite = (pass) => {
      if (pass === 1) landOwnTask(kept);
    };
    const run = await b.runner().runMachineBatch(["p-kept-open"], b.machinePorts(process, lease.handle));
    expect(run.ok && run.value).toMatchObject({ passes: 2, ended: "drained" });
    expect(b.judgeCalls.length).toBeLessThanOrEqual(3);
    expect(b.triggerReads).toBeLessThanOrEqual(2);
  });

  it("when the re-take fails because another batch started, the batch exits and judges nothing more", async () => {
    const w = world();
    const b = new Batches();
    b.add(makePlan("p-first"));
    const process = w.leasesFor(identityOf(1101, START_B), "batch");
    const lease = await heldOf(process.acquire(BATCH_KEY));
    const rival = w.leasesFor(identityOf(1102, START_B), "rival");
    let rivalHeld: Extract<LeaseOutcome, { state: "held" }> | undefined;
    b.onSuite = (pass) => {
      if (pass === 1) b.add(makePlan("p-landed-during-run"));
    };
    const ports = b.machinePorts(process, lease.handle);
    const run = await b.runner().runMachineBatch(["p-first"], {
      ...ports,
      readTriggerSet: async () => {
        // the lease is released before this read: a landing's start takes it now, the batch's re-take then fails
        rivalHeld = await heldOf(rival.acquire(BATCH_KEY));
        return ports.readTriggerSet();
      },
    });
    expect(run.ok && run.value).toMatchObject({ passes: 1, ended: "covered" });
    expect(run.ok && run.value.coveredBy?.holder).toBe(rivalHeld?.handle.holder);
    expect(b.judgeCalls).toEqual(["p-first"]);
    const row = await w.store.readLease(BATCH_KEY);
    expect(row.ok && row.value?.holder).toBe(rivalHeld?.handle.holder);
  });

  it("the batch lease is released when the run ends in an error", async () => {
    const w = world();
    const b = new Batches();
    b.add(makePlan("p-first"));
    const process = w.leasesFor(identityOf(1201, START_B), "batch");
    const lease = await heldOf(process.acquire(BATCH_KEY));
    const ports = b.machinePorts(process, lease.handle);
    const run = await b.runner().runMachineBatch(["p-first"], { ...ports, readTriggerSet: async () => err<LoreError>({ code: "STORE_ERROR", message: "boom" }) });
    expect(run.ok).toBe(false);
    const row = await w.store.readLease(BATCH_KEY);
    expect(row.ok && row.value).toBeNull();
  });
});

// ── AC-MC-2 ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A fake runner that records, for each invocation, when it started and ended; `hold` keeps one invocation running until released. */
class FakeRunner {
  readonly spans: { kind: string; start: number; end: number }[] = [];
  running = 0;
  maxRunning = 0;
  constructor(private readonly workMs = 25) {}
  async run<T>(kind: string, value: T): Promise<Result<T, LoreError>> {
    const start = performance.now();
    this.running += 1;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    await new Promise((resolve) => setTimeout(resolve, this.workMs));
    this.running -= 1;
    this.spans.push({ kind, start, end: performance.now() });
    return ok(value);
  }
}

function suiteRunnerOf(fake: FakeRunner): CommitSuiteRunnerPort {
  return {
    resolveCommit: async () => ok({ commit: "c", tree: "t" }),
    runFiles: (_commit, files) => fake.run("single-file", files.map((file) => ({ file, exit_code: 0, output_tail: "", duration_ms: 1 }))),
    runFilesTogether: (_commit, files) => fake.run("chunk", files.map((file) => ({ file, exit_code: 0, output_tail: "", duration_ms: 1 }))),
  };
}

function slotsFor(w: World, identity: LocalProcessIdentity | null, slots: number, say: (line: string) => void = () => undefined, sleepCalls?: number[]): ReviewTestSlots {
  return new slotsModule.ReviewTestSlots({
    leases: w.leasesFor(identity, `proc-${String(identity?.pid ?? "x")}`),
    slots,
    sleep: async (ms) => {
      sleepCalls?.push(ms);
      await new Promise((resolve) => setTimeout(resolve, 3));
    },
    clock: () => T0,
    say,
  });
}

describe("AC-MC-2: test slots", () => {
  beforeEach(loadSlotsModule);

  it("with 1 slot a selection chunk, a head recheck, a bisection run, a criteria run and a direct assess run one at a time", async () => {
    const w = world();
    const fake = new FakeRunner();
    const batchSlots = slotsFor(w, identityOf(2001), 1);
    const directSlots = slotsFor(w, identityOf(2002, START_B), 1);
    const batchRunner = slotsModule.slotCommitSuiteRunner(suiteRunnerOf(fake), batchSlots);
    const directRunner = slotsModule.slotCommitSuiteRunner(suiteRunnerOf(fake), directSlots);
    const criteria = slotsModule.slotCriterionRerunner({ rerun: async () => fake.run("criteria", { passed: true, detail: "pass" }) }, batchSlots);
    const refresh = slotsModule.slotStaleRefresher({ runAcs: async () => fake.run("refresh", undefined) }, batchSlots);
    const results = await Promise.all([
      batchRunner.runFilesTogether?.("c", ["a.test.ts", "b.test.ts"]),
      batchRunner.runFiles("c", ["recheck.test.ts"]),
      batchRunner.runFiles("c~1", ["bisect.test.ts"]),
      criteria.rerun({ slug: "spec-x" }, "AC-X-1"),
      refresh.runAcs("plan-x", ["AC-X-1"]),
      directRunner.runFiles("c", ["direct.test.ts"]),
    ]);
    expect(results.every((r) => r !== undefined && r.ok)).toBe(true);
    expect(fake.spans).toHaveLength(6);
    expect(fake.maxRunning).toBe(1);
    const ordered = [...fake.spans].sort((a, b) => a.start - b.start);
    for (let i = 1; i < ordered.length; i += 1) expect(ordered[i]?.start ?? 0).toBeGreaterThanOrEqual(ordered[i - 1]?.end ?? Infinity);
    expect(new Set(fake.spans.map((s) => s.kind))).toEqual(new Set(["chunk", "single-file", "criteria", "refresh"]));
  });

  it("the waiting run names the holder once", async () => {
    const w = world();
    const holderProcess = w.leasesFor(identityOf(2101), "holder");
    const holding = await heldOf(holderProcess.acquire(SLOT_0));
    const lines: string[] = [];
    const sleeps: number[] = [];
    const waiter = slotsFor(w, identityOf(2102, START_B), 1, (line) => lines.push(line), sleeps);
    const run = waiter.run(async () => ok("ran"));
    // reason: the waiter polls on an injected 3 ms sleep; wait for several polls by count, never by a fixed span (a loaded machine stretches it)
    for (let waited = 0; sleeps.length <= 2 && waited < 400; waited += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(sleeps.length).toBeGreaterThan(2);
    await holding.handle.release();
    expect(await run).toEqual({ ok: true, value: "ran" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(holding.handle.holder);
    expect(lines[0]).toContain(SLOT_0);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(10_000);
  });

  it("with 2 slots two runs run at once and a third waits", async () => {
    const w = world();
    const fake = new FakeRunner(60);
    const lines: string[] = [];
    const slots = slotsFor(w, identityOf(2201), 2, (line) => lines.push(line));
    const runs = await Promise.all([slots.run(() => fake.run("a", 1)), slots.run(() => fake.run("b", 2)), slots.run(() => fake.run("c", 3))]);
    expect(runs.every((r) => r.ok)).toBe(true);
    expect(fake.maxRunning).toBe(2);
    const ordered = [...fake.spans].sort((a, b) => a.start - b.start);
    expect(ordered[2]?.start ?? 0).toBeGreaterThanOrEqual(Math.min(ordered[0]?.end ?? Infinity, ordered[1]?.end ?? Infinity));
    expect(lines).toHaveLength(1);
  });

  it("a slot held by a dead process is freed at once", async () => {
    const w = world();
    await heldOf(w.leasesFor(identityOf(2301), "holder").acquire(SLOT_0));
    w.processes.delete(2301);
    const lines: string[] = [];
    const sleeps: number[] = [];
    const run = await slotsFor(w, identityOf(2302, START_B), 1, (line) => lines.push(line), sleeps).run(async () => ok("ran"));
    expect(run).toEqual({ ok: true, value: "ran" });
    expect(lines).toEqual([]);
    expect(sleeps).toEqual([]);
  });

  it("a run releases its slot when its work fails or throws", async () => {
    const w = world();
    const slots = slotsFor(w, identityOf(2401), 1);
    const failed = await slots.run(async () => err<LoreError>({ code: "STORE_ERROR", message: "run failed" }));
    expect(failed.ok).toBe(false);
    await expect(
      slots.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const row = await w.store.readLease(SLOT_0);
    expect(row.ok && row.value).toBeNull();
  });

  it("a test-slot holder never waits for another key: only test-slot keys are ever taken, and none is taken while the run works", async () => {
    const w = world();
    const taken: string[] = [];
    const real = w.leasesFor(identityOf(2501), "recording");
    const recording = { machineId: () => real.machineId(), acquire: (key: string) => (taken.push(key), real.acquire(key)) };
    const slots = new slotsModule.ReviewTestSlots({ leases: recording, slots: 2, sleep: async () => undefined, clock: () => T0, say: () => undefined });
    let takenDuringWork = -1;
    await slots.run(async () => {
      const before = taken.length;
      await new Promise((resolve) => setTimeout(resolve, 5));
      takenDuringWork = taken.length - before;
      return ok(undefined);
    });
    expect(takenDuringWork).toBe(0);
    expect(taken.length).toBeGreaterThan(0);
    expect(taken.every((key) => key.startsWith("test-slot:"))).toBe(true);
    const source = readFileSync(new URL("../../src/service/review-test-slots.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/planLeaseKey|suiteFileLeaseKey|issueLeaseKey|issueWriteLeaseKey|batchLeaseKey/);
  });

  it("slotting only batch runs would let a direct assess overlap: the direct runner shares the same slot keys", async () => {
    const w = world();
    const fake = new FakeRunner(30);
    const batchRunner = slotsModule.slotCommitSuiteRunner(suiteRunnerOf(fake), slotsFor(w, identityOf(2601), 1));
    const directRunner = slotsModule.slotCommitSuiteRunner(suiteRunnerOf(fake), slotsFor(w, identityOf(2602, START_B), 1));
    await Promise.all([batchRunner.runFiles("c", ["a.test.ts"]), directRunner.runFiles("c", ["b.test.ts"])]);
    expect(fake.maxRunning).toBe(1);
  });

  it("machine_test_slots 0, -1 or 'two' is refused at config load naming the key; 1 and 2 are accepted; absent is 1", () => {
    for (const bad of [0, -1, "two", 1.5]) {
      const parsed = parseConfig({ ...BASE_CONFIG, workflow: { review: { machine_test_slots: bad } } });
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(JSON.stringify(parsed.error)).toContain("workflow.review.machine_test_slots");
    }
    for (const good of [1, 2]) {
      const parsed = parseConfig({ ...BASE_CONFIG, workflow: { review: { machine_test_slots: good } } });
      expect(parsed.ok && resolveMachineTestSlots(parsed.value)).toBe(good);
    }
    const absent = parseConfig(BASE_CONFIG);
    expect(absent.ok && resolveMachineTestSlots(absent.value)).toBe(1);
    expect(resolveMachineTestSlots(undefined)).toBe(1);
  });
});

describe("AC-MC-2: test slots: no review run bypasses the slots", () => {
  const SRC = join(new URL("../../src", import.meta.url).pathname);
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
    });

  it("every runner and rerunner the review builds in assess.ts is wrapped by its slot decorator", () => {
    const assess = readFileSync(join(SRC, "adapters/cli/commands/assess.ts"), "utf8");
    const wrapped: [string, string][] = [
      ["createGitCommitSuiteRunner(", "slotCommitSuiteRunner("],
      ["createAppCriterionRerunner(", "slotCriterionRerunner("],
      ["createAppStaleRefresher(", "slotStaleRefresher("],
    ];
    for (const [factory, decorator] of wrapped) {
      const uses = [...assess.matchAll(new RegExp(factory.replace("(", "\\("), "g"))].filter((m) => !assess.slice(0, m.index).endsWith("import { ") && !/^\s*import/.test(assess.slice(assess.lastIndexOf("\n", m.index) + 1, m.index)));
      expect(uses.length).toBeGreaterThan(0);
      for (const use of uses) {
        const before = assess.slice(Math.max(0, (use.index ?? 0) - 300), use.index);
        expect(before.replace(/\s+/g, " ")).toMatch(new RegExp(`${decorator.replace("(", "\\(")}\\s*$`));
      }
    }
  });

  it("no other source file builds a review test runner", () => {
    for (const file of sourceFiles(SRC)) {
      if (file.endsWith("commands/assess.ts") || file.endsWith("assess-suite-runner.ts") || file.endsWith("assess-stale-refresh.ts")) continue;
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/createGitCommitSuiteRunner\(|createAppCriterionRerunner\(|createAppStaleRefresher\(/);
    }
  });
});
