/**
 * @spec_ref spec-lifecycle-archival-plan-close-cascade-deterministic
 *   §Candidate Rules R1, §Design Decisions D2, AC-097-2
 *
 * Proves the R1 plan-close cascade wired into `CorpusService.set` — archiving a
 * plan's SAME logical write cascades its direct `task`/`knowledge`(handoff)
 * children: an unclaimed task and a plan-parented handoff are archived, each with
 * its OWN audit entry (`action: "archive-cascade"`); a FRESH-claimed task is
 * skipped and named in the returned `cascade.skipped[]`; the audit hash chain
 * (SPEC-079 G3) stays valid throughout.
 *
 * bun test (not vitest) — real `createApp()` SQLite store (`bun:sqlite`), the
 * same in-process idiom as `gate-enforcer-service-layer.bun.test.ts` /
 * `attestation-floor.test.ts`'s harness shape. Chosen over vitest specifically
 * because `AuditService.verify`'s hash-chain walk (SPEC-079 G3) is computed by
 * the REAL store, never `InMemoryStore`.
 *
 * ⛔ Never touches the repo's own `.lore/` corpus — every test operates inside
 * its own `mkdtempSync` directory (project CLAUDE.md hard rule).
 *
 * RE-BASELINED by spec-approval-and-plan-closure-go-through-the-same-checks-on
 * (AC-AP-4, BR-1072, issue #47). The cascade now archives a member task only when
 * it clears every floor `lore done` checks (attested pass, red-first, no-new-tests,
 * unfiltered-run), checked through the injected DoneFloorPort. Locked AC-097-2's
 * oracle stays green for floor-clearing tasks: the HAPPY case and the REGRESSION
 * case below used to archive a task holding NO evidence at all (original assertion:
 * `cascade.archived` ids equal [task, handoff] and `cascade.skipped` equals [] for
 * an unattested task). That assertion is exactly the defect #47 reports, so the
 * fixture task now holds a runner-attested pass before the plan closes and the
 * assertion is otherwise unchanged. The AC-AP-4 block at the bottom pins the new
 * floor behaviour (T1..T4 + handoff H, gate on and off, parity with `lore done`).
 *
 * Six-dimension coverage:
 *   HAPPY:      archiving an approved plan cascades its unclaimed task and its
 *               plan-parented handoff to `archived`, each with a distinguishable
 *               `archive-cascade` audit entry
 *   NEGATIVE:   a FRESH-claimed sibling task is NOT archived by the cascade
 *   BOUNDARY:   a task already `archived` before the cascade runs is neither
 *               re-archived nor reported as failed (silently correct, nothing to do)
 *   STATE:      the plan's own version/status transition commits regardless of
 *               cascade outcome (no children at all) — the cascade never rolls
 *               back the plan's own write
 *   ERROR:      n/a at this layer (a cascade failure surfaces via `cascade.failed[]`,
 *               not a thrown exception or an `err()` on the whole `set()` call —
 *               covered structurally by the "never rolls back" STATE case above)
 *   REGRESSION: `AuditService.verify` reports `clean: true` after the cascade —
 *               the hash chain never breaks
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp, type App } from "../../src/app.js";
import type { CreateDocInput, DocRecord, LoreConfig } from "@lore/core";
import type { VerifiedEvidenceInput } from "../../src/service/task-workflow-service.js";
import type { PlanCloseCascadeResult } from "../../src/service/corpus-service.js";
import { liveAmbient, liveWriteContext } from "../live-invocation.js";
import { runOfName } from "../helpers/test-run-identity.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-plan-close-cascade-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient(), liveWriteContext());
  app.close();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function dbPath(): string {
  return join(tmpDir, ".lore", "lore.db");
}

/** `createApp(dbPath, config)` always returns a bare App here — `sync` is absent. */
function openApp(extra: Record<string, unknown> = {}): App {
  // reason: plans are judged by default (BR-281 / BR-1237); this suite approves a plan only to reach the
  // plan-close cascade it tests, never review-judgment, so M2 is emptied unless a caller's `workflow` says otherwise.
  const extraWorkflow = (extra["workflow"] ?? {}) as Record<string, unknown>;
  const config: LoreConfig = {
    project: { name: "plan-close-cascade-test", author: "tester" },
    ...extra,
    workflow: { review: { judgment_required_types: [] }, ...extraWorkflow },
  } as unknown as LoreConfig;
  return createApp(dbPath(), config, liveAmbient(), liveWriteContext()) as App;
}

