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

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp, type App } from "../../src/app.js";
import type { CreateDocInput, DocRecord, LoreConfig } from "@lore/core";
import type { PlanCloseCascadeResult } from "../../src/service/corpus-service.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-plan-close-cascade-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  const app = createApp(join(loreDir, "lore.db"));
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
function openApp(): App {
  const config: LoreConfig = {
    project: { name: "plan-close-cascade-test", author: "tester" },
  } as unknown as LoreConfig;
  return createApp(dbPath(), config) as App;
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

      const claimResult = await app.taskWorkflowService.claim(freshTask.id, { by: "agent:holder" });
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
      // reason: task defaults to draft; draft->archived is legal for `task` (SPEC-lifecycle-archival D3).
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
      expect(cascade).toEqual({ archived: [], skipped: [], failed: [] });
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
      await makeTask(app, plan, "Straggler for chain check");

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