/** A runner-attested pass — the only shape that clears `lore done`'s attested-pass floor. */
function attestedPass(): VerifiedEvidenceInput {
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "runner",
    capture_source: "runner",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
  };
}

async function giveAttestedPass(app: App, task: DocRecord): Promise<void> {
  const r = await app.taskWorkflowService.recordVerifiedEvidence(task.id, attestedPass(), "2026-10-12T09:00:00.000Z");
  if (!r.ok) throw new Error(`attested evidence seed failed: ${JSON.stringify(r.error)}`);
}

async function mustCreate(app: App, input: CreateDocInput): Promise<DocRecord> {
  const result = await app.corpusService.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function makeApprovedPlan(app: App): Promise<DocRecord> {
  const prd = await mustCreate(app, { type: "prd", title: "Cascade Test PRD", content: "root" } as CreateDocInput);
  const plan = await mustCreate(app, {
    type: "plan",
    title: "Cascade Test Plan",
    parent_id: prd.id,
    content: "## Plan\n\nbody",
    // reason: bypasses the attestationFloor plan-close sub-gate (SPEC-069) —
    // out of THIS test's scope, mirrors attestation-floor.test.ts's own
    // exempt-plan fixtures.
    extra: {
      attestation_exempt: true,
      attestation_exempt_reason: "cascade test — evidence out of scope",
      attestation_exempt_kind: "no-oracle",
    },
  } as CreateDocInput);
  const approved = await app.corpusService.set(plan.id, { status: "approved" });
  if (!approved.ok) throw new Error(`plan approve failed (setup): ${JSON.stringify(approved.error)}`);
  return approved.value;
}

async function makeTask(app: App, plan: DocRecord, title: string): Promise<DocRecord> {
  return mustCreate(app, {
    type: "task",
    title,
    parent_id: plan.id,
    content: "## Task\n\nbody",
    extra: { plan_id: plan.id },
  } as CreateDocInput);
}

function cascadeOf(doc: DocRecord): PlanCloseCascadeResult | undefined {
  return (doc as DocRecord & { cascade?: PlanCloseCascadeResult }).cascade;
}

describe("plan-close cascade (R1) — HAPPY", () => {
  it("AC-097-2: archives an unclaimed task and a plan-parented handoff, each with an archive-cascade audit entry", async () => {
    const app = openApp();
    try {
      const plan = await makeApprovedPlan(app);
      const task = await makeTask(app, plan, "Unclaimed straggler task");
      // re-baselined (#47): this task used to hold NO evidence and was archived anyway.
      await giveAttestedPass(app, task);
      const handoffResult = await app.sessionService!.writeHandoff({
        by: "tester",
        plan_ref: plan.slug,
        task_refs: [],
        modified_files: [],
        key_decisions: [],
        next_steps: ["nothing left"],
      });
      if (!handoffResult.ok) throw new Error(`handoff seed failed: ${JSON.stringify(handoffResult.error)}`);
      const handoff = handoffResult.value;

      const archiveResult = await app.corpusService.set(plan.id, { status: "archived" }, { by: "agent:closer" });
      expect(archiveResult.ok).toBe(true);
      if (!archiveResult.ok) return;

      const cascade = cascadeOf(archiveResult.value);
      expect(cascade).toBeDefined();
      expect(cascade!.failed).toEqual([]);
      expect(cascade!.skipped).toEqual([]);
      expect(cascade!.archived.map((a) => a.doc_id).sort()).toEqual([task.id, handoff.id].sort());

      const taskAfter = await app.corpusService.get(task.id);
      expect(taskAfter.ok).toBe(true);
      if (taskAfter.ok) expect(taskAfter.value.doc.status).toBe("archived");

      const handoffAfter = await app.corpusService.get(handoff.id);
      expect(handoffAfter.ok).toBe(true);
      if (handoffAfter.ok) expect(handoffAfter.value.doc.status).toBe("archived");

      const taskAudit = await app.auditService.query({ doc_id: task.id });
      expect(taskAudit.ok).toBe(true);
      if (taskAudit.ok) {
        expect(taskAudit.value.some((entry) => entry.action === "archive-cascade")).toBe(true);
      }

      const handoffAudit = await app.auditService.query({ doc_id: handoff.id });
      expect(handoffAudit.ok).toBe(true);
      if (handoffAudit.ok) {
        expect(handoffAudit.value.some((entry) => entry.action === "archive-cascade")).toBe(true);
      }
    } finally {
      app.close();
    }
  });
});

describe("plan-close cascade (R1) — NEGATIVE", () => {
  it("AC-097-2: a fresh-claimed sibling task is skipped, not archived, and named in cascade.skipped", async () => {
    const app = openApp();
    try {
      const plan = await makeApprovedPlan(app);
      const freshTask = await makeTask(app, plan, "Fresh-claimed task");

      const claimResult = await app.taskWorkflowService.claim(freshTask.id, { by: "agent:holder", harnessRun: runOfName("agent:holder") });
      expect(claimResult.ok).toBe(true);

      const archiveResult = await app.corpusService.set(plan.id, { status: "archived" }, { by: "agent:closer" });
      expect(archiveResult.ok).toBe(true);
      if (!archiveResult.ok) return;

      const cascade = cascadeOf(archiveResult.value);
      expect(cascade).toBeDefined();
      expect(cascade!.archived).toEqual([]);
      expect(cascade!.skipped).toHaveLength(1);
      expect(cascade!.skipped[0]!.doc_id).toBe(freshTask.id);
      expect(cascade!.skipped[0]!.reason).toContain("agent:holder");

      const taskAfter = await app.corpusService.get(freshTask.id);
      expect(taskAfter.ok).toBe(true);
      if (taskAfter.ok) expect(taskAfter.value.doc.status).not.toBe("archived");
    } finally {
      app.close();
    }
  });
});

describe("plan-close cascade (R1) — BOUNDARY", () => {
  it("AC-097-2: a task already archived before the cascade is neither re-archived nor reported as failed", async () => {
    const app = openApp();
    try {
      const plan = await makeApprovedPlan(app);
      const task = await makeTask(app, plan, "Already archived task");
      // reason: task defaults to draft; draft->archived is legal for `task` (SPEC-lifecycle-archival D3), but
      // `set --status archived` now applies the `lore done` floors (DCL-1 (b)), so the task holds an attested pass first.
      await giveAttestedPass(app, task);
      const preArchived = await app.corpusService.set(task.id, { status: "archived" });
      expect(preArchived.ok).toBe(true);

      const archiveResult = await app.corpusService.set(plan.id, { status: "archived" }, { by: "agent:closer" });
      expect(archiveResult.ok).toBe(true);
      if (!archiveResult.ok) return;

      const cascade = cascadeOf(archiveResult.value);
      expect(cascade).toBeDefined();
      expect(cascade!.archived).toEqual([]);
      expect(cascade!.failed).toEqual([]);
      expect(cascade!.skipped).toEqual([]);
    } finally {
      app.close();
    }
  });
});

describe("plan-close cascade (R1) — STATE (never rolls back the plan's own write)", () => {
  it("AC-097-2: the plan itself is archived even when it has no children at all", async () => {
    const app = openApp();
    try {
      const plan = await makeApprovedPlan(app);
      const archiveResult = await app.corpusService.set(plan.id, { status: "archived" }, { by: "agent:closer" });
      expect(archiveResult.ok).toBe(true);
      if (!archiveResult.ok) return;
      expect(archiveResult.value.status).toBe("archived");
      const cascade = cascadeOf(archiveResult.value);
      expect(cascade).toBeDefined();
      expect(cascade!.archived).toEqual([]);
      expect(cascade!.skipped).toEqual([]);
      expect(cascade!.failed).toEqual([]);
    } finally {
      app.close();
    }
  });
});

describe("plan-close cascade (R1) — REGRESSION (audit chain integrity)", () => {
  it("AC-097-2: AuditService.verify reports clean:true after the cascade", async () => {
    const app = openApp();
    try {
      const plan = await makeApprovedPlan(app);
      const straggler = await makeTask(app, plan, "Straggler for chain check");
      await giveAttestedPass(app, straggler); // re-baselined (#47): a floor-clearing task, so the cascade really writes

      const archiveResult = await app.corpusService.set(plan.id, { status: "archived" }, { by: "agent:closer" });
      expect(archiveResult.ok).toBe(true);

      const verifyResult = await app.auditService.verify({ since: "2020-01-01T00:00:00.000Z" });
      expect(verifyResult.ok).toBe(true);
      if (verifyResult.ok) {
        expect(verifyResult.value.clean).toBe(true);
      }
    } finally {
      app.close();
    }
  });
});

// ─── AC-AP-4 — the cascade checks every floor `lore done` checks (BR-1072, #47) ──────────────

interface FloorFixture {
  readonly plan: DocRecord;
  readonly t1: DocRecord; // runner-attested pass -> archived
  readonly t2: DocRecord; // no evidence -> skipped, floor attested-pass
  readonly t3: DocRecord; // red_first declared + attested pass + no red row -> skipped, floor red-first
  readonly t4: DocRecord; // fresh claim -> skipped, no floor
  readonly h: DocRecord; // plan-parented handoff -> archived
}

async function seedFloorFixture(app: App): Promise<FloorFixture> {
  const plan = await makeApprovedPlan(app);
  const t1 = await makeTask(app, plan, "T1 attested");
  await giveAttestedPass(app, t1);
  const t2 = await makeTask(app, plan, "T2 no evidence");
  const t3 = await makeTask(app, plan, "T3 red-first without red row");
  const declared = await app.taskWorkflowService.declareRedFirst(t3.id, { by: "tester" });
  if (!declared.ok) throw new Error(`declareRedFirst failed: ${JSON.stringify(declared.error)}`);
  await giveAttestedPass(app, t3);
  const t4 = await makeTask(app, plan, "T4 fresh claim");
  const claimed = await app.taskWorkflowService.claim(t4.id, { by: "agent:holder", harnessRun: runOfName("agent:holder") });
  if (!claimed.ok) throw new Error(`claim failed: ${JSON.stringify(claimed.error)}`);
  const handoffResult = await app.sessionService!.writeHandoff({
    by: "tester",
    plan_ref: plan.slug,
    task_refs: [],
    modified_files: [],
    key_decisions: [],
    next_steps: ["nothing left"],
  });
  if (!handoffResult.ok) throw new Error(`handoff seed failed: ${JSON.stringify(handoffResult.error)}`);
  return { plan, t1, t2, t3, t4, h: handoffResult.value };
}

async function statusOf(app: App, id: string): Promise<string> {
  const r = await app.corpusService.get(id);
  if (!r.ok) throw new Error(`get failed: ${JSON.stringify(r.error)}`);
  return r.value.doc.status;
}

async function cascadeAuditCount(app: App, ids: readonly string[]): Promise<number> {
  let n = 0;
  for (const id of ids) {
    const q = await app.auditService.query({ doc_id: id });
    if (!q.ok) throw new Error(`audit query failed: ${JSON.stringify(q.error)}`);
    n += q.value.filter((e) => e.action === "archive-cascade").length;
  }
  return n;
}

/** `floor` is the field the paired implement task adds to `skipped[]`; read through a structural cast. */
function floorOf(cascade: PlanCloseCascadeResult, docId: string): string | undefined {
  return (cascade.skipped.find((s) => s.doc_id === docId) as { floor?: string } | undefined)?.floor;
}

/** Runs the plan close on a fresh fixture and asserts AC-AP-4 (a)-(d). */
async function assertFloorOutcome(app: App): Promise<FloorFixture> {
  const f = await seedFloorFixture(app);
  const archiveResult = await app.corpusService.set(f.plan.id, { status: "archived" }, { by: "agent:closer" });
  expect(archiveResult.ok).toBe(true);
  if (!archiveResult.ok) throw new Error("plan close refused");
  expect(archiveResult.value.status).toBe("archived");
  const cascade = cascadeOf(archiveResult.value)!;
  expect(cascade).toBeDefined();

  // (a) exactly {T1, H}
  expect(cascade.archived.map((a) => a.doc_id).sort()).toEqual([f.t1.id, f.h.id].sort());
  // (b) exactly T2 attested-pass, T3 red-first, T4 no floor + fresh-claim reason
  expect(cascade.skipped.map((s) => s.doc_id).sort()).toEqual([f.t2.id, f.t3.id, f.t4.id].sort());
  expect(floorOf(cascade, f.t2.id)).toBe("attested-pass");
  expect(floorOf(cascade, f.t3.id)).toBe("red-first");
  expect(floorOf(cascade, f.t4.id)).toBeUndefined();
  expect(cascade.skipped.find((s) => s.doc_id === f.t4.id)!.reason).toContain("fresh claim");
  expect(cascade.failed).toEqual([]);
  // (c) skipped tasks keep their prior status
  expect(await statusOf(app, f.t1.id)).toBe("archived");
  expect(await statusOf(app, f.h.id)).toBe("archived");
  expect(await statusOf(app, f.t2.id)).toBe(f.t2.status);
  expect(await statusOf(app, f.t3.id)).toBe(f.t3.status);
  expect(await statusOf(app, f.t4.id)).not.toBe("archived");
  // (d) exactly 2 archive-cascade audit rows, on T1 and H only
  expect(await cascadeAuditCount(app, [f.t1.id, f.t2.id, f.t3.id, f.t4.id, f.h.id])).toBe(2);
  expect(await cascadeAuditCount(app, [f.t2.id, f.t3.id, f.t4.id])).toBe(0);
  return f;
}

describe("plan-close cascade floors (AC-AP-4, BR-1072)", () => {
  it("AC-AP-4 (a)(b)(c)(d) NEGATIVE/STATE: only the floor-clearing task and the handoff are archived; T2/T3/T4 stay open with the refusing floor named", async () => {
    const app = openApp();
    try {
      await assertFloorOutcome(app);
    } finally {
      app.close();
    }
  });

  it("AC-AP-4 (e) BOUNDARY: with workflow.gates.plan-close.enabled false the floors are still checked and (a)-(d) hold (BR-214)", async () => {
    const app = openApp({ workflow: { gates: { "plan-close": { enabled: false } } } });
    try {
      await assertFloorOutcome(app);
    } finally {
      app.close();
    }
  });

  it("AC-AP-4 (f) parity: for T2 and T3, lore done is refused with the same error.details.floor the cascade recorded, and writes nothing", async () => {
    const app = openApp();
    try {
      const f = await seedFloorFixture(app);
      const r = await app.corpusService.set(f.plan.id, { status: "archived" }, { by: "agent:closer" });
      if (!r.ok) throw new Error("plan close refused");
      const cascade = cascadeOf(r.value)!;

      for (const task of [f.t2, f.t3]) {
        const recorded = floorOf(cascade, task.id);
        expect(recorded, `cascade must record a floor for ${task.slug}`).toBeDefined();

        const before = await app.corpusService.get(task.id);
        if (!before.ok) throw new Error("get failed");
        const auditBefore = await app.auditService.query({ doc_id: task.id });
        if (!auditBefore.ok) throw new Error("audit failed");

        const done = await app.taskWorkflowService.done(task.id, { by: "agent:closer", harnessRun: runOfName("agent:closer") });
        expect(done.ok, `lore done must refuse ${task.slug}`).toBe(false);
        if (done.ok) continue;
        // `details.floor` is added to the refusal by the paired implement task (spec D5); the union has no `details` member.
        expect((done.error as { details?: Record<string, unknown> }).details?.["floor"]).toBe(recorded);

        const after = await app.corpusService.get(task.id);
        if (!after.ok) throw new Error("get failed");
        const auditAfter = await app.auditService.query({ doc_id: task.id });
        if (!auditAfter.ok) throw new Error("audit failed");
        expect(after.value.doc.version).toBe(before.value.doc.version);
        expect(after.value.doc.status).toBe(before.value.doc.status);
        expect(auditAfter.value.length).toBe(auditBefore.value.length);
      }
    } finally {
      app.close();
    }
  });
});
